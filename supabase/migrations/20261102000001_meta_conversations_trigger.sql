-- supabase/migrations/20261102000001_meta_conversations_trigger.sql

-- Helper extracted so backfill can reuse exact same logic
CREATE OR REPLACE FUNCTION apply_channel_message_to_meta_conversation(
  p_organization_id uuid,
  p_channel text,
  p_page_id text,
  p_sender_id text,
  p_direction text,
  p_content text,
  p_message_type text,
  p_timestamp timestamptz,
  p_lead_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_page_uuid uuid;
BEGIN
  IF p_channel NOT IN ('messenger', 'instagram') THEN
    RETURN;
  END IF;

  SELECT id INTO v_page_uuid
    FROM meta_pages
   WHERE organization_id = p_organization_id
     AND page_id = p_page_id
   LIMIT 1;

  IF v_page_uuid IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO meta_conversations (
    organization_id, meta_page_id, channel, external_user_id,
    last_message_at, last_message_preview, last_message_direction,
    last_inbound_at, unread_count, lead_id
  ) VALUES (
    p_organization_id, v_page_uuid, p_channel, p_sender_id,
    p_timestamp,
    LEFT(COALESCE(p_content, '[' || p_message_type || ']'), 200),
    p_direction,
    CASE WHEN p_direction = 'incoming' THEN p_timestamp ELSE NULL END,
    CASE WHEN p_direction = 'incoming' THEN 1 ELSE 0 END,
    p_lead_id
  )
  ON CONFLICT (organization_id, channel, meta_page_id, external_user_id)
  DO UPDATE SET
    last_message_at = GREATEST(meta_conversations.last_message_at, EXCLUDED.last_message_at),
    last_message_preview = EXCLUDED.last_message_preview,
    last_message_direction = EXCLUDED.last_message_direction,
    last_inbound_at = CASE
      WHEN p_direction = 'incoming'
        THEN GREATEST(COALESCE(meta_conversations.last_inbound_at, p_timestamp), p_timestamp)
      ELSE meta_conversations.last_inbound_at
    END,
    unread_count = CASE
      WHEN p_direction = 'incoming' THEN meta_conversations.unread_count + 1
      ELSE meta_conversations.unread_count
    END,
    lead_id = COALESCE(EXCLUDED.lead_id, meta_conversations.lead_id),
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION upsert_meta_conversation_trigger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM apply_channel_message_to_meta_conversation(
    NEW.organization_id,
    NEW.channel,
    NEW.page_id,
    NEW.sender_id,
    NEW.direction,
    NEW.content,
    NEW.message_type,
    NEW.timestamp,
    NEW.lead_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meta_conv_upsert ON channel_messages;
CREATE TRIGGER trg_meta_conv_upsert
  AFTER INSERT ON channel_messages
  FOR EACH ROW EXECUTE FUNCTION upsert_meta_conversation_trigger();
