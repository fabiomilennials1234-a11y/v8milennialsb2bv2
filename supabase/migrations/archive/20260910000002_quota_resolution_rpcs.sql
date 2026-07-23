-- ============================================================
-- Migration: Quota Resolution RPCs
-- Feature: org-quota-enforcement
-- Traces: REQ-Q04, REQ-Q05
--
-- Two RPCs that resolve effective quotas for an org:
--   1. org_resolve_quota(p_org_id, p_resource_key)  → single resource
--   2. org_resolve_all_quotas(p_org_id)              → all 3 resources
--
-- Resolution order:
--   master user → unlimited
--   org_quotas row → delta model (plan_base + purchased_addons + admin_adjustment)
--   org_subscriptions → subscription_plans.limits
--   organizations.subscription_plan → subscription_plans.limits
--   organizations.limit_overrides
--   default 0
-- ============================================================

-- =========================
-- 1. org_resolve_quota
-- =========================

CREATE OR REPLACE FUNCTION public.org_resolve_quota(
  p_org_id       UUID,
  p_resource_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_plan_base        INTEGER := 0;
  v_purchased_addons INTEGER := 0;
  v_admin_adjustment INTEGER := 0;
  v_effective_limit  INTEGER := 0;
  v_current_usage    INTEGER := 0;
  v_is_unlimited     BOOLEAN := FALSE;
  v_can_add          BOOLEAN := FALSE;
  v_remaining        INTEGER := 0;
  v_quota            RECORD;
  v_plan_limit       INTEGER;
BEGIN
  -- -----------------------------------------------
  -- Step 1: Master user → everything unlimited
  -- -----------------------------------------------
  IF public.is_master_user() THEN
    -- Still count actual usage for informational purposes
    CASE p_resource_key
      WHEN 'max_whatsapp_instances' THEN
        SELECT COUNT(*)::INTEGER INTO v_current_usage
        FROM public.whatsapp_instances
        WHERE organization_id = p_org_id;
      WHEN 'max_users' THEN
        SELECT COUNT(*)::INTEGER INTO v_current_usage
        FROM public.team_members
        WHERE organization_id = p_org_id
          AND is_active = true
          AND NOT public.is_master_user(user_id);
      WHEN 'max_copilot_agents' THEN
        SELECT COUNT(*)::INTEGER INTO v_current_usage
        FROM public.copilot_agents
        WHERE organization_id = p_org_id;
      ELSE
        v_current_usage := 0;
    END CASE;

    RETURN jsonb_build_object(
      'plan_base',        -1,
      'purchased_addons', 0,
      'admin_adjustment', 0,
      'effective_limit',  -1,
      'current_usage',    v_current_usage,
      'is_unlimited',     TRUE,
      'can_add',          TRUE,
      'remaining',        -1
    );
  END IF;

  -- -----------------------------------------------
  -- Step 2: Read from org_quotas (authoritative)
  -- -----------------------------------------------
  SELECT oq.plan_base,
         oq.purchased_addons,
         oq.admin_adjustment,
         oq.effective_limit
  INTO v_quota
  FROM public.org_quotas oq
  WHERE oq.organization_id = p_org_id
    AND oq.resource_key = p_resource_key;

  IF FOUND THEN
    v_plan_base        := v_quota.plan_base;
    v_purchased_addons := v_quota.purchased_addons;
    v_admin_adjustment := v_quota.admin_adjustment;
    v_effective_limit  := v_quota.effective_limit;
  ELSE
    -- -----------------------------------------------
    -- Step 3: Fallback chain to plan limits
    -- -----------------------------------------------

    -- 3a. org_subscriptions → subscription_plans.limits
    SELECT (sp.limits ->> p_resource_key)::INTEGER
    INTO v_plan_limit
    FROM public.org_subscriptions os
    JOIN public.subscription_plans sp ON sp.id = os.plan_id
    WHERE os.organization_id = p_org_id
      AND os.cancelled_at IS NULL;

    IF v_plan_limit IS NOT NULL THEN
      v_plan_base       := v_plan_limit;
      v_effective_limit := v_plan_limit;
    ELSE
      -- 3b. organizations.subscription_plan → subscription_plans.limits
      SELECT (sp.limits ->> p_resource_key)::INTEGER
      INTO v_plan_limit
      FROM public.organizations o
      JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
      WHERE o.id = p_org_id;

      IF v_plan_limit IS NOT NULL THEN
        v_plan_base       := v_plan_limit;
        v_effective_limit := v_plan_limit;
      ELSE
        -- 3c. organizations.limit_overrides
        SELECT (o.limit_overrides ->> p_resource_key)::INTEGER
        INTO v_plan_limit
        FROM public.organizations o
        WHERE o.id = p_org_id
          AND o.limit_overrides IS NOT NULL
          AND o.limit_overrides ? p_resource_key;

        IF v_plan_limit IS NOT NULL THEN
          v_plan_base       := v_plan_limit;
          v_effective_limit := v_plan_limit;
        ELSE
          -- 3d. Default: 0
          v_plan_base       := 0;
          v_effective_limit := 0;
        END IF;
      END IF;
    END IF;

    -- No addons or adjustments in fallback path
    v_purchased_addons := 0;
    v_admin_adjustment := 0;
  END IF;

  -- -----------------------------------------------
  -- Step 4: Count current usage
  -- -----------------------------------------------
  CASE p_resource_key
    WHEN 'max_whatsapp_instances' THEN
      SELECT COUNT(*)::INTEGER INTO v_current_usage
      FROM public.whatsapp_instances
      WHERE organization_id = p_org_id;
    WHEN 'max_users' THEN
      SELECT COUNT(*)::INTEGER INTO v_current_usage
      FROM public.team_members
      WHERE organization_id = p_org_id
        AND is_active = true
        AND NOT public.is_master_user(user_id);
    WHEN 'max_copilot_agents' THEN
      SELECT COUNT(*)::INTEGER INTO v_current_usage
      FROM public.copilot_agents
      WHERE organization_id = p_org_id;
    ELSE
      v_current_usage := 0;
  END CASE;

  -- -----------------------------------------------
  -- Step 5: Compute derived fields
  -- -----------------------------------------------
  v_is_unlimited := (v_effective_limit = -1);
  v_can_add      := v_is_unlimited OR (v_current_usage < v_effective_limit);
  v_remaining    := CASE
                      WHEN v_is_unlimited THEN -1
                      ELSE GREATEST(v_effective_limit - v_current_usage, 0)
                    END;

  RETURN jsonb_build_object(
    'plan_base',        v_plan_base,
    'purchased_addons', v_purchased_addons,
    'admin_adjustment', v_admin_adjustment,
    'effective_limit',  v_effective_limit,
    'current_usage',    v_current_usage,
    'is_unlimited',     v_is_unlimited,
    'can_add',          v_can_add,
    'remaining',        v_remaining
  );
END;
$$;

COMMENT ON FUNCTION public.org_resolve_quota IS
  'Resolves the effective quota for a single resource in an org. '
  'Returns plan_base, purchased_addons, admin_adjustment, effective_limit, '
  'current_usage, is_unlimited, can_add, remaining. '
  '-1 in effective_limit/remaining = unlimited.';

GRANT EXECUTE ON FUNCTION public.org_resolve_quota(UUID, TEXT)
  TO authenticated, service_role;

-- =========================
-- 2. org_resolve_all_quotas
-- =========================

CREATE OR REPLACE FUNCTION public.org_resolve_all_quotas(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'max_whatsapp_instances', public.org_resolve_quota(p_org_id, 'max_whatsapp_instances'),
    'max_users',              public.org_resolve_quota(p_org_id, 'max_users'),
    'max_copilot_agents',     public.org_resolve_quota(p_org_id, 'max_copilot_agents')
  );
END;
$$;

COMMENT ON FUNCTION public.org_resolve_all_quotas IS
  'Resolves all three resource quotas for an org in a single call. '
  'Returns keyed JSONB: { max_whatsapp_instances, max_users, max_copilot_agents }.';

GRANT EXECUTE ON FUNCTION public.org_resolve_all_quotas(UUID)
  TO authenticated, service_role;
