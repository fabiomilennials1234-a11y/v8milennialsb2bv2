-- 20261028000000_followup_cadence_schema.sql
-- Adds cadence/sequence support to follow-up rules and a step execution log.
-- Backwards compatible: NULL sequence_steps = single-shot rule (existing behavior).

-- =====================================================
-- 1. ADD sequence_steps COLUMN to existing rules table
-- =====================================================

ALTER TABLE public.copilot_agent_followup_rules
  ADD COLUMN sequence_steps jsonb DEFAULT NULL;

COMMENT ON COLUMN public.copilot_agent_followup_rules.sequence_steps IS
  'Array of cadence steps: [{order, delay_hours, delay_minutes, style, message_template}]. NULL = single-shot rule.';

-- =====================================================
-- 2. EXPAND trigger_type CHECK constraint
-- =====================================================

-- Drop existing constraint if any (original table had no CHECK, but guard anyway)
ALTER TABLE public.copilot_agent_followup_rules
  DROP CONSTRAINT IF EXISTS copilot_agent_followup_rules_trigger_type_check;

ALTER TABLE public.copilot_agent_followup_rules
  ADD CONSTRAINT copilot_agent_followup_rules_trigger_type_check
  CHECK (trigger_type IN (
    'no_response',
    'scheduled',
    'event',
    'after_qualification',
    'after_meeting_scheduled',
    'post_sale',
    'proposal_no_response'
  ));

-- =====================================================
-- 3. NEW TABLE: copilot_followup_step_log
-- =====================================================

CREATE TABLE public.copilot_followup_step_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.copilot_agent_followup_rules(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  current_step integer NOT NULL DEFAULT 1,
  last_step_sent_at timestamptz,
  completed boolean NOT NULL DEFAULT false,
  completed_reason text CHECK (completed_reason IN ('all_steps_done', 'lead_responded', 'manual_stop')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Partial index: fast lookup for active (non-completed) sequences
CREATE INDEX idx_followup_step_log_active
  ON public.copilot_followup_step_log (rule_id, lead_id, completed)
  WHERE NOT completed;

CREATE INDEX idx_followup_step_log_org
  ON public.copilot_followup_step_log (organization_id);

-- =====================================================
-- 4. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.copilot_followup_step_log ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: authenticated users see only their org's data
CREATE POLICY "tenant_select" ON public.copilot_followup_step_log
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Service role: full access (cron jobs, edge functions)
CREATE POLICY "service_role_all" ON public.copilot_followup_step_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.copilot_followup_step_log TO authenticated;

-- =====================================================
-- 5. updated_at TRIGGER
-- =====================================================

CREATE TRIGGER update_copilot_followup_step_log_updated_at
  BEFORE UPDATE ON public.copilot_followup_step_log
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 6. COMMENTS
-- =====================================================

COMMENT ON TABLE public.copilot_followup_step_log IS
  'Tracks execution progress of multi-step follow-up cadences per lead/rule pair.';
