-- Add completion_notes for capturing context when completing a follow-up
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS completion_notes text;

COMMENT ON COLUMN follow_ups.completion_notes IS 'Optional notes added when completing the follow-up';
