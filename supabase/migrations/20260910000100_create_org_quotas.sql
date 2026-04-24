-- ============================================================
-- Migration: org_quotas + quota_audit_log tables
-- Feature: org-quota-enforcement
-- Traces: REQ-Q01, REQ-Q02, REQ-Q14, REQ-Q15
-- ============================================================

-- =========================
-- 1. org_quotas table
-- =========================

CREATE TABLE public.org_quotas (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_key     TEXT        NOT NULL,
  plan_base        INTEGER     NOT NULL DEFAULT 0,
  purchased_addons INTEGER     NOT NULL DEFAULT 0,
  admin_adjustment INTEGER     NOT NULL DEFAULT 0,
  effective_limit  INTEGER     GENERATED ALWAYS AS (
    CASE
      WHEN plan_base = -1 THEN -1
      ELSE GREATEST(plan_base + purchased_addons + admin_adjustment, 0)
    END
  ) STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_quotas_org_resource_unique UNIQUE (organization_id, resource_key)
);

COMMENT ON TABLE public.org_quotas IS 'Per-org, per-resource quota with delta model: effective_limit = plan_base + purchased_addons + admin_adjustment';
COMMENT ON COLUMN public.org_quotas.resource_key IS 'Resource identifier: max_whatsapp_instances, max_users, max_copilot_agents';
COMMENT ON COLUMN public.org_quotas.plan_base IS 'Snapshot of the plan limit at last sync. -1 = unlimited';
COMMENT ON COLUMN public.org_quotas.purchased_addons IS 'Self-service purchased extra units';
COMMENT ON COLUMN public.org_quotas.admin_adjustment IS 'Master admin manual delta (can be negative)';
COMMENT ON COLUMN public.org_quotas.effective_limit IS 'Computed: plan_base + addons + adjustment. Floors at 0. -1 when plan_base is unlimited';

-- Index for org lookups
CREATE INDEX idx_org_quotas_org_id ON public.org_quotas (organization_id);

-- updated_at trigger
CREATE TRIGGER set_org_quotas_updated_at
  BEFORE UPDATE ON public.org_quotas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- 2. quota_audit_log table
-- =========================

CREATE TABLE public.quota_audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_key    TEXT        NOT NULL,
  field_changed   TEXT        NOT NULL,
  old_value       INTEGER     NOT NULL,
  new_value       INTEGER     NOT NULL,
  changed_by      UUID        REFERENCES auth.users(id),
  change_reason   TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quota_audit_log IS 'Immutable audit trail for all quota changes';
COMMENT ON COLUMN public.quota_audit_log.field_changed IS 'Which field changed: plan_base, purchased_addons, admin_adjustment';
COMMENT ON COLUMN public.quota_audit_log.change_reason IS 'Why: plan_sync, addon_purchase, admin_override, data_migration';

-- Index for org + time lookups
CREATE INDEX idx_quota_audit_log_org_created
  ON public.quota_audit_log (organization_id, created_at DESC);

-- =========================
-- 3. RLS: org_quotas
-- =========================

ALTER TABLE public.org_quotas ENABLE ROW LEVEL SECURITY;

-- SELECT: org members can read their own org's quotas
CREATE POLICY org_quotas_select_own ON public.org_quotas
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- INSERT/UPDATE/DELETE: master users only (service_role bypasses RLS)
CREATE POLICY org_quotas_manage_master ON public.org_quotas
  FOR ALL
  USING (public.is_master_user())
  WITH CHECK (public.is_master_user());

-- =========================
-- 4. RLS: quota_audit_log
-- =========================

ALTER TABLE public.quota_audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT: master users only
CREATE POLICY quota_audit_log_select_master ON public.quota_audit_log
  FOR SELECT
  USING (public.is_master_user());

-- INSERT: master users (service_role bypasses RLS for trigger/RPC inserts)
CREATE POLICY quota_audit_log_insert_master ON public.quota_audit_log
  FOR INSERT
  WITH CHECK (public.is_master_user());

-- No UPDATE or DELETE policies — immutable audit log

-- =========================
-- 5. Grants
-- =========================

GRANT SELECT ON public.org_quotas TO authenticated;
GRANT ALL ON public.org_quotas TO service_role;
GRANT SELECT ON public.quota_audit_log TO authenticated;
GRANT INSERT ON public.quota_audit_log TO authenticated;
GRANT ALL ON public.quota_audit_log TO service_role;
