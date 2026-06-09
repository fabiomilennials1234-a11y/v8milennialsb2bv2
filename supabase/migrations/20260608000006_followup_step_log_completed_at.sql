-- 20260608000006_followup_step_log_completed_at.sql
-- Add completed_at to the cadence step-log so a stopped cadence records when it
-- ended (any completed_reason). ADR-0006 — used by the Stop Evaluator wiring and
-- the legacy response detector.

ALTER TABLE public.copilot_followup_step_log
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMENT ON COLUMN public.copilot_followup_step_log.completed_at IS
  'When the cadence was completed/stopped (any completed_reason). ADR-0006.';
