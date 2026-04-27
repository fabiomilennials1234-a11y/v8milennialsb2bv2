-- ============================================================
-- Migration: Admin quota management RPCs
-- Feature: org-quota-enforcement
-- Traces: REQ-Q14, REQ-Q15
--
-- Functions:
--   1. admin_set_quota_adjustment  — master admin sets admin_adjustment
--   2. admin_set_purchased_addons  — master OR service_role sets purchased_addons
--   3. admin_get_org_quota_summary — master admin reads full quota + audit view
-- ============================================================

-- =========================
-- Helper: resolve plan_base from org's current plan for a given resource_key.
-- Used internally by the UPSERT functions to seed plan_base on first insert.
-- =========================

CREATE OR REPLACE FUNCTION public._resolve_plan_base_for_resource(
  p_org_id      UUID,
  p_resource_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  -- Priority 1: org_subscriptions → subscription_plans.limits
  SELECT (sp.limits ->> p_resource_key)::INTEGER
  INTO v_limit
  FROM public.org_subscriptions os
  JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL;

  IF v_limit IS NOT NULL THEN
    RETURN v_limit;
  END IF;

  -- Priority 2: organizations.subscription_plan → subscription_plans.limits
  SELECT (sp.limits ->> p_resource_key)::INTEGER
  INTO v_limit
  FROM public.organizations o
  JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
  WHERE o.id = p_org_id;

  IF v_limit IS NOT NULL THEN
    RETURN v_limit;
  END IF;

  -- Fallback
  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public._resolve_plan_base_for_resource IS
  'Internal: derives plan_base for a resource from the org current plan. Used during quota row creation.';


-- =========================
-- 1. admin_set_quota_adjustment
-- =========================

CREATE OR REPLACE FUNCTION public.admin_set_quota_adjustment(
  p_org_id           UUID,
  p_resource_key     TEXT,
  p_admin_adjustment INTEGER,
  p_reason           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value   INTEGER;
  v_plan_base   INTEGER;
  v_result      RECORD;
BEGIN
  -- Auth gate: master users only
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'access_denied: only master users can set quota adjustments';
  END IF;

  -- Capture old value before mutation (NULL when row does not exist yet)
  SELECT admin_adjustment
  INTO v_old_value
  FROM public.org_quotas
  WHERE organization_id = p_org_id AND resource_key = p_resource_key;

  -- Resolve plan_base for potential INSERT
  v_plan_base := public._resolve_plan_base_for_resource(p_org_id, p_resource_key);

  -- UPSERT
  INSERT INTO public.org_quotas (organization_id, resource_key, plan_base, purchased_addons, admin_adjustment)
  VALUES (p_org_id, p_resource_key, v_plan_base, 0, p_admin_adjustment)
  ON CONFLICT (organization_id, resource_key)
  DO UPDATE SET
    admin_adjustment = EXCLUDED.admin_adjustment,
    updated_at       = NOW()
  RETURNING * INTO v_result;

  -- Audit log
  INSERT INTO public.quota_audit_log (
    organization_id, resource_key, field_changed,
    old_value, new_value, changed_by, change_reason
  ) VALUES (
    p_org_id, p_resource_key, 'admin_adjustment',
    COALESCE(v_old_value, 0), p_admin_adjustment,
    auth.uid(), p_reason
  );

  RETURN to_jsonb(v_result);
END;
$$;

COMMENT ON FUNCTION public.admin_set_quota_adjustment IS
  'Master-only: sets the admin_adjustment column on org_quotas for a given resource. Creates the row if needed.';


-- =========================
-- 2. admin_set_purchased_addons
-- =========================

CREATE OR REPLACE FUNCTION public.admin_set_purchased_addons(
  p_org_id       UUID,
  p_resource_key TEXT,
  p_purchased    INTEGER,
  p_reason       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value   INTEGER;
  v_plan_base   INTEGER;
  v_result      RECORD;
  v_is_service  BOOLEAN;
  v_is_master   BOOLEAN;
BEGIN
  -- Auth gate: master users OR service_role
  v_is_service := (current_setting('role', true) = 'service_role');
  v_is_master  := public.is_master_user();

  IF NOT v_is_service AND NOT v_is_master THEN
    RAISE EXCEPTION 'access_denied: only master users or service_role can set purchased addons';
  END IF;

  -- Capture old value
  SELECT purchased_addons
  INTO v_old_value
  FROM public.org_quotas
  WHERE organization_id = p_org_id AND resource_key = p_resource_key;

  -- Resolve plan_base for potential INSERT
  v_plan_base := public._resolve_plan_base_for_resource(p_org_id, p_resource_key);

  -- UPSERT
  INSERT INTO public.org_quotas (organization_id, resource_key, plan_base, purchased_addons, admin_adjustment)
  VALUES (p_org_id, p_resource_key, v_plan_base, p_purchased, 0)
  ON CONFLICT (organization_id, resource_key)
  DO UPDATE SET
    purchased_addons = EXCLUDED.purchased_addons,
    updated_at       = NOW()
  RETURNING * INTO v_result;

  -- Audit log
  INSERT INTO public.quota_audit_log (
    organization_id, resource_key, field_changed,
    old_value, new_value, changed_by, change_reason
  ) VALUES (
    p_org_id, p_resource_key, 'purchased_addons',
    COALESCE(v_old_value, 0), p_purchased,
    auth.uid(), p_reason
  );

  RETURN to_jsonb(v_result);
END;
$$;

COMMENT ON FUNCTION public.admin_set_purchased_addons IS
  'Master or service_role: sets the purchased_addons column on org_quotas. Creates the row if needed.';


-- =========================
-- 3. admin_get_org_quota_summary
-- =========================

CREATE OR REPLACE FUNCTION public.admin_get_org_quota_summary(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_quotas       JSONB;
  v_recent_audit JSONB;
BEGIN
  -- Auth gate: master users only
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'access_denied: only master users can view org quota summaries';
  END IF;

  -- Build quotas array with current_usage per resource
  SELECT COALESCE(jsonb_agg(row_obj ORDER BY q.resource_key), '[]'::JSONB)
  INTO v_quotas
  FROM (
    SELECT
      to_jsonb(q.*) || jsonb_build_object(
        'current_usage',
        CASE q.resource_key
          WHEN 'max_whatsapp_instances' THEN (
            SELECT COUNT(*)::INTEGER
            FROM public.whatsapp_instances
            WHERE organization_id = p_org_id
          )
          WHEN 'max_users' THEN (
            SELECT COUNT(*)::INTEGER
            FROM public.team_members
            WHERE organization_id = p_org_id
              AND is_active = true
              AND NOT public.is_master_user(user_id)
          )
          WHEN 'max_copilot_agents' THEN (
            SELECT COUNT(*)::INTEGER
            FROM public.copilot_agents
            WHERE organization_id = p_org_id
          )
          ELSE 0
        END
      ) AS row_obj
    FROM public.org_quotas q
    WHERE q.organization_id = p_org_id
  ) sub;

  -- Build recent audit entries
  SELECT COALESCE(jsonb_agg(to_jsonb(a.*) ORDER BY a.created_at DESC), '[]'::JSONB)
  INTO v_recent_audit
  FROM (
    SELECT *
    FROM public.quota_audit_log
    WHERE organization_id = p_org_id
    ORDER BY created_at DESC
    LIMIT 10
  ) a;

  RETURN jsonb_build_object(
    'quotas',       v_quotas,
    'recent_audit', v_recent_audit
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_org_quota_summary IS
  'Master-only: returns all org_quotas rows (with live current_usage) and last 10 audit log entries for an org.';


-- =========================
-- 4. Grants
-- =========================

GRANT EXECUTE ON FUNCTION public._resolve_plan_base_for_resource(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_quota_adjustment(UUID, TEXT, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_purchased_addons(UUID, TEXT, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_org_quota_summary(UUID) TO authenticated, service_role;
