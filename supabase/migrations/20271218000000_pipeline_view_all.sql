-- 20271218000000_pipeline_view_all.sql
--
-- Visibilidade de leads separada em duas réguas: a tela Leads (ampla) e o Funil
-- (restrito). Um usuário vê todos os leads em Leads e só os seus no Funil.
-- Desenho: docs/adr/0042-visualizacao-no-funil-separada-de-leads.md
--
-- DECISÕES DO CTO (fixas): enforcement no BANCO (RLS), não só no front; chave
-- nova `pipeline.view_all` com default TRUE no catálogo — ninguém muda de
-- comportamento no rollout; aceito que, com "Funil só meus", a tela Leads mostre
-- leads de outros sem o card do funil.
--
-- O QUE FAZ
--  1. Semeia `pipeline.view_all` (default true) ANTES de qualquer gate que a leia.
--  2. Helpers de RLS (DEFINER, initplan — NUNCA função DEFINER por linha em
--     pipeline_entries, lição do #2310: 40 ms → timeout de 15 s):
--       rls_my_orgs_pipeline_view_all()  orgs onde o caller vê todos os cards
--                                        (admin/gestor/master DA ORG ou a chave);
--       rls_my_pipeline_lead_ids()       leads que são "meus" por sondas INDEXADAS
--                                        (responsável nas 4 colunas, co-dono);
--       rls_my_active_tm_ids_text()      meus team_members ativos em text, para o
--                                        predicado por linha sobre metadata.
--  3. Policies RESTRICTIVE em pipeline_entries (SELECT/UPDATE/DELETE). AND com o
--     que existe: `pipeline_entries_select` (org do usuário), o regime estrito de
--     dono (#2298, `strict_owner_pipeline_entries`, FOR ALL) e o admin de outra
--     org NÃO alarga nada — o bypass é por org (lição do #2298).
--       passa se: org em rls_my_orgs_pipeline_view_all()
--              OR master
--              OR assigned_to é um team_member ativo meu          (linha)
--              OR metadata->{sdr,responsible,closer,pre_sale_responsible,
--                 sale_responsible}_id é um team_member ativo meu  (linha)
--              OR lead_id ∈ rls_my_pipeline_lead_ids()             (lead meu)
--     SEMÂNTICA (aceita): no Funil a pessoa vê o card se o LEAD é dela
--     (colunas/co-dono) ou se ELA está no card. Cards de outras pessoas do mesmo
--     lead, onde ela só aparece em OUTRO card, deixam de contar (antes, via
--     rls_lead_in_my_pipes, contavam). Motivo: o ramo "lead tem algum card meu"
--     varria todo pipeline_entries da org, sem índice, a cada statement.
--     INSERT não é restringido (abrir card para um lead que se vê em Leads
--     continua possível); o que não se enxerga depois é o efeito aceito.
--  4. lead_tem_card_no_funil(lead, funil[, só_sem_negócio]): booleano DEFINER
--     para o "um card sem negócio por lead" (20271119000000). Quem não enxerga
--     o card do outro não pode ler pipeline_entries para saber se ele existe —
--     o índice único barraria o INSERT com 23505 sem explicação.
--     `abrir_negocio` passa a usá-la e a recusar com mensagem de domínio.
--  5. private.realtime_can_join: o tópico Broadcast org:{org}:pe é da org
--     inteira. Quem tem o Funil restrito não entra (usa postgres_changes, que
--     aplica a RLS por evento).
--
-- LEITORES AUDITADOS (todos SECURITY INVOKER, herdam a policy): get_pipeline_page,
-- get_pipeline_stage_counts_by_id, get_pipeline_lead_ids, get_stage_lead_ids,
-- get_filtered_lead_ids, get_all_funnels_lead_ids, negocio_projetado
-- (security_invoker), get_funil_desfecho_por_mes. Contagem por etapa e lista leem
-- a MESMA RLS: batem. NÃO coberto (DEFINER, agregados de org): get_funil_desfecho_counts
-- (cabeçalho do funil), métricas/analytics.
--
-- ORDEM: esta migration ANTES de qualquer edge function/front que dependa da
-- chave. Ela redefine `private.realtime_can_join` e `abrir_negocio` a partir do
-- que está em main (20271215030000 / 20271118000000): se outra migration mais
-- nova redefinir uma das duas, ela precisa carregar as mudanças daqui (o pgTAP
-- pipeline_view_all_test.sql falha se o predicado do Broadcast sumir).
--
-- Rollback: supabase/migrations/rollback/20271218000000_pipeline_view_all.sql

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ─── 1. A chave, semeada antes de tudo ─────────────────────────────────────
INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('pipeline.view_all', 'Pipeline', 'Ver cards de todos no funil',
   'Vê no Funil os cards de leads que são de outras pessoas. Desligado: o Funil mostra só os cards dos leads em que a pessoa é responsável (a tela Leads segue a sua própria regra). Nunca é mais largo que a visualização de leads.',
   false, true, 15)
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Helpers de RLS (initplan) ──────────────────────────────────────────

-- Orgs onde o caller enxerga TODOS os cards do funil. has_feature_permission
-- já devolve true para master e para admin DA ORG (por org, não global);
-- gestor de portfólio não tem team_member e entra pelo get_my_admin_*.
CREATE OR REPLACE FUNCTION public.rls_my_orgs_pipeline_view_all()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT ARRAY(
    SELECT s.org_id
      FROM (
        SELECT o.org_id
          FROM public.get_my_organization_ids() AS o(org_id)
         WHERE public.has_feature_permission('pipeline.view_all', o.org_id)
        UNION
        SELECT g.org_id
          FROM public.get_my_admin_organization_ids() AS g(org_id)
      ) s
     ORDER BY s.org_id
  )
$fn$;

COMMENT ON FUNCTION public.rls_my_orgs_pipeline_view_all() IS
  'RLS helper (pipeline_entries). Orgs onde o caller vê todos os cards: pipeline.view_all efetiva (master/admin da org incluídos) ou admin/gestor da org. Use como (SELECT …) initplan. 20271218000000.';

-- Leads "meus": só as sondas INDEXADAS de `own` em leads (policy
-- leads_select_by_responsibility_and_permissions): 4 colunas de responsável
-- (idx_leads_pre_sale_responsible / sale_responsible / sdr_id / closer_id) e
-- co-dono (lead_owners_member_lead_idx). Sem parâmetro: não é oráculo.
-- O ramo "card do lead atribuído a mim" (rls_lead_in_my_pipes) NÃO entra aqui:
-- varreria todos os pipeline_entries da org, sem índice, a cada statement. Ele
-- virou predicado POR LINHA na policy (assigned_to / metadata do PRÓPRIO card).
-- Lead sem dono NÃO é meu (ver_sem_responsável vale em Leads, não no Funil).
CREATE OR REPLACE FUNCTION public.rls_my_pipeline_lead_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT s.lead_id), '{}'::uuid[])
    FROM (
      SELECT l.id AS lead_id FROM public.leads l
       WHERE l.pre_sale_responsible_id = ANY (public.rls_my_team_member_ids(false))
         AND l.deleted_at IS NULL
         AND l.organization_id IN (SELECT public.get_my_organization_ids())
      UNION ALL
      SELECT l.id FROM public.leads l
       WHERE l.sale_responsible_id = ANY (public.rls_my_team_member_ids(false))
         AND l.deleted_at IS NULL
         AND l.organization_id IN (SELECT public.get_my_organization_ids())
      UNION ALL
      SELECT l.id FROM public.leads l
       WHERE l.sdr_id = ANY (public.rls_my_team_member_ids(false))
         AND l.deleted_at IS NULL
         AND l.organization_id IN (SELECT public.get_my_organization_ids())
      UNION ALL
      SELECT l.id FROM public.leads l
       WHERE l.closer_id = ANY (public.rls_my_team_member_ids(false))
         AND l.deleted_at IS NULL
         AND l.organization_id IN (SELECT public.get_my_organization_ids())
      UNION ALL
      SELECT o.lead_id
        FROM public.lead_owners o
       WHERE o.role = 'co'
         AND o.team_member_id = ANY (public.rls_my_team_member_ids(false))
         AND o.organization_id IN (SELECT public.get_my_organization_ids())
    ) s
$fn$;

COMMENT ON FUNCTION public.rls_my_pipeline_lead_ids() IS
  'RLS helper (pipeline_entries). Leads do caller por sondas indexadas (4 colunas de responsável, co-dono). O card atribuído a ele é predicado por linha na policy. Initplan lazy: só roda para quem não passou pelo ramo da org. 20271218000000.';

-- Meus team_members ATIVOS como text[] (minúsculo): o lado direito do predicado
-- por linha sobre `metadata` (valores são texto, às vezes com maiúsculas).
CREATE OR REPLACE FUNCTION public.rls_my_active_tm_ids_text()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT ARRAY(
    SELECT lower(x::text) FROM unnest(public.rls_my_team_member_ids(true)) AS x
  )
$fn$;

COMMENT ON FUNCTION public.rls_my_active_tm_ids_text() IS
  'RLS helper (pipeline_entries). Ids dos meus team_members ativos em text minúsculo, para comparar com metadata. Initplan. 20271218000000.';

REVOKE ALL ON FUNCTION public.rls_my_active_tm_ids_text()      FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_my_active_tm_ids_text()      TO authenticated;
REVOKE ALL ON FUNCTION public.rls_my_orgs_pipeline_view_all() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.rls_my_pipeline_lead_ids()      FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rls_my_orgs_pipeline_view_all() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_my_pipeline_lead_ids()      TO authenticated;

-- ─── 3. lead_tem_card_no_funil ─────────────────────────────────────────────
-- Booleano, org-scoped (orgs do caller; master em qualquer org), sem expor
-- dado. `p_apenas_sem_negocio` espelha o índice único parcial
-- uq_pipeline_entries_um_card_sem_negocio (aberto e sem negócio). Resíduo
-- aceito: quem é da org pode perguntar "o lead X (uuid) tem card no funil Y?"
-- — precisa do uuid do lead, e a resposta é 1 bit.
CREATE OR REPLACE FUNCTION public.lead_tem_card_no_funil(
  p_lead_id uuid,
  p_pipeline_id uuid,
  p_apenas_sem_negocio boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.pipeline_entries pe
     WHERE pe.lead_id = p_lead_id
       AND pe.pipeline_id = p_pipeline_id
       AND (
         NOT COALESCE(p_apenas_sem_negocio, false)
         OR (pe.deal_id IS NULL AND pe.closed_at IS NULL)
       )
       AND (
         pe.organization_id IN (SELECT public.get_my_organization_ids())
         OR public.is_master_user()
       )
  )
$fn$;

COMMENT ON FUNCTION public.lead_tem_card_no_funil(uuid, uuid, boolean) IS
  'O lead tem card (opcionalmente: aberto e sem negócio) neste funil? Booleano DEFINER, org-scoped, para quem não enxerga o card do outro (pipeline_view_all). 20271218000000.';

-- service_role TAMBÉM executa: abrir_negocio (invoker) a chama em todo caminho
-- sem card visível, e workflow/API chegam lá como service_role. Sem JWT ela
-- devolve false (get_my_organization_ids vazio) — e service_role enxerga todo
-- card pela leitura direta, então "não vi" já significa "não existe".
REVOKE ALL ON FUNCTION public.lead_tem_card_no_funil(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_tem_card_no_funil(uuid, uuid, boolean) TO authenticated, service_role;

-- ─── 4. abrir_negocio usa a checagem DEFINER ───────────────────────────────
-- Corpo base = 20271118000000 (main). Duas mudanças, marcadas no corpo:
--   (a) card sem negócio invisível ao chamador → recusa com `lead_ja_no_funil`;
--   (b) a mensagem do "card criado mas invisível" explica a causa.
-- Mesma assinatura, mesmo GRANT.

CREATE OR REPLACE FUNCTION public.abrir_negocio(p_lead_id uuid, p_pipe text, p_stage text, p_owner_id uuid DEFAULT NULL::uuid, p_value numeric DEFAULT NULL::numeric, p_meeting_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_lead_phone_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org        uuid;
  v_tz         text;
  v_deal_id    uuid;
  v_entry_id   uuid := gen_random_uuid();
  v_orphan_id  uuid;
  v_title      text;
  v_pip        public.pipelines%ROWTYPE;
  v_stage_txt  text := NULLIF(btrim(COALESCE(p_stage, '')), '');
  v_stage_id   uuid;
  v_notes      text := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_phone_id   uuid := p_lead_phone_id;
  v_phones     integer;
  v_meta       jsonb;
BEGIN
  -- A org vem do LEAD, nunca de parâmetro. Com RLS de invoker, um lead de outra
  -- organização simplesmente não é visível e a função aborta aqui — o chamador
  -- não consegue escolher em qual org escreve.
  SELECT l.organization_id INTO v_org
    FROM public.leads l
   WHERE l.id = p_lead_id AND l.deleted_at IS NULL;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Lead % não encontrado (ou está na lixeira).', p_lead_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- O CHECK da coluna também recusa, mas a mensagem dele fala de constraint.
  -- Esta diz o que fazer, e é a que o integrador lê.
  IF p_source IS NOT NULL
     AND p_source NOT IN ('human','workflow','api','import','backfill') THEN
    RAISE EXCEPTION 'Procedência inválida: %. Válidas: human, workflow, api, import, backfill.', p_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Com quem é o negócio (Chamado 82c50502). Informado → tem de ser telefone
  -- ativo DESTE lead. Omitido por um humano num lead com 2+ telefones → recusa:
  -- chutar o principal é como o vendedor acaba falando com a pessoa errada.
  -- Com 1 telefone, é esse. Workflow/API/import seguem sem exigir.
  IF v_phone_id IS NOT NULL THEN
    IF NOT public.fn_telefone_do_lead_valido(p_lead_id, v_phone_id) THEN
      RAISE EXCEPTION 'lead_phone_invalid' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT count(*) INTO v_phones FROM public.lead_phones lp
     WHERE lp.lead_id = p_lead_id AND lp.deleted_at IS NULL;
    IF v_phones >= 2 AND p_source = 'human' THEN
      RAISE EXCEPTION 'lead_phone_required' USING ERRCODE = 'check_violation';
    ELSIF v_phones = 1 THEN
      SELECT lp.id INTO v_phone_id FROM public.lead_phones lp
       WHERE lp.lead_id = p_lead_id AND lp.deleted_at IS NULL;
    END IF;
  END IF;

  -- Qualquer funil, por id/slug/alias — erra alto antes de escrever qualquer
  -- coisa. 'upsell' segue sem porta aqui: não existe linha em `pipelines` com
  -- esse slug (carteira entra por regra própria, ADR-0023 decisão 8), então o
  -- resolvedor recusa com "não existe" — mesmo destino do ELSE antigo.
  v_pip := public.fn_resolver_funil(v_org, p_pipe);

  SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = v_org;

  -- Dono de outra org é recusado aqui, e não só pela trava do M6: a mensagem
  -- daqui diz o que aconteceu, a do gatilho diz que uma constraint falhou.
  IF p_owner_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_members m
                      WHERE m.id = p_owner_id AND m.organization_id = v_org) THEN
    RAISE EXCEPTION 'Responsável % não pertence à organização deste lead.', p_owner_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Etapa e metadata resolvidas ANTES de qualquer escrita: valem tanto para o
  -- card novo quanto para o card adotado.
  IF v_pip.type = 'custom' THEN
    -- Etapa por stage_key OU uuid. O catálogo (`api_list_pipelines`) publica os
    -- dois; antes só o uuid era aceito e stage_key quebrava com "invalid input
    -- syntax for type uuid" — erro de encanamento no lugar de erro de domínio.
    IF v_stage_txt IS NULL THEN
      RAISE EXCEPTION 'Etapa é obrigatória para abrir Negócio em funil personalizado.'
        USING ERRCODE = 'invalid_parameter_value';
    ELSIF v_stage_txt ~ v_uuid_re THEN
      v_stage_id := v_stage_txt::uuid;  -- pertencimento ao funil é validado pela função compartilhada
    ELSE
      SELECT ps.id INTO v_stage_id
        FROM public.pipeline_stages ps
       WHERE ps.organization_id = v_org
         AND ps.pipeline_id = v_pip.id
         AND ps.stage_key = v_stage_txt;
      IF v_stage_id IS NULL THEN
        RAISE EXCEPTION 'Etapa "%" não existe no funil %.', v_stage_txt, v_pip.id
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;

  ELSIF v_pip.slug = 'whatsapp' THEN
    v_meta := jsonb_build_object(
      'responsible_id', p_owner_id,
      'sdr_id',         p_owner_id,
      'scheduled_date', NULL::timestamptz);

  ELSIF v_pip.slug = 'confirmacao' THEN
    v_meta := jsonb_build_object(
      'meeting_date',      p_meeting_date,
      'is_confirmed',      false,
      'closer_id',         NULL::uuid,
      'responsible_id',    p_owner_id,
      'sdr_id',            p_owner_id,
      'meet_link',         NULL::text,
      'metrics_period_at', NULL::timestamptz);

  ELSIF v_pip.slug = 'propostas' THEN
    v_meta := jsonb_build_object(
      'sale_value',        p_value,
      'closer_id',         p_owner_id,
      'responsible_id',    p_owner_id,
      'product_id',        NULL::uuid,
      'product_type',      NULL::text,
      'calor',             NULL::integer,
      'loss_reason',       NULL::text,
      'loss_reason_id',    NULL::uuid,
      'commitment_date',   NULL::date,
      'contract_duration', NULL::integer,
      'metrics_period_at', NULL::timestamptz);

  ELSE
    -- Funil de sistema com slug sem porta própria (não existe em prod hoje —
    -- medido 2026-09-02: só whatsapp/confirmacao/propostas). Erra alto em vez
    -- de inventar um caminho.
    RAISE EXCEPTION 'Funil % não abre negócio por esta porta.', v_pip.slug
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_title := COALESCE(
    NULLIF(btrim(COALESCE(p_title, '')), ''),
    public.fn_negocio_titulo_padrao(now(), v_tz)
  );

  -- O lead já está neste funil num card sem negócio? Então o negócio é DESSE
  -- card. Criar outro é o card duplicado que o cliente vê. FOR UPDATE: duas
  -- chamadas simultâneas não adotam o mesmo card — a segunda espera, relê
  -- `deal_id` preenchido, não acha órfão e cria card próprio (recompra).
  SELECT pe.id INTO v_orphan_id
    FROM public.pipeline_entries pe
   WHERE pe.organization_id = v_org
     AND pe.lead_id = p_lead_id
     AND pe.pipeline_id = v_pip.id
     AND pe.deal_id IS NULL
     AND pe.closed_at IS NULL
   ORDER BY pe.created_at, pe.id
   LIMIT 1
   FOR UPDATE;

  -- Card sem negócio que ESTE chamador não enxerga (Visualização no Funil "só
  -- os meus": policy pipeline_view_all_select, 20271218000000). A leitura acima
  -- voltou vazia, mas o índice uq_pipeline_entries_um_card_sem_negocio barraria
  -- o INSERT adiante com 23505 sem dizer o que houve. lead_tem_card_no_funil é
  -- DEFINER e devolve só um booleano — nenhum dado do card sai dela.
  IF v_orphan_id IS NULL AND public.lead_tem_card_no_funil(p_lead_id, v_pip.id, true) THEN
    RAISE EXCEPTION 'lead_ja_no_funil: este lead já tem um card sem negócio neste funil, sob outro responsável.'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Na adoção a função compartilhada não roda, e era ela que validava o uuid
  -- de etapa custom. A etapa não é usada (o card fica onde está), mas um uuid
  -- de outro funil continua sendo erro do chamador.
  IF v_orphan_id IS NOT NULL AND v_pip.type = 'custom'
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_stages ps
                      WHERE ps.id = v_stage_id AND ps.pipeline_id = v_pip.id) THEN
    RAISE EXCEPTION 'Etapa "%" não existe no funil %.', v_stage_txt, v_pip.id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.deals (organization_id, title, source_lead_id, owner_id, value, notes, created_by, source, lead_phone_id)
  VALUES (v_org, v_title, p_lead_id, p_owner_id, p_value, v_notes, auth.uid(), p_source, v_phone_id)
  RETURNING id INTO v_deal_id;

  IF v_orphan_id IS NOT NULL THEN
    -- Só preenche o que está vazio: o que o card já tem foi decidido por
    -- alguém (roleta, vendedor, automação) e vale mais que o default da porta.
    UPDATE public.pipeline_entries pe
       SET deal_id     = v_deal_id,
           assigned_to = COALESCE(pe.assigned_to, p_owner_id),
           notes       = COALESCE(pe.notes, v_notes),
           metadata    = jsonb_strip_nulls(COALESCE(v_meta, '{}'::jsonb))
                         || COALESCE(pe.metadata, '{}'::jsonb)
     WHERE pe.id = v_orphan_id;

    RETURN v_deal_id;
  END IF;

  IF v_pip.type = 'custom' THEN
    -- Caminho único pós-674: a função compartilhada escreve em pipeline_entries,
    -- valida funil/etapa/tenancy e já liga o card ao negócio.
    PERFORM public.fn_entrada_custom_criar(
      p_organization_id => v_org,
      p_pipeline_id     => v_pip.id,
      p_lead_id         => p_lead_id,
      p_stage_id        => v_stage_id,
      p_assigned_to     => p_owner_id,
      p_deal_id         => v_deal_id,
      p_notes           => v_notes,
      p_id              => v_entry_id);
  ELSE
    PERFORM public.fn_entrada_sistema_criar(
      p_organization_id => v_org,
      p_slug            => v_pip.slug,
      p_lead_id         => p_lead_id,
      p_stage_key       => COALESCE(v_stage_txt, CASE v_pip.slug
                             WHEN 'whatsapp'    THEN 'novo_lead'
                             WHEN 'confirmacao' THEN 'marcada'
                             WHEN 'propostas'   THEN 'enviada'
                           END),
      p_assigned_to     => p_owner_id,
      p_metadata        => v_meta,
      p_notes           => v_notes,
      p_id              => v_entry_id);

    -- Liga a posição à identidade. A função de sistema não recebe `deal_id`;
    -- a função custom já criou o card ligado.
    UPDATE public.pipeline_entries SET deal_id = v_deal_id WHERE id = v_entry_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Card criado mas não encontrado para ligar ao negócio (entry %). Se a sua Visualização no Funil é "só os meus", atribua o negócio a você. Transação desfeita para não deixar negócio sem posição.', v_entry_id
        USING ERRCODE = 'internal_error';
    END IF;
  END IF;

  RETURN v_deal_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abrir_negocio(uuid, text, text, uuid, numeric, timestamp with time zone, text, text, text, uuid) TO authenticated, service_role;

-- ─── 5. Broadcast: quem tem o Funil restrito não entra no tópico da org ────
-- Corpo base = 20271215030000 (main), + o predicado de pipeline.view_all.
CREATE OR REPLACE FUNCTION private.realtime_can_join(p_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_match text[];
  v_org uuid;
BEGIN
  IF auth.uid() IS NULL OR p_topic IS NULL THEN
    RETURN false;
  END IF;

  -- Formato fechado, minúsculo (uuid::text). Tópico desconhecido = nega.
  v_match := regexp_match(
    p_topic,
    '^org:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(pe)$'
  );
  IF v_match IS NULL THEN
    RETURN false;
  END IF;
  v_org := v_match[1]::uuid;

  IF v_match[2] = 'pe' THEN
    -- Some clean installations do not have the optional strict-owner rollout.
    -- Missing authorization metadata must disable broadcast, never remove the
    -- owner filter. Postgres Changes remains the safe frontend fallback.
    IF to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN
      RETURN false;
    END IF;
    -- Pipeline view_all (20271218000000): o tópico é da org inteira e o
    -- Broadcast autoriza no JOIN, não por evento. Quem tem a visualização do
    -- Funil restrita NESTA org (pipeline_entries_view_all RESTRICTIVE) não pode
    -- entrar: receberia o card de todo mundo. Cai no postgres_changes, que
    -- aplica a RLS por evento.
    RETURN EXISTS (SELECT 1 FROM public.get_my_organization_ids() AS m(org_id) WHERE m.org_id = v_org)
       AND NOT (v_org = ANY (private.strict_lead_member_orgs()))
       AND v_org = ANY (public.rls_my_orgs_pipeline_view_all());
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.realtime_can_join(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.realtime_can_join(text) TO authenticated;

-- ─── 6. As policies, por último (ACCESS EXCLUSIVE dura o mínimo) ───────────
-- RESTRICTIVE: AND com tudo que já existe. Ordem do OR: o ramo da org (initplan
-- de 1 array) corta tudo para quem tem a chave — o default, hoje todo mundo —
-- antes de qualquer outra sonda. Depois, o que vale para o card em si
-- (colunas da PRÓPRIA linha, sem varredura) e por último o lead ser meu.
-- NUNCA EXISTS correlacionado contra `leads` aqui: a RLS de leads lê
-- pipeline_entries (rls_lead_in_my_pipes) — seria recursão.
-- Idempotente: DROP IF EXISTS antes de cada CREATE.
DROP POLICY IF EXISTS pipeline_view_all_select ON public.pipeline_entries;
DROP POLICY IF EXISTS pipeline_view_all_update ON public.pipeline_entries;
DROP POLICY IF EXISTS pipeline_view_all_delete ON public.pipeline_entries;

CREATE POLICY pipeline_view_all_select ON public.pipeline_entries
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    organization_id = ANY ((SELECT public.rls_my_orgs_pipeline_view_all())::uuid[])
    OR (SELECT public.is_master_user())
    OR assigned_to = ANY ((SELECT public.rls_my_team_member_ids(true))::uuid[])
    OR lower(metadata->>'sdr_id')                  = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'responsible_id')          = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'closer_id')               = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'pre_sale_responsible_id') = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'sale_responsible_id')     = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lead_id = ANY ((SELECT public.rls_my_pipeline_lead_ids())::uuid[])
  );

-- UPDATE/DELETE já passam pelo SELECT quando há WHERE; as duas policies fecham
-- o caso sem WHERE visível. O WITH CHECK NÃO repete o predicado de visibilidade:
-- ele vale para a linha ANTIGA, então transferir o card para outra pessoa continua
-- possível a quem o vê. Também NÃO pode ser `true` literal: a invariante INV-1
-- (supabase/tests/rls_invariants.sql) reprova qualquer WITH CHECK(true) para
-- authenticated. Só repete a trava de org que pipeline_entries_update já impõe
-- (o WITH CHECK padrão de uma policy sem cláusula é o próprio USING): a org da
-- linha nova tem de ser uma das do usuário, ou ele é master.
CREATE POLICY pipeline_view_all_update ON public.pipeline_entries
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    organization_id = ANY ((SELECT public.rls_my_orgs_pipeline_view_all())::uuid[])
    OR (SELECT public.is_master_user())
    OR assigned_to = ANY ((SELECT public.rls_my_team_member_ids(true))::uuid[])
    OR lower(metadata->>'sdr_id')                  = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'responsible_id')          = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'closer_id')               = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'pre_sale_responsible_id') = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'sale_responsible_id')     = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lead_id = ANY ((SELECT public.rls_my_pipeline_lead_ids())::uuid[])
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

CREATE POLICY pipeline_view_all_delete ON public.pipeline_entries
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    organization_id = ANY ((SELECT public.rls_my_orgs_pipeline_view_all())::uuid[])
    OR (SELECT public.is_master_user())
    OR assigned_to = ANY ((SELECT public.rls_my_team_member_ids(true))::uuid[])
    OR lower(metadata->>'sdr_id')                  = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'responsible_id')          = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'closer_id')               = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'pre_sale_responsible_id') = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lower(metadata->>'sale_responsible_id')     = ANY ((SELECT public.rls_my_active_tm_ids_text())::text[])
    OR lead_id = ANY ((SELECT public.rls_my_pipeline_lead_ids())::uuid[])
  );


-- ─── 7. Autoverificação (aborta a transação se algo ficou torto) ───────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.feature_permissions
                  WHERE key = 'pipeline.view_all' AND default_value AND NOT is_admin_only) THEN
    RAISE EXCEPTION 'pipeline.view_all ausente ou com default errado: o rollout deixaria de ser neutro';
  END IF;
  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.pipeline_entries'::regclass
         AND polname LIKE 'pipeline_view_all_%' AND NOT polpermissive) <> 3 THEN
    RAISE EXCEPTION 'as 3 policies RESTRICTIVE de pipeline_view_all não foram criadas';
  END IF;
  IF has_function_privilege('anon', 'public.lead_tem_card_no_funil(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rls_my_orgs_pipeline_view_all()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rls_my_pipeline_lead_ids()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa um helper de pipeline_view_all';
  END IF;
END
$verify$;

COMMIT;
