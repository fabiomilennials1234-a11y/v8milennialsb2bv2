-- ROLLBACK de 20260727120000_inbox_filter_server_side.sql (issue #1277)
--
-- Restaura a assinatura de 4 parâmetros e o corpo sem pré-filtro. Depois disto o
-- filtro do inbox volta a enxergar só a página carregada (o bug original) — o
-- front continua funcionando porque manda os parâmetros novos apenas quando há
-- filtro ativo, mas essas chamadas passam a falhar com "function does not exist".
-- Rodar junto com o revert do front, nunca isolado.

BEGIN;

DROP FUNCTION IF EXISTS public.get_whatsapp_conversation_list(
  uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean,
  text, boolean, boolean, boolean, text
);

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(
  p_org uuid,
  p_instance uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
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

  RETURN QUERY
  WITH page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = p_instance
      AND (p_before IS NULL OR s.last_message_time < p_before)
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  ),
  read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np, rs.last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:' || p_instance::text || ':%'
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = p_instance AND c.normalized_phone IS NOT NULL
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

GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversation_list(uuid, uuid, integer, timestamptz)
  TO authenticated, service_role;

COMMIT;
