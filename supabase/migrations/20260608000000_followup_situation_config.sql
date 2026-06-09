-- 20260608000000_followup_situation_config.sql
-- Copilot Follow-up restructure (ADR-0006), slice 1 schema.
--
-- 1. Per-Organization config for the six canonical Follow-up Situations:
--    the Org enables/disables each Situation and tunes basics on top of the
--    Torque-curated catalog defaults (no free-form rule authoring).
-- 2. Extend copilot_followup_step_log.completed_reason with the new stop
--    causes wired by the Stop Evaluator (#737).
--
-- Additive + backwards compatible: the legacy copilot_agent_followup_rules
-- path keeps working until migrated/retired in #742.

-- =====================================================
-- 1. NEW TABLE: copilot_followup_situation_config
-- =====================================================

CREATE TABLE public.copilot_followup_situation_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- One of the six canonical Follow-up Situations (CONTEXT.md / followup-situations.ts)
  situation_id text NOT NULL,

  -- Enable/disable + initial trigger delay (basics the Org may tune)
  is_active boolean NOT NULL DEFAULT false,
  delay_hours integer NOT NULL DEFAULT 24,
  delay_minutes integer NOT NULL DEFAULT 0,

  -- Org-configured stage_keys (of the owning pipe) that place a Lead IN this
  -- situation. Stage keys are per-Organization (custom funnels), so the trigger
  -- is never a hardcoded canonical key. Empty = never fires until configured.
  trigger_stage_keys text[] NOT NULL DEFAULT '{}',

  -- Optional overrides on top of the catalog default cadence (NULL = use default)
  touch_count integer,
  spacing_hours integer,
  copy_override jsonb,

  -- Send window (mirrors the legacy rules table contract)
  send_only_business_hours boolean NOT NULL DEFAULT true,
  business_hours_start time NOT NULL DEFAULT '09:00',
  business_hours_end time NOT NULL DEFAULT '18:00',
  send_days text[] NOT NULL DEFAULT ARRAY['seg', 'ter', 'qua', 'qui', 'sex'],
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,

  CONSTRAINT copilot_followup_situation_config_situation_check
    CHECK (situation_id IN (
      'new_lead_no_reply',
      'qualified_no_meeting',
      'meeting_reminder',
      'no_show_rebook',
      'proposal_no_reply',
      'dormant_winback'
    )),
  CONSTRAINT copilot_followup_situation_config_org_situation_unique
    UNIQUE (organization_id, situation_id)
);

CREATE INDEX idx_followup_situation_config_org
  ON public.copilot_followup_situation_config (organization_id);

-- Fast lookup of the enabled set per org (worker hot path)
CREATE INDEX idx_followup_situation_config_active
  ON public.copilot_followup_situation_config (organization_id, situation_id)
  WHERE is_active;

ALTER TABLE public.copilot_followup_situation_config ENABLE ROW LEVEL SECURITY;

-- Members of the org may read their config
CREATE POLICY "tenant_select" ON public.copilot_followup_situation_config
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Only org admins may change it
CREATE POLICY "tenant_admin_write" ON public.copilot_followup_situation_config
  FOR ALL
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

-- Service role: full access (cron worker, edge functions)
CREATE POLICY "service_role_all" ON public.copilot_followup_situation_config
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.copilot_followup_situation_config TO authenticated;

CREATE TRIGGER update_copilot_followup_situation_config_updated_at
  BEFORE UPDATE ON public.copilot_followup_situation_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.copilot_followup_situation_config IS
  'Per-Organization enable/disable + basics for the six canonical Follow-up Situations (ADR-0006). Overlays the Torque-curated catalog defaults.';

-- NOTE: the copilot_followup_step_log.completed_reason extension (new stop
-- causes: human_replied, situation_resolved, owner_changed) lives with the
-- Stop Evaluator work (#737). It is intentionally NOT here because
-- copilot_followup_step_log is part of the cadence schema (20261028000000),
-- which is not yet applied in prod (drift). Apply that first, then extend.
