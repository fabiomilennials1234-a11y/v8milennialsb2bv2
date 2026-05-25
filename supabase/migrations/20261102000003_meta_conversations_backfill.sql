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

-- Sanity: backfilled unread_count may be inflated (we incremented per inbound
-- without considering subsequent reads). Reset unread_count for all rows where
-- the most recent message is outgoing (best-effort heuristic for backfill).
UPDATE meta_conversations
   SET unread_count = 0
 WHERE last_message_direction = 'outgoing';
