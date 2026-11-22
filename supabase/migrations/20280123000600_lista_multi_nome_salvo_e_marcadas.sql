-- ════════════════════════════════════════════════════════════════════════════
-- Lista multi do /chat: nome salvo do contato na própria linha e marcadas como
-- não lida sem sonda por linha
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026): depois da lista, o front pede o nome salvo de cada
-- conversa em `whatsapp_conversation_summary` — 1 request POR CAIXA × lotes de
-- 200 telefones (64 k chamadas, ~140 ms cada; o custo fixo é o InitPlan de
-- RLS do resumo). A própria lista JÁ lê o resumo (CTE `chip`).
-- E o contador de cada linha da página chama `is_conversation_marked_unread`
-- (sonda em conversation_read_state por linha, 500×) — o array das marcadas já
-- é montado para o filtro de não-lida.
--
-- CORREÇÃO (mesma semântica, coluna nova no fim):
--   (6) RETURNS ganha `saved_contact_name text` no FIM: o nome salvo do resumo
--       da linha que a CTE `chip` escolheu (já lê o resumo); se ela não tem
--       nome e a caixa tem chip histórico, o mais recente NÃO nulo entre os
--       chips da mesma (caixa, telefone), caixa viva primeiro — sem isso o
--       chip re-pareado sem nome regrediria o nome da agenda (COALESCE entre
--       linhas, avaliado só nas linhas nulas de caixas com histórico). Front lê a coluna e só cai no fetch antigo
--       se ela não vier (base sem esta migration).
--   (7) `v_marked` é montado SEMPRE (era só com p_unread) e o contador usa
--       `= ANY(v_marked)` no lugar de `is_conversation_marked_unread(...)`:
--       mesma leitura (tabela, org, auth.uid(), chave `whatsapp:<caixa>:<tel>`,
--       marked_unread). Índice parcial 20280123000300 deixa a leitura em µs.
--
-- RETURNS muda ⇒ DROP + CREATE. DROP+CREATE devolve EXECUTE a PUBLIC/anon e o
-- default do Supabase dá service_role: o REVOKE abaixo tira os três e o GRANT
-- devolve só authenticated — o proacl de prod ({postgres, authenticated}).
--
-- BASE: o MESMO texto de 20280119040000 (aplicada; produz em prod o corpo de
-- md5 16058a92187936b8e08c41ec9d47bf7e, 35× `private.`) + (6) + (7). Mesmo
-- mecanismo de forma de prod: o CREATE usa public.* e o bloco DO do fim troca
-- para private.* quando o recorte strict está instalado; a contagem esperada de
-- `private.` passa de 35 a 36 (a leitura do resumo do (6), trocada pelo bloco DO).
-- Pré-voo: o corpo vivo TEM de ser o revisado — prod-form 16058a92… onde o
-- recorte strict está instalado, repo-form 5bdff38d… onde não está. Outro
-- corpo ⇒ RAISE (alguém mudou a lista fora desta base; o DROP apagaria).
--
-- Rollback: supabase/migrations/rollback/20280123000600_lista_multi_nome_salvo_e_marcadas.sql

DO $preflight$
DECLARE
  v_md5 text;
  v_esperado text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)');
  v_esperado := CASE WHEN to_regprocedure('private.strict_lead_member_orgs()') IS NOT NULL
                     THEN '16058a92187936b8e08c41ec9d47bf7e'
                     ELSE '5bdff38d47f040c38c38519f342d59c6' END;
  IF v_md5 IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'pré-voo: get_whatsapp_conversation_list_multi diverge da base revisada (md5 %, esperado %), abortado', v_md5, v_esperado;
  END IF;
END
$preflight$;

DROP FUNCTION public.get_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid[], text[], uuid[], text[], uuid, boolean, text, boolean, boolean, boolean, text, boolean, uuid, text);

CREATE FUNCTION public.get_whatsapp_conversation_list_multi(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false, p_before_box uuid DEFAULT NULL::uuid, p_before_phone text DEFAULT NULL::text)
 RETURNS TABLE(instance_id uuid, phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer, tags jsonb, saved_contact_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_boxes   uuid[];
  v_box_of    uuid[];
  v_member_of uuid[];
  v_members uuid[];
  v_marked  text[] := '{}';
  v_hist_boxes uuid[] := '{}';
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
  v_balcao       boolean;
  v_karine_principal_without_funnel_filter boolean :=
    p_funnels IS NULL
    AND v_uid = '85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea'::uuid
    AND p_org = '30bb5c27-88f4-4f91-9493-835405ae2e11'::uuid;
  -- (5) Pré-filtro do recorte strict — ver o cabeçalho.
  v_strict       boolean := false;
  v_pref         boolean := false;
  v_pref_ids     uuid[];
  v_pref_np      text[];
BEGIN
  -- Escopo de funil da JR Tex. Existe só em prod (aplicado fora do ledger);
  -- chamado por EXECUTE para a função continuar executável num banco montado
  -- só do repo. FALHA FECHADA em prod: o bloco DO do fim exige que as funções
  -- existam e troca a guarda abaixo por `true` — em prod o EXECUTE sempre roda
  -- e função ausente vira erro, como no corpo vivo. A guarda só sobrevive onde
  -- o recorte strict não está instalado (repo/PGlite).
  IF to_regprocedure('private.jrtex_pipeline_scoped()') IS NOT NULL THEN
    EXECUTE 'SELECT CASE WHEN private.jrtex_pipeline_scoped()
                 THEN ARRAY(SELECT unnest(private.jrtex_visible_pipeline_ids())
                            INTERSECT
                            SELECT unnest(coalesce($1, private.jrtex_visible_pipeline_ids())))
                 ELSE $1 END'
      INTO p_funnels USING p_funnels;
  END IF;
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);

  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  -- (1) Expansão dos chips EM CONJUNTO, uma consulta só.
  -- Antes: `whatsapp_chip_instance_ids(p_org, box)` uma vez POR CAIXA. Cada
  -- chamada é plpgsql DEFINER que refaz o gate de org E chama
  -- `whatsapp_readable_instance_ids` de novo para a própria caixa — medido em
  -- prod, 2,4 ms × 60 caixas = 147 ms por lista na Alamaster, só para
  -- re-autorizar o que `v_boxes` acabou de autorizar.
  -- Aqui a regra de `whatsapp_chip_instance_ids` é a mesma, escrita uma vez:
  -- a caixa é membro de si mesma; se o número dela tem 10+ dígitos, os uuids
  -- da `whatsapp_instance_reap_queue` com os mesmos dígitos (mesma org) também
  -- são. A autorização já está em `v_boxes`, que só contém caixas legíveis.
  SELECT array_agg(x.box ORDER BY x.member), array_agg(x.member ORDER BY x.member)
    INTO v_box_of, v_member_of
    FROM (
      SELECT DISTINCT ON (mm.member) mm.box, mm.member
        FROM (
          SELECT b.box, b.box AS member
            FROM unnest(v_boxes) AS b(box)
          UNION ALL
          SELECT wi.id, q.instance_id
            FROM public.whatsapp_instances wi
            JOIN public.whatsapp_instance_reap_queue q
              ON q.organization_id = p_org
             AND q.phone_number IS NOT NULL
             AND regexp_replace(q.phone_number, '[^0-9]', '', 'g')
               = regexp_replace(wi.phone_number, '[^0-9]', '', 'g')
           WHERE wi.id = ANY(v_boxes)
             AND wi.organization_id = p_org
             AND length(regexp_replace(wi.phone_number, '[^0-9]', '', 'g')) >= 10
        ) mm
       ORDER BY mm.member, (mm.member = mm.box) DESC, mm.box
    ) x;

  IF v_member_of IS NULL THEN
    v_box_of    := v_boxes;
    v_member_of := v_boxes;
  END IF;

  v_members := v_member_of;
  -- (6) Caixas com chip histórico (membro ≠ caixa): só nelas o nome salvo pode
  -- estar noutra linha do resumo do mesmo número.
  v_hist_boxes := ARRAY(SELECT DISTINCT u.box FROM unnest(v_box_of, v_member_of) AS u(box, member)
                         WHERE u.box <> u.member);

  -- Chaves marcadas como não-lida pelo usuário, uma vez POR CHAMADA — servem
  -- ao filtro de não-lida E ao contador da página (antes: uma chamada de
  -- função com sonda por linha da página). Mesma leitura de
  -- `is_conversation_marked_unread` (tabela pública, chave pela CAIXA).
  -- O nome entre aspas é DE PROPÓSITO: o bloco DO do fim troca
  -- `public.conversation_read_state` pela view private.* em prod, e esta
  -- leitura tem de continuar na TABELA, como a função que ela substitui.
  v_marked := ARRAY(
    SELECT rs.conversation_key
    FROM public."conversation_read_state" rs
    WHERE rs.organization_id = p_org
      AND rs.user_id = v_uid
      AND rs.marked_unread
      AND rs.conversation_key LIKE 'whatsapp:%');

  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    v_iso_bypass :=
      public.is_org_admin(p_org)
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  -- Acesso compartilhado do balcão Riofix: limitado pelas relações private.*
  -- protegidas. Função ausente aqui só RESTRINGE (sem bypass) — falha fechada
  -- por construção; o bloco DO do fim ainda exige que ela exista em prod.
  IF to_regprocedure('private.riofix_balcao_current_scope()') IS NOT NULL THEN
    EXECUTE 'SELECT private.riofix_balcao_current_scope() IS NOT NULL' INTO v_balcao;
    IF v_balcao THEN
      v_iso_bypass := true;
    END IF;
  END IF;

  -- (5) Pré-filtro do recorte strict_lead_owner_access — ver o cabeçalho.
  -- Só para quem está sob o recorte NESTA org e cai no ramo GENÉRICO dele (sem
  -- balcão Riofix, sem escopo de funil JR Tex, sem a caixa da Izadora), e só
  -- enquanto os corpos de que a equivalência depende são os revisados (md5
  -- do corpo SQL ou da forma plpgsql de 20280119000000). Qualquer outra coisa
  -- → v_pref fica false e a lista roda exatamente como antes.
  -- Por EXECUTE: o recorte existe só em prod; num banco montado só do repo a
  -- guarda deixa o pré-filtro desligado (sem recorte, não há o que filtrar).
  IF to_regprocedure('private.strict_lead_member_orgs()') IS NOT NULL THEN
    EXECUTE 'SELECT $1 = ANY(private.strict_lead_member_orgs())' INTO v_strict USING p_org;
    IF COALESCE(v_strict, false) AND NOT COALESCE(v_balcao, false) THEN
      EXECUTE $pre$
        SELECT
          -- ramo genérico do recorte para este usuário nesta org
          auth.uid() IS NOT NULL
          AND private.riofix_balcao_scope_for_user(auth.uid(), $1) IS NULL
          AND private.jrtex_lead_scope_for_user(auth.uid(), $1) IS NULL
          AND NOT COALESCE(private.jrtex_izadora_inbox_scope(auth.uid(), $1), false)
          -- ramos hard-wired da Karine (JR Tex) em strict_phone_visible/strict_lead_is_owned:
          -- ela vê além do conjunto genérico, então fica no caminho sem pré-filtro
          AND auth.uid() IS DISTINCT FROM '85f5c2cd-dbf9-4de5-9d35-24ebd9da71ea'::uuid
          -- corpos revisados (18/11/2026): SQL vivo ou a forma plpgsql gerada
          AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
                WHERE p.oid = to_regprocedure('private.strict_phone_visible(uuid,uuid,text)'))
              IN ('042c6dcd662f6e188868d0f62c031d35', 'ece2806418ae67166598cf54434673b0')
          AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
                WHERE p.oid = to_regprocedure('private.strict_lead_is_owned(uuid,uuid)'))
              IN ('cd65d7ad967b5ace6704eb948ada4cd3', '77ba9e43857dd4917673b2d670bbdbcc')
          AND (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p
                WHERE p.oid = to_regprocedure('private.jrtex_izadora_new_chat(uuid,uuid,uuid,text)'))
              = '76d54226fcad6ee83d2766c14957cab1',
          -- Leads do usuário: a condição do ramo genérico de
          -- strict_lead_is_owned, LITERAL, avaliada em conjunto.
          ARRAY(
            SELECT l.id FROM public."leads" l
            JOIN public."team_members" tm ON tm.organization_id = l.organization_id
              AND tm.user_id = auth.uid() AND tm.is_active
            WHERE l.organization_id = $1 AND l.deleted_at IS NULL
              AND (
                tm.id IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id)
                OR EXISTS (
                  SELECT 1 FROM public."lead_owners" own
                  WHERE own.lead_id = l.id AND own.organization_id = $1
                    AND own.team_member_id = tm.id AND own.role = 'co'
                )
                OR EXISTS (
                  SELECT 1 FROM public."pipeline_entries" pe
                  WHERE pe.lead_id = l.id AND pe.organization_id = $1
                    AND (pe.assigned_to = tm.id OR tm.id::text IN (
                      pe.metadata->>'pre_sale_responsible_id', pe.metadata->>'sale_responsible_id',
                      pe.metadata->>'sdr_id', pe.metadata->>'closer_id', pe.metadata->>'responsible_id'
                    ))
                )
              ))
      $pre$ INTO v_pref, v_pref_ids USING p_org;
      v_pref := COALESCE(v_pref, false);
      IF v_pref THEN
        v_pref_np := ARRAY(
          SELECT DISTINCT l.normalized_phone FROM public."leads" l
          WHERE l.id = ANY(v_pref_ids) AND l.normalized_phone IS NOT NULL);
      END IF;
    END IF;
  END IF;
  RETURN QUERY
  WITH boxes AS (
    SELECT u.box, u.member
    FROM unnest(v_box_of, v_member_of) AS u(box, member)
  ),
  -- (2) NÃO existe mais CTE `read_state`. Ela materializava TODA a leitura do
  -- usuário na org (4.680 linhas na Alamaster) e era consultada por
  -- `LEFT JOIN read_state r ON r.box = ... AND r.np = ...` DENTRO da contagem
  -- de não-lidas — um CTE Scan linear por MENSAGEM candidata: medido em prod,
  -- 5.757 varreduras × 4.680 linhas = 4,4 s de uma lista de 12 s.
  -- No lugar, cada linha que precisa da última leitura a busca pela chave
  -- exata `whatsapp:<uuid-do-chip>:<telefone>` — uma sonda no índice único
  -- (organization_id, user_id, conversation_key) por chip da caixa. Mesma
  -- semântica: `max(last_read_at)` sobre os chips da MESMA caixa, nunca de
  -- outra. (A forma antiga casava `split_part(chave, ':', 3) = telefone`;
  -- igual à chave exata porque telefone normalizado e jid de grupo não têm
  -- `:`.)
  conv AS (
    SELECT bx.box AS box, c.normalized_phone AS np, c.id, c.archived_at,
           c.deleted_at, c.instance_id AS inst, c.created_at
    FROM public.whatsapp_conversations c
    JOIN boxes bx ON bx.member = c.instance_id
    WHERE c.organization_id = p_org
      AND c.instance_id = ANY(v_members)
      AND c.normalized_phone IS NOT NULL
      -- (5) Pré-filtro: a view avalia strict_phone_visible(org, NULL,
      -- telefone) — no ramo genérico, verdade ⇔ telefone de um lead do
      -- usuário. Conjunção barata, avaliada antes da função da view.
      AND (NOT v_pref OR c.normalized_phone = ANY(v_pref_np))
  ),
  conv_pick AS (
    SELECT DISTINCT ON (c2.box, c2.np)
           c2.box, c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.box, c2.np, (c2.inst = c2.box) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  chip AS (
    SELECT DISTINCT ON (bx.box, s.normalized_phone)
           bx.box AS box,
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id AS lid, s.is_group AS grp, s.saved_contact_name AS saved
    FROM public.whatsapp_conversation_summary s
    JOIN boxes bx ON bx.member = s.instance_id
    WHERE s.organization_id = p_org
      AND s.instance_id = ANY(v_members)
      AND (p_include_groups OR s.is_group = false)
      -- (5) Pré-filtro: a view avalia strict_phone_visible(org, lead_id,
      -- telefone) — no ramo genérico, verdade ⇔ o lead é do usuário (com
      -- lead) ou o telefone é de um lead dele (sem lead).
      AND (NOT v_pref OR COALESCE(CASE WHEN s.lead_id IS NOT NULL
                                        THEN s.lead_id = ANY(v_pref_ids)
                                        ELSE s.normalized_phone = ANY(v_pref_np) END, false))
      AND (
        v_iso_bypass
        OR (s.is_group AND COALESCE(v_iso_unassign, false))
        OR EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.organization_id  = p_org
            AND l.normalized_phone = s.normalized_phone
            AND l.deleted_at IS NULL
            AND (
              COALESCE(v_iso_tm IN (
                l.pre_sale_responsible_id, l.sale_responsible_id,
                l.sdr_id, l.closer_id
              ), false)
              OR COALESCE(v_iso_tm IS NOT NULL
                          AND public.rls_lead_co_owned(l.id, ARRAY[v_iso_tm]), false)
              OR (
                COALESCE(
                  l.pre_sale_responsible_id, l.sale_responsible_id,
                  l.sdr_id, l.closer_id
                ) IS NULL
                AND v_iso_unassign
              )
            )
        )
      )
    ORDER BY bx.box, s.normalized_phone, s.last_message_time DESC
  ),
  page AS (
    SELECT s.box, s.phone_number, s.normalized_phone, s.last_push_name,
           s.last_message, s.last_message_time, s.last_message_direction,
           s.last_message_sent_source, s.lid, s.grp, s.saved
    FROM chip s
    WHERE (
        p_before IS NULL
        OR s.last_message_time < p_before
        OR (s.last_message_time = p_before
            AND (p_before_box IS NULL
                 OR p_before_phone IS NULL
                 OR (s.box, s.normalized_phone) < (p_before_box, p_before_phone)))
      )

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lid IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lid IS NULL)
      )

      -- (4) FILTRO de não-lida. Roda sobre o conjunto INTEIRO (13 mil
      -- conversas na Alamaster), então cada termo foi barateado:
      --   * marcada como não-lida: array `v_marked` montado uma vez, em vez
      --     de uma chamada de função com sonda por conversa;
      --   * PODA pelo resumo: `whatsapp_conversation_summary.last_message_time`
      --     é `greatest(...)` mantido por trigger AFTER INSERT síncrono em
      --     whatsapp_messages — nunca é menor que o timestamp de qualquer
      --     mensagem do (chip, telefone). Logo, se ele não passa do corte, NENHUMA
      --     mensagem recebida passa, e o EXISTS sobre whatsapp_messages é pulado
      --     sem tocar a tabela. A poda é condição necessária, não suficiente:
      --     quem passa ainda prova a mensagem recebida no EXISTS.
      --     INVARIANTE de que a poda depende: o resumo só é mantido pelo
      --     trigger de INSERT. Um UPDATE que mova mensagem para outro
      --     (instance_id, normalized_phone) ou adiante o "timestamp" — p.ex.
      --     riofix_proposal_message_update, se um dia mexer nessas colunas —
      --     deixaria o resumo atrás da mensagem e a poda esconderia a não-lida.
      --     Medido em prod (16/11/2026), janela de 30 dias: 0 pares (chip,
      --     telefone) com o resumo atrás da mensagem. Quem criar esse UPDATE tem de
      --     atualizar o resumo junto ou remover esta poda.
      --   * o corte `GREATEST(30 dias, última leitura ou 7 dias)` é calculado
      --     uma vez por conversa e vira condição de índice no EXISTS.
      AND (
        p_unread IS NOT TRUE
        OR ('whatsapp:' || s.box::text || ':' || s.normalized_phone) = ANY(v_marked)
        OR (
          s.last_message_time > now() - interval '30 days'
          AND EXISTS (
            SELECT 1
            FROM (
              SELECT GREATEST(
                       now() - interval '30 days',
                       COALESCE((
                         SELECT max(rs.last_read_at)
                         FROM public.conversation_read_state rs
                         WHERE rs.organization_id = p_org
                           AND rs.user_id = v_uid
                           AND rs.conversation_key IN (
                                 SELECT 'whatsapp:' || bb.member::text || ':' || s.normalized_phone
                                 FROM boxes bb WHERE bb.box = s.box)
                       ), now() - interval '7 days')) AS cut
            ) c
            WHERE s.last_message_time > c.cut
              AND EXISTS (
                SELECT 1
                FROM public.whatsapp_messages m
                WHERE m.organization_id  = p_org
                  AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = s.box)
                  AND m.normalized_phone = s.normalized_phone
                  AND m.direction        = 'incoming'
                  AND m.deleted_at IS NULL
                  AND (p_include_groups OR m.is_group = false)
                  AND m."timestamp" > c.cut
              )
          )
        )
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lid
                AND cv.state = 'WAITING_HUMAN'))
      )

      AND (
        p_tiers IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lid IS NULL
        OR EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR CASE
             WHEN v_karine_principal_without_funnel_filter
                  AND s.box = '859ee852-2102-4a5d-b249-98a6fe0b601c'::uuid
                  AND s.lid IS NULL
                  AND NOT s.grp
             THEN /*KARINE_ORPHAN*/ false
             ELSE false
           END
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      AND (
        p_tags IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.lead_tags lt
              WHERE lt.lead_id = s.lid AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN public.whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.box = s.box AND c3.np = s.normalized_phone
                AND ct.tag_id = ANY(p_tags))
      )
    ORDER BY s.last_message_time DESC, s.box DESC, s.normalized_phone DESC
    LIMIT v_limit
  )
  SELECT p.box, p.phone_number, p.normalized_phone, p.last_push_name, p.last_message,
         p.last_message_time, p.last_message_direction, p.last_message_sent_source,
         p.lid, p.grp, cp.id, cp.archived_at, GREATEST(COALESCE(u.cnt, 0)::integer, CASE WHEN ('whatsapp:' || p.box::text || ':' || p.normalized_phone) = ANY(v_marked) THEN 1 ELSE 0 END),
         et.etiquetas,
         -- (6) nome salvo da linha escolhida; se nulo e a caixa tem chip
         -- histórico, o mais recente NÃO nulo entre os chips da MESMA caixa e
         -- telefone (caixa viva primeiro) — chip re-pareado sem nome não apaga
         -- o nome da agenda. Avaliado só nessas linhas (CASE preguiçoso).
         CASE WHEN p.saved IS NULL AND p.box = ANY(v_hist_boxes) THEN (
           SELECT s2.saved_contact_name
             FROM public.whatsapp_conversation_summary s2
             JOIN boxes b2 ON b2.member = s2.instance_id AND b2.box = p.box
            WHERE s2.organization_id = p_org
              AND s2.normalized_phone = p.normalized_phone
              AND s2.saved_contact_name IS NOT NULL
            ORDER BY (s2.instance_id = p.box) DESC, s2.last_message_time DESC
            LIMIT 1)
         ELSE p.saved END
  FROM page p
  LEFT JOIN conv_pick cp ON cp.box = p.box AND cp.np = p.normalized_phone
  -- (3) Última leitura UMA vez por linha da página, antes da contagem — não
  -- mais um JOIN repetido por mensagem.
  LEFT JOIN LATERAL (
    SELECT max(rs.last_read_at) AS last_read_at
    FROM public.conversation_read_state rs
    WHERE rs.organization_id = p_org
      AND rs.user_id = v_uid
      AND rs.conversation_key IN (
            SELECT 'whatsapp:' || bb.member::text || ':' || p.normalized_phone
            FROM boxes bb WHERE bb.box = p.box)
  ) rd ON true
  -- CONTAGEM de não-lida: só as linhas da página, depois do LIMIT. O corte
  -- `GREATEST(30 dias, última leitura ou 7 dias)` entra na condição do índice
  -- idx_whatsapp_msgs_org_phone_instance_ts, então a varredura lê só o que
  -- chegou DEPOIS da leitura — antes lia 30 dias de mensagem nas duas
  -- direções e descartava no filtro (medido: 238 linhas e 74 ms por conversa,
  -- quase tudo leitura de disco).
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.whatsapp_messages m
    WHERE m.organization_id  = p_org
      AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = p.box)
      AND m.normalized_phone = p.normalized_phone
      AND m.direction        = 'incoming'
      AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > GREATEST(now() - interval '30 days',
                                   COALESCE(rd.last_read_at, now() - interval '7 days'))
  ) u ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(
             jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'color', x.color)
                       ORDER BY x.origem, x.name, x.id),
             '[]'::jsonb) AS etiquetas
    FROM (
      SELECT DISTINCT ON (t.id) t.id, t.name, t.color, e.origem
      FROM (
        SELECT lt.tag_id, 0 AS origem
        FROM public.lead_tags lt
        JOIN public.leads l ON l.id = lt.lead_id
        WHERE lt.lead_id = p.lid
          AND l.organization_id = p_org
          AND l.deleted_at IS NULL
        UNION ALL
        SELECT ct.tag_id, 1
        FROM public.whatsapp_conversation_tags ct
        WHERE ct.conversation_id = cp.id
      ) e
      JOIN public.tags t ON t.id = e.tag_id AND t.organization_id = p_org
      ORDER BY t.id, e.origem
    ) x
  ) et ON true
  WHERE cp.deleted_at IS NULL
  ORDER BY p.last_message_time DESC, p.box DESC, p.normalized_phone DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid[], text[], uuid[], text[], uuid, boolean, text, boolean, boolean, boolean, text, boolean, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamp with time zone, uuid[], text[], uuid[], text[], uuid, boolean, text, boolean, boolean, boolean, text, boolean, uuid, text) TO authenticated;

-- ── FORMA DE PROD: public.* → private.* nas 8 relações do recorte strict ──
-- Idêntico a 20280119040000 (mesmas trocas, mesma falha fechada); contagem
-- esperada 36 (35 + a leitura do resumo do nome salvo). Ver o cabeçalho daquela migration.
DO $troca$
DECLARE
  v_sig regprocedure := 'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)'::regprocedure;
  v_rels text[] := ARRAY[
    'conversation_read_state', 'conversations', 'lead_tags', 'leads',
    'pipeline_entries', 'whatsapp_conversation_summary', 'whatsapp_conversations',
    'whatsapp_messages'
  ];
  v_esperado constant integer := 36;
  v_guarda constant text := 'to_regprocedure(''private.jrtex_pipeline_scoped()'') IS NOT NULL';
  -- Ramo da Karine (hotfix de prod fora do ledger): no repo o corpo traz o
  -- marcador com false; em prod ele vira a chamada real, idêntica ao corpo vivo.
  v_karine_marca constant text := '/*KARINE_ORPHAN*/ false';
  v_karine_orfao constant text := $k$private.jrtex_karine_orphan_chat(v_uid, p_org, NULL::uuid, s.normalized_phone)
                  AND NOT EXISTS (
                    SELECT 1 FROM private.lead_phones lp
                    JOIN private.leads l ON l.id = lp.lead_id AND l.organization_id = lp.organization_id
                    WHERE lp.organization_id = p_org
                      AND lp.normalized_phone = s.normalized_phone
                      AND lp.deleted_at IS NULL
                      AND l.deleted_at IS NULL
                  )$k$;
  v_trocas integer;
  v_def text;
  v_rel text;
  v_faltando text[];
  v_sobra integer;
  v_private integer;
BEGIN
  IF to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(r ORDER BY r) INTO v_faltando
    FROM unnest(v_rels || ARRAY['lead_phones']) AS r
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relname = r AND c.relkind = 'v');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'forma de prod incompleta: strict instalado, mas faltam as views private.% — abortado para não ler sem o recorte',
      array_to_string(v_faltando, ', private.');
  END IF;

  SELECT array_agg(f ORDER BY f) INTO v_faltando
    FROM unnest(ARRAY['private.jrtex_pipeline_scoped()',
                      'private.jrtex_visible_pipeline_ids()',
                      'private.riofix_balcao_current_scope()',
                      'private.jrtex_karine_orphan_chat(uuid,uuid,uuid,text)']) AS f
   WHERE to_regprocedure(f) IS NULL;
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'forma de prod incompleta: strict instalado, mas faltam % — abortado para o escopo não abrir em silêncio',
      array_to_string(v_faltando, ', ');
  END IF;

  v_def := pg_get_functiondef(v_sig);
  v_trocas := (length(v_def) - length(replace(v_def, v_guarda, ''))) / length(v_guarda);
  IF v_trocas <> 1 THEN
    RAISE EXCEPTION 'forma de prod divergente: guarda do escopo JR Tex aparece % vez(es) (esperado 1)', v_trocas;
  END IF;
  v_def := replace(v_def, v_guarda, 'true');
  IF (length(v_def) - length(replace(v_def, v_karine_marca, ''))) / length(v_karine_marca) <> 1 THEN
    RAISE EXCEPTION 'forma de prod divergente: marcador do ramo da Karine não aparece exatamente 1 vez';
  END IF;
  v_def := replace(v_def, v_karine_marca, v_karine_orfao);
  FOREACH v_rel IN ARRAY v_rels LOOP
    v_def := regexp_replace(v_def, 'public\.' || v_rel || '\M', 'private.' || v_rel, 'g');
  END LOOP;
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_sig);
  SELECT count(*) INTO v_sobra
    FROM regexp_matches(v_def, 'public\.(' || array_to_string(v_rels, '|') || ')\M', 'g');
  SELECT count(*) INTO v_private FROM regexp_matches(v_def, 'private\.', 'g');
  IF position(v_guarda IN v_def) > 0 THEN
    RAISE EXCEPTION 'forma de prod divergente: guarda do escopo JR Tex sobreviveu à troca';
  END IF;
  IF position(v_karine_marca IN v_def) > 0 THEN
    RAISE EXCEPTION 'forma de prod divergente: marcador do ramo da Karine sobreviveu à troca';
  END IF;
  IF v_sobra <> 0 OR v_private <> v_esperado THEN
    RAISE EXCEPTION 'forma de prod divergente: % referência(s) public.* às 8 relações e % private.* (esperado 0 e %)',
      v_sobra, v_private, v_esperado;
  END IF;
END
$troca$;


-- ACL depois da troca (EXECUTE do CREATE OR REPLACE da forma de prod preserva).
DO $acl$
BEGIN
  IF (SELECT p.proacl::text FROM pg_catalog.pg_proc p
       WHERE p.oid = to_regprocedure('public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamp with time zone,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean,uuid,text)'))
     IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION 'ACL divergente em get_whatsapp_conversation_list_multi depois do DROP+CREATE';
  END IF;
END
$acl$;

NOTIFY pgrst, 'reload schema';
