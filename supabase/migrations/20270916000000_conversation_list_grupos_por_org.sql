-- ============================================================================
-- A ABA DE GRUPOS volta, por org: `p_include_groups` na lista do chat
--
-- Desde #1632 a lista recusa grupo em TODA camada — aqui (`s.is_group = false`,
-- antes do LIMIT), no engine do cliente e no caminho de escape. A recusa era
-- incondicional de proposito. Esta migration a torna PARAMETRIZADA, e o default
-- do parametro e `false`: quem chamar como hoje recebe exatamente a lista de
-- hoje, byte a byte.
--
-- Quem liga: `organizations.feature_flags -> chat_abas_de_grupos`, lida no
-- front. Decisao do CTO em 2026-09-02 — entrega por org, comecando pela
-- Cafe Jurere (4922638c-4909-494e-ba10-12282ec0b161).
--
-- ⚠️ ASSINATURA NOVA, ENTAO `DROP` ANTES DO `CREATE`. Parametro adicional cria
--    uma SEGUNDA funcao (overload) em vez de substituir a primeira, e o
--    PostgREST responde `PGRST203` (nao consegue escolher a candidata) para
--    TODA chamada da lista — o inbox inteiro morre, nao so o grupo. O DROP e a
--    parte perigosa desta migration: entre ele e o CREATE, a lista nao existe.
--    Rodar os dois na MESMA transacao (o `db push` ja faz isso por arquivo).
--
-- ⚠️ O corpo abaixo e o de `20270819100000_conversation_list_respeita_isolamento`
--    (isolamento por responsavel, #1629) com TRES mudancas, marcadas no texto
--    com `-- [grupos]`. Se prod tiver uma definicao mais nova que o repo — o
--    ledger e o repo NAO batem 1:1, ver CLAUDE.md raiz — este arquivo a
--    SOBRESCREVE. Antes de aplicar, comparar:
--       SELECT pg_get_functiondef('public.get_whatsapp_conversation_list'::regproc);
--
-- ⚠️ DROP+CREATE devolve os grants ao default do schema (PUBLIC e `anon`
--    ganham EXECUTE de novo). O REVOKE no fim do arquivo restaura o conjunto
--    exato — mesma licao de `20260727140438_inbox_filter_grants_tighten`.
--
-- Ordem de entrega, e nao ha atalho: (1) esta migration em prod, (2) deploy do
-- front, (3) ligar a flag na org. Invertendo (1) e (2) o front pede um
-- parametro que nao existe e leva `PGRST202` — o hook tem queda para a chamada
-- antiga, entao a lista sobrevive sem grupo, mas a aba nasceria vazia.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_whatsapp_conversation_list(
  uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean,
  text, boolean, boolean, boolean, text
);

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(p_org uuid, p_instance uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false)
 RETURNS TABLE(phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  -- Instances do chip: a atual mais as já apagadas do mesmo número.
  v_ids uuid[];
  -- Isolamento por responsavel (#1629). Resolvido UMA vez, nao por linha: o
  -- que varia por conversa e so o EXISTS contra `leads`, indexado por
  -- (organization_id, normalized_phone).
  v_iso_on        boolean;
  v_iso_bypass    boolean;
  v_iso_tm        uuid;
  v_iso_unassign  boolean;
  -- Mesmos ids em texto: a chave de leitura é string, não uuid.
  v_keys text[];
BEGIN
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  --
  -- O `NOT EXISTS`/`COALESCE` aqui é endurecimento DELIBERADO de um gate que já
  -- existia (esta função é reescrita por esta migration, então o furo passaria a
  -- ser nosso): `NOT (x IN (lista com NULL))` devolve NULL, e `IF NULL THEN` não
  -- dispara — gate aberto em vez de erro. Mesma correção aplicada em
  -- `whatsapp_chip_instance_ids`, onde o risco é maior por guardar uma tabela
  -- RLS deny-all. Comportamento inalterado para qualquer entrada não-NULL.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;
  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  -- Depois do gate: a resolução do chip só roda para org já autorizada. O gate
  -- interno de whatsapp_chip_instance_ids reavalia o mesmo `p_org` no mesmo
  -- contexto de sessão (auth.uid()/auth.role() não mudam ao entrar numa função
  -- SECURITY DEFINER), então quem passou aqui passa lá — a checagem dobrada é
  -- redundância deliberada, não risco de falso negativo.
  v_ids  := whatsapp_chip_instance_ids(p_org, p_instance);
  v_keys := ARRAY(SELECT t.id::text FROM unnest(v_ids) AS t(id));

  -- ── Isolamento por responsavel ─────────────────────────────────────────
  -- Esta funcao e SECURITY DEFINER, entao o RLS de whatsapp_messages NAO se
  -- aplica aqui. Sem este bloco a politica fica decorativa: a tabela fica
  -- fechada e a LISTA -- que e o que o usuario ve -- continua mostrando tudo.
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
      public.is_master_user()
      OR public.is_user_admin()
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

  RETURN QUERY
  WITH read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1
  ),
  unread AS (
    SELECT m.normalized_phone AS np, count(*)::integer AS cnt
    FROM whatsapp_messages m
    LEFT JOIN read_state r ON r.np = m.normalized_phone
    WHERE m.organization_id = p_org AND m.instance_id = ANY(v_ids)
      -- [grupos] mesma porta do `chip`: sem o parametro, o conjunto de mensagens
      -- contadas e identico ao de hoje. Com ele, a aba de grupos mostra badge de
      -- nao-lida em vez de uma lista muda.
      AND m.direction = 'incoming' AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
    GROUP BY m.normalized_phone
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at,
           c.instance_id, c.created_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = ANY(v_ids)
      AND c.normalized_phone IS NOT NULL
  ),
  -- Uma linha por telefone. Prioriza a Instance viva: arquivar/apagar a thread
  -- é ato do usuário no chip de hoje, e é essa decisão que deve valer.
  conv_pick AS (
    SELECT DISTINCT ON (c2.np) c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.np, (c2.instance_id = p_instance) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  -- O chip inteiro, colapsado por telefone antes de qualquer filtro.
  chip AS (
    SELECT DISTINCT ON (s.normalized_phone)
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = ANY(v_ids)
      -- [grupos] O recorte continua AQUI, antes do LIMIT e antes de trafegar:
      -- grupo e 978.756 de 2.472.395 mensagens (40%), e baixar tudo para
      -- descartar no navegador foi o custo que #1632 matou. A diferenca e que
      -- agora quem paga esses 40% e so a org que pediu a aba.
      AND (p_include_groups OR s.is_group = false)
      -- Mesma regra do predicado can_see_chat_scope, escrita aqui para caber
      -- num unico EXISTS por conversa em vez de tres lookups por linha.
      AND (
        v_iso_bypass
        -- [grupos] GRUPO NAO TEM DONO. O EXISTS abaixo casa a conversa com um
        -- `leads.normalized_phone`, e o jid de grupo nunca e telefone de lead —
        -- entao, com o isolamento ligado, TODO grupo cairia fora e a aba nasceria
        -- vazia para o vendedor. Uma conversa sem responsavel e exatamente o que
        -- `leads.view_unassigned` governa, e e essa a chave usada aqui: quem ve
        -- nao-atribuido ve grupo; quem nao ve, nao ve. Nao inventa excecao nova.
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
    ORDER BY s.normalized_phone, s.last_message_time DESC
  ),
  -- Pré-filtro ANTES do LIMIT: é isto que faz o filtro enxergar a base inteira.
  page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
    FROM chip s
    WHERE (p_before IS NULL OR s.last_message_time < p_before)

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lead_id IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lead_id IS NULL)
      )

      AND (
        p_unread IS NOT TRUE
        OR EXISTS (SELECT 1 FROM unread u WHERE u.np = s.normalized_phone AND u.cnt > 0)
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lead_id
                AND cv.state = 'WAITING_HUMAN'))
      )

      -- `qualification_tier` é ENUM: o cast pro texto permite comparar com o
      -- array de strings da UI — valor desconhecido vira "não casa", não erro.
      AND (
        p_tiers IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lead_id IS NULL
        OR EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      AND (
        p_tags IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM lead_tags lt
              WHERE lt.lead_id = s.lead_id AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.np = s.normalized_phone AND ct.tag_id = ANY(p_tags))
      )
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  )
  SELECT p.phone_number, p.normalized_phone, p.last_push_name, p.last_message, p.last_message_time,
         p.last_message_direction, p.last_message_sent_source, p.lead_id, p.is_group,
         conv.id, conv.archived_at, coalesce(u.cnt, 0)
  FROM page p
  LEFT JOIN conv_pick conv ON conv.np = p.normalized_phone
  LEFT JOIN unread u ON u.np  = p.normalized_phone
  WHERE conv.deleted_at IS NULL
  ORDER BY p.last_message_time DESC;
END;
$function$;

-- Terminador explícito: `pg_get_functiondef` não emite `;`. Sem ele o
-- arquivo funciona sozinho e QUEBRA quando concatenado com o próximo — foi
-- assim que o ensaio transacional contra prod falhou na primeira tentativa.

-- ── Grants: restaurar o conjunto exato de antes do DROP ─────────────────────
-- O CREATE reconcede EXECUTE a PUBLIC (default do Postgres) e a `anon` (default
-- privilege do Supabase no schema public). Não há vazamento — a função é
-- SECURITY DEFINER e o gate exige team_member ativo da org ou master, então
-- `anon` só recebe 42501 — mas EXECUTE para quem nunca passa do gate é
-- superfície gratuita: qualquer regressão futura no gate vira exploração sem
-- autenticação. Mesma correção de `20260727140438_inbox_filter_grants_tighten`,
-- agora com a assinatura de 16 argumentos.
REVOKE EXECUTE ON FUNCTION public.get_whatsapp_conversation_list(
  uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean,
  text, boolean, boolean, boolean, text, boolean
) FROM PUBLIC, anon;

-- Conferência pós-apply (rodar à mão; `role_table_grants` mente por omissão):
--   SELECT proacl FROM pg_proc
--    WHERE oid = 'public.get_whatsapp_conversation_list'::regproc;
-- Esperado: {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- E que exista UMA só: overload sobrevivente devolve PGRST203 na tela.
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list';
-- Esperado: 1
