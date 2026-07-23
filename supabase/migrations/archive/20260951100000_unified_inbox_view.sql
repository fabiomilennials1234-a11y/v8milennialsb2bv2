-- Wave 2.2b — Unified Inbox View (separate transaction so enum values are committed)

CREATE OR REPLACE VIEW unified_inbox_messages AS
(
  SELECT
    cm.id,
    cm.organization_id,
    cm.lead_id,
    cm.channel,
    cm.direction,
    cm.content,
    cm.media_url,
    cm.message_type,
    cm.sender_name,
    cm.sender_profile_pic,
    cm.timestamp AS sent_at,
    cm.phone_number,
    NULL::uuid AS email_id,
    cm.external_id AS external_ref
  FROM channel_messages cm
)
UNION ALL
(
  SELECT
    e.id,
    e.organization_id,
    e.lead_id,
    'email'::channel_type AS channel,
    CASE WHEN e.is_outbound THEN 'outbound' ELSE 'inbound' END AS direction,
    COALESCE(e.snippet, LEFT(e.body_text, 200)) AS content,
    NULL AS media_url,
    'text' AS message_type,
    COALESCE(e.from_name, e.from_address) AS sender_name,
    NULL AS sender_profile_pic,
    e.sent_at,
    NULL AS phone_number,
    e.id AS email_id,
    e.message_id AS external_ref
  FROM emails e
);

CREATE OR REPLACE FUNCTION get_unified_conversations(
  p_channel text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_email text,
  channel text,
  last_message text,
  last_direction text,
  last_sender text,
  last_sent_at timestamptz,
  unread_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      uim.lead_id,
      uim.channel::text,
      uim.content,
      uim.direction,
      uim.sender_name,
      uim.sent_at,
      ROW_NUMBER() OVER (PARTITION BY uim.lead_id, uim.channel ORDER BY uim.sent_at DESC) AS rn
    FROM unified_inbox_messages uim
    WHERE uim.organization_id IN (
      SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
    AND (p_channel IS NULL OR uim.channel::text = p_channel)
    AND uim.lead_id IS NOT NULL
  )
  SELECT
    r.lead_id,
    l.name AS lead_name,
    l.phone AS lead_phone,
    l.email AS lead_email,
    r.channel,
    r.content AS last_message,
    r.direction AS last_direction,
    r.sender_name AS last_sender,
    r.sent_at AS last_sent_at,
    0::bigint AS unread_count
  FROM ranked r
  JOIN leads l ON l.id = r.lead_id
  WHERE r.rn = 1
  ORDER BY r.sent_at DESC
  LIMIT p_limit;
END;
$$;
