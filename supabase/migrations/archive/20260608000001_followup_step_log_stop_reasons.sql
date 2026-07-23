-- 20260608000001_followup_step_log_stop_reasons.sql
-- Copilot Follow-up restructure (ADR-0006). Extend the cadence step-log
-- completed_reason with the new stop causes wired by the Stop Evaluator (#737):
-- human_replied (owning human took over), situation_resolved (e.g. stage left
-- the trigger set), owner_changed (Archetype handoff).
--
-- Depends on copilot_followup_step_log (20261028000000_followup_cadence_schema).

ALTER TABLE public.copilot_followup_step_log
  DROP CONSTRAINT IF EXISTS copilot_followup_step_log_completed_reason_check;

ALTER TABLE public.copilot_followup_step_log
  ADD CONSTRAINT copilot_followup_step_log_completed_reason_check
  CHECK (completed_reason IN (
    'all_steps_done',
    'lead_responded',
    'manual_stop',
    'human_replied',
    'situation_resolved',
    'owner_changed'
  ));
