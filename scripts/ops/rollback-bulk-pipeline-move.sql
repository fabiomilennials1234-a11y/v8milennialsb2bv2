-- Revert the frontend first. Preserve backup data and existing valid movement
-- history. NOT VALID preserves cross-funnel events already recorded while
-- restoring the previous restriction for subsequent writes.
DROP FUNCTION IF EXISTS public.bulk_move_pipeline_entries(uuid[],uuid,uuid,uuid);
ALTER TABLE public.pipeline_stage_events DROP CONSTRAINT pipeline_stage_events_real_transition;
ALTER TABLE public.pipeline_stage_events ADD CONSTRAINT pipeline_stage_events_real_transition
  CHECK (from_stage_key IS DISTINCT FROM to_stage_key) NOT VALID;
