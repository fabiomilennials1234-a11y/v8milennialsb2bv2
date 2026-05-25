-- supabase/migrations/20261102000002_meta_conversations_rpcs.sql

CREATE OR REPLACE FUNCTION mark_meta_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org uuid;
  v_channel text;
  v_page_id text;
  v_sender_id text;
BEGIN
  SELECT mc.organization_id, mc.channel, mp.page_id, mc.external_user_id
    INTO v_org, v_channel, v_page_id, v_sender_id
    FROM meta_conversations mc
    JOIN meta_pages mp ON mp.id = mc.meta_page_id
   WHERE mc.id = p_conversation_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'conversation_not_found';
  END IF;

  IF v_org NOT IN (SELECT get_my_organization_ids()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE meta_conversations
     SET unread_count = 0, updated_at = now()
   WHERE id = p_conversation_id;

  UPDATE channel_messages
     SET status = 'read'
   WHERE organization_id = v_org
     AND channel = v_channel
     AND page_id = v_page_id
     AND sender_id = v_sender_id
     AND direction = 'incoming'
     AND status <> 'read';
END;
$$;

GRANT EXECUTE ON FUNCTION mark_meta_conversation_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION link_meta_conversation_to_lead(
  p_conversation_id uuid,
  p_lead_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org uuid;
  v_channel text;
  v_page_id text;
  v_sender_id text;
  v_lead_org uuid;
BEGIN
  SELECT mc.organization_id, mc.channel, mp.page_id, mc.external_user_id
    INTO v_org, v_channel, v_page_id, v_sender_id
    FROM meta_conversations mc
    JOIN meta_pages mp ON mp.id = mc.meta_page_id
   WHERE mc.id = p_conversation_id;

  IF v_org IS NULL THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
  IF v_org NOT IN (SELECT get_my_organization_ids()) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT organization_id INTO v_lead_org FROM leads WHERE id = p_lead_id;
  IF v_lead_org IS NULL THEN RAISE EXCEPTION 'lead_not_found'; END IF;
  IF v_lead_org <> v_org THEN RAISE EXCEPTION 'lead_org_mismatch'; END IF;

  UPDATE meta_conversations
     SET lead_id = p_lead_id, updated_at = now()
   WHERE id = p_conversation_id;

  UPDATE channel_messages
     SET lead_id = p_lead_id
   WHERE organization_id = v_org
     AND channel = v_channel
     AND page_id = v_page_id
     AND sender_id = v_sender_id
     AND lead_id IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION link_meta_conversation_to_lead(uuid, uuid) TO authenticated;
