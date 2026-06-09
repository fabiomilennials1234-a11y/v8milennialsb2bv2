-- 20260608000002_followup_step_log_situation_ref.sql
-- Copilot Follow-up restructure (ADR-0006). Let the cadence step-log track
-- situation-based cadences (owned by situation_config) alongside the legacy
-- per-rule cadences. Exactly one owner per row.

ALTER TABLE public.copilot_followup_step_log
  ALTER COLUMN rule_id DROP NOT NULL;

ALTER TABLE public.copilot_followup_step_log
  ADD COLUMN IF NOT EXISTS situation_config_id uuid
  REFERENCES public.copilot_followup_situation_config(id) ON DELETE CASCADE;

ALTER TABLE public.copilot_followup_step_log
  DROP CONSTRAINT IF EXISTS copilot_followup_step_log_owner_check;
ALTER TABLE public.copilot_followup_step_log
  ADD CONSTRAINT copilot_followup_step_log_owner_check
  CHECK (num_nonnulls(rule_id, situation_config_id) = 1);

CREATE INDEX IF NOT EXISTS idx_followup_step_log_situation_active
  ON public.copilot_followup_step_log (situation_config_id, lead_id, completed)
  WHERE NOT completed AND situation_config_id IS NOT NULL;

COMMENT ON COLUMN public.copilot_followup_step_log.situation_config_id IS
  'Owning situation config for situation-based cadences (ADR-0006). Mutually exclusive with rule_id (legacy).';
