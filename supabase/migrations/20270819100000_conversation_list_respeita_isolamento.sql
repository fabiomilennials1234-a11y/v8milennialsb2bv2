-- ============================================================================
-- A LISTA do chat tambem respeita o isolamento (PRD #1629)
--
-- get_whatsapp_conversation_list e SECURITY DEFINER: o RLS de
-- whatsapp_messages NAO se aplica dentro dela. Com a tabela fechada e o RPC
-- aberto, a politica ficava DECORATIVA -- o vendedor continuava vendo o inbox
-- inteiro na tela.
--
-- Encontrado com Playwright contra o app rodando, com a suite de integracao
-- inteira verde: os testes liam `whatsapp_messages`, e o produto nao le essa
-- tabela para montar a lista.
--
-- As constantes (politica ligada? admin? excecao nominal? ve nao-atribuidos?)
-- sao resolvidas UMA vez no topo; por conversa sobra um EXISTS contra `leads`,
-- indexado por (organization_id, normalized_phone) -- o mesmo formato de
-- preview_chat_restriction, medido em 46,7 ms na maior org de producao.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(p_org uuid, p_instance uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text)
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
      AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
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
      -- Grupo sai do produto (#1632). O recorte e AQUI, antes do LIMIT e antes
      -- de trafegar: grupo e 978.756 de 2.472.395 mensagens (40%), e o cliente
      -- baixava tudo para descartar no navegador.
      AND s.is_group = false
      -- Mesma regra do predicado can_see_chat_scope, escrita aqui para caber
      -- num unico EXISTS por conversa em vez de tres lookups por linha.
      AND (
        v_iso_bypass
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
$function$


