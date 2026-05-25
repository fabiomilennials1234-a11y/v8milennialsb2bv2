-- supabase/migrations/20261102000003_meta_conversations_backfill.sql

-- Idempotent: replays helper for every existing meta channel message in
-- chronological order, leveraging ON CONFLICT to keep latest state.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT *
      FROM channel_messages
     WHERE channel IN ('messenger', 'instagram')
     ORDER BY timestamp ASC
  LOOP
    PERFORM apply_channel_message_to_meta_conversation(
      r.organization_id,
      r.channel,
      r.page_id,
      r.sender_id,
      r.direction,
      r.content,
      r.message_type,
      r.timestamp,
      r.lead_id
    );
  END LOOP;
END $$;

-- Historical unread state is unrecoverable from channel_messages alone
-- (no read receipts in the table). Reset every backfilled conversation to
-- zero so users start with a clean badge state post-deploy.
UPDATE meta_conversations
   SET unread_count = 0;
