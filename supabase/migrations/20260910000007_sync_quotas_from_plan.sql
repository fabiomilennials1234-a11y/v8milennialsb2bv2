-- ============================================================
-- Migration: sync_org_quotas_from_plan RPC
-- Feature: org-quota-enforcement
-- Traces: REQ-Q03, REQ-Q08
--
-- Syncs org_quotas.plan_base values from the org's current
-- subscription plan limits. Called when an org changes plan
-- (via checkout, admin override, or migration backfill).
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_org_quotas_from_plan(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_limits    JSONB;
  v_resource_key   TEXT;
  v_new_value      INTEGER;
  v_old_value      INTEGER;
  v_resource_keys  TEXT[] := ARRAY['max_whatsapp_instances', 'max_users', 'max_copilot_agents'];
BEGIN
  -- -------------------------------------------------------
  -- 1. Authorization: service_role OR master user
  -- -------------------------------------------------------
  IF current_setting('role', true) != 'service_role'
     AND NOT public.is_master_user()
  THEN
    RAISE EXCEPTION 'sync_org_quotas_from_plan: unauthorized — requires service_role or master user';
  END IF;

  -- -------------------------------------------------------
  -- 2. Resolve the org's current plan limits JSONB
  --    Priority: org_subscriptions → fallback organizations.subscription_plan
  -- -------------------------------------------------------
  SELECT sp.limits
  INTO v_plan_limits
  FROM public.org_subscriptions os
  JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL
  LIMIT 1;

  IF v_plan_limits IS NULL THEN
    SELECT sp.limits
    INTO v_plan_limits
    FROM public.organizations o
    JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
    WHERE o.id = p_org_id
    LIMIT 1;
  END IF;

  -- Ultimate fallback: empty JSONB (all plan_base → 0)
  IF v_plan_limits IS NULL THEN
    v_plan_limits := '{}'::JSONB;
  END IF;

  -- -------------------------------------------------------
  -- 3. Loop over resource keys and upsert org_quotas
  -- -------------------------------------------------------
  FOREACH v_resource_key IN ARRAY v_resource_keys
  LOOP
    v_new_value := COALESCE((v_plan_limits ->> v_resource_key)::INTEGER, 0);

    -- Capture old plan_base before upsert (NULL if row doesn't exist yet)
    SELECT oq.plan_base
    INTO v_old_value
    FROM public.org_quotas oq
    WHERE oq.organization_id = p_org_id
      AND oq.resource_key = v_resource_key;

    -- Upsert: preserves purchased_addons and admin_adjustment
    INSERT INTO public.org_quotas (organization_id, resource_key, plan_base)
    VALUES (p_org_id, v_resource_key, v_new_value)
    ON CONFLICT (organization_id, resource_key)
    DO UPDATE SET
      plan_base  = EXCLUDED.plan_base,
      updated_at = NOW();

    -- Audit log only when plan_base actually changed
    IF v_old_value IS DISTINCT FROM v_new_value THEN
      INSERT INTO public.quota_audit_log (
        organization_id,
        resource_key,
        field_changed,
        old_value,
        new_value,
        changed_by,
        change_reason
      ) VALUES (
        p_org_id,
        v_resource_key,
        'plan_base',
        COALESCE(v_old_value, 0),
        v_new_value,
        auth.uid(),
        'plan_sync'
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.sync_org_quotas_from_plan(UUID) IS
  'Syncs org_quotas.plan_base from the org''s current subscription plan limits. '
  'Iterates max_whatsapp_instances, max_users, max_copilot_agents. '
  'Preserves purchased_addons and admin_adjustment. '
  'Writes quota_audit_log only when plan_base actually changes.';

-- Grants
GRANT EXECUTE ON FUNCTION public.sync_org_quotas_from_plan(UUID)
  TO authenticated, service_role;
