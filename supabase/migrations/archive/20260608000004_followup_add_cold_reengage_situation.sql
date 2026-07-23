-- 20260608000004_followup_add_cold_reengage_situation.sql
-- Add the 7th canonical Follow-up Situation: cold_reengage (re-warm leads parked
-- in nurture/holding stages). ADR-0006 amendment.

ALTER TABLE public.copilot_followup_situation_config
  DROP CONSTRAINT IF EXISTS copilot_followup_situation_config_situation_check;

ALTER TABLE public.copilot_followup_situation_config
  ADD CONSTRAINT copilot_followup_situation_config_situation_check
  CHECK (situation_id IN (
    'new_lead_no_reply',
    'qualified_no_meeting',
    'cold_reengage',
    'meeting_reminder',
    'no_show_rebook',
    'proposal_no_reply',
    'dormant_winback'
  ));
