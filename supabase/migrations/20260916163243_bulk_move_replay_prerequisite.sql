-- Replay prerequisite: 20260916163244_bulk_move_existing_pipeline_entries
-- reads this column in its transition constraint, but its historical producer
-- 20271019000007_deal_transfer_history sorts later than that consumer.
-- This new migration intentionally sorts immediately before the consumer so
-- fresh installations can replay both original files unchanged. Where the
-- column already exists, keep its values, constraints, grants and RLS intact.
ALTER TABLE public.pipeline_stage_events
  ADD COLUMN IF NOT EXISTS from_pipeline_id uuid;
