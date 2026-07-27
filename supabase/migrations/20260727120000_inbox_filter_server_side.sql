-- 20260727120000_inbox_filter_server_side.sql
--
-- Issue #1277 — o filtro do inbox WhatsApp só enxergava as 500 conversas mais
-- recentes: o recorte era 100% client-side, aplicado DEPOIS do LIMIT da RPC.
-- Qualquer dimensão de cauda longa (etapa fria, tag antiga, arquivadas) sumia em
-- silêncio. Medido na Goletric Pinheiros: as 27 conversas em "Qualificando"
-- ocupavam as posições 507–869 do ranking por recência — nenhuma entrava na página.
--
-- Aqui a RPC passa a receber as dimensões do filtro e aplicá-las ANTES do LIMIT.
-- O engine client-side (`applyInboxFilters`) continua rodando por cima com a
-- mesma semântica: o servidor é um SUPERCONJUNTO (pré-filtro), o cliente refina.
-- Essa direção é deliberada — se as duas camadas divergirem, o cliente corta a
-- mais, nunca deixa passar a menos.
--
-- Semântica espelhada de src/modules/communication/lib/inboxFilter.ts:
--   - AND entre dimensões, OR dentro da dimensão.
--   - Etapa respeita o funil escolhido (lead pode estar em vários pipes).
--   - Tag casa em tag do LEAD ou tag da CONVERSA (o cliente une as duas).
--   - "Fonte": humano = 'manual'; IA = 'copilot' | 'workflow'.
--   - "Pediu atendente" = conversations.state = 'WAITING_HUMAN'.
--   - Vendedor = leads.responsible_id ("sem vendedor" inclui conversa sem lead).
--
-- Fica FORA de propósito a aba ativas/arquivadas: os dois contadores da UI saem
-- da mesma lista carregada, então filtrar a aba aqui zeraria o contador da outra.
-- Segue no cliente, coberto pelo teto de página maior.
--
-- Todos os parâmetros novos são DEFAULT NULL = dimensão inativa, então a chamada
-- de 3 argumentos que já existe no front segue idêntica. O DROP é necessário
-- porque acrescentar parâmetros a uma função existente cria sobrecarga e torna a
-- chamada antiga ambígua.

DROP FUNCTION IF EXISTS public.get_whatsapp_conversation_list(uuid, uuid, integer, timestamptz);

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(
  p_org uuid,
  p_instance uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL,
  -- ── Dimensões do filtro do inbox (NULL/false = inativa) ───────────────────
  p_funnels uuid[] DEFAULT NULL,         -- pipeline_ids (OR)
  p_stages text[] DEFAULT NULL,          -- stage_keys (OR), respeitando p_funnels
  p_tags uuid[] DEFAULT NULL,            -- tag ids (OR), lead OU conversa
  p_tiers text[] DEFAULT NULL,           -- leads.qualification_tier (OR)
  p_vendor_id uuid DEFAULT NULL,         -- leads.responsible_id
  p_unassigned boolean DEFAULT NULL,     -- true = sem vendedor
  p_lead_presence text DEFAULT NULL,     -- 'com' | 'sem'
  p_needs_human boolean DEFAULT NULL,    -- true = lead na fila de handoff da IA
  p_unread boolean DEFAULT NULL,         -- true = só não lidas
  p_waiting boolean DEFAULT NULL,        -- true = última mensagem foi do lead
  p_source text DEFAULT NULL             -- 'ia' | 'humano'
)
RETURNS TABLE(
  phone_number text,
  normalized_phone text,
  push_name text,
  last_message text,
  last_message_time timestamptz,
  last_message_direction text,
  last_message_sent_source text,
  lead_id uuid,
  is_group boolean,
  conversation_id uuid,
  archived_at timestamptz,
  unread_count integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  IF p_org IS NULL OR (NOT (p_org IN (SELECT get_my_organization_ids())) AND NOT is_master_user()) THEN
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

  RETURN QUERY
  WITH read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np, rs.last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:' || p_instance::text || ':%'
  ),
  unread AS (
    SELECT m.normalized_phone AS np, count(*)::integer AS cnt
    FROM whatsapp_messages m
    LEFT JOIN read_state r ON r.np = m.normalized_phone
    WHERE m.organization_id = p_org AND m.instance_id = p_instance
      AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
    GROUP BY m.normalized_phone
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = p_instance AND c.normalized_phone IS NOT NULL
  ),
  -- Pré-filtro ANTES do LIMIT: é isto que faz o filtro enxergar a base inteira.
  page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = p_instance
      AND (p_before IS NULL OR s.last_message_time < p_before)

      -- Dimensões que vivem na própria linha-resumo (custo zero).
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

      -- Não lidas: reaproveita a agregação que a RPC já faz de qualquer forma.
      AND (
        p_unread IS NOT TRUE
        OR EXISTS (SELECT 1 FROM unread u WHERE u.np = s.normalized_phone AND u.cnt > 0)
      )

      -- Fila de handoff da IA.
      AND (
        p_needs_human IS NOT TRUE
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lead_id
                AND cv.state = 'WAITING_HUMAN'))
      )

      -- Qualificação do lead. `qualification_tier` é ENUM: o cast pro texto é
      -- que permite comparar com o array de strings que vem da UI — e um valor
      -- desconhecido vira "não casa" em vez de erro de tipo em runtime.
      AND (
        p_tiers IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      -- Vendedor: responsável do lead. "Sem vendedor" inclui conversa sem lead.
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

      -- Funil (pipeline_id) — unifica pipes de sistema e custom.
      AND (
        p_funnels IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      -- Etapa — só conta dentro dos funis selecionados, quando houver.
      AND (
        p_stages IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      -- Tags: do lead OU da conversa (o cliente exibe as duas fundidas).
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
  LEFT JOIN conv   ON conv.np = p.normalized_phone
  LEFT JOIN unread u ON u.np  = p.normalized_phone
  WHERE conv.deleted_at IS NULL
  ORDER BY p.last_message_time DESC;
END;
$function$;

-- DROP apaga os grants junto — recriar exatamente os que existiam.
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversation_list(
  uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean,
  text, boolean, boolean, boolean, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_whatsapp_conversation_list(
  uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean,
  text, boolean, boolean, boolean, text
) IS
  'Lista de conversas do inbox WhatsApp com pré-filtro server-side aplicado antes do LIMIT (issue #1277). '
  'Espelha a semântica de src/modules/communication/lib/inboxFilter.ts; o filtro do cliente roda por cima e refina.';
