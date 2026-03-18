-- Fix: conversation_summaries needs UNIQUE constraint on lead_id
-- for the upsert in summarize-conversation edge function to work.

-- Remove duplicates keeping the most recent per lead
DELETE FROM conversation_summaries
WHERE id NOT IN (
  SELECT DISTINCT ON (lead_id) id
  FROM conversation_summaries
  ORDER BY lead_id, updated_at DESC
);

-- Add UNIQUE constraint
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_conversation_summaries_lead_unique
  ON conversation_summaries(lead_id);
