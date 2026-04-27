-- ============================================================
-- Migration: Seed org_quotas from existing plan + override data
-- Feature: org-quota-enforcement
-- Traces: REQ-Q03
-- Depends on: 20260910000000_create_org_quotas
--
-- Populates org_quotas rows for every organization:
--   1. Orgs with org_subscriptions (plan_id FK) → preferred source
--   2. Orgs with only organizations.subscription_plan (legacy text) → fallback
--   3. Orgs with no plan at all → plan_base defaults to 0
--
-- For each org, creates 3 rows (one per resource_key):
--   max_whatsapp_instances, max_users, max_copilot_agents
--
-- admin_adjustment = override_value - plan_base when:
--   - plan_base != -1 (unlimited cannot be meaningfully delta'd)
--   - override_value != plan_base (no effective change)
--
-- Idempotent: ON CONFLICT (organization_id, resource_key) DO NOTHING
-- ============================================================

DO $$
DECLARE
  v_resource_keys TEXT[] := ARRAY[
    'max_whatsapp_instances',
    'max_users',
    'max_copilot_agents'
  ];
  v_key           TEXT;
  v_org           RECORD;
  v_plan_base     INTEGER;
  v_override_val  INTEGER;
  v_adjustment    INTEGER;
  v_rows_inserted INTEGER := 0;
BEGIN
  -- -----------------------------------------------------------
  -- Iterate each resource key
  -- -----------------------------------------------------------
  FOREACH v_key IN ARRAY v_resource_keys LOOP

    -- ---------------------------------------------------------
    -- GROUP 1: Orgs with org_subscriptions (modern path)
    --
    -- org_subscriptions.plan_id → subscription_plans.limits
    -- Excludes orgs that will also match GROUP 2 to avoid dupes
    -- (ON CONFLICT handles it anyway, but we skip the work).
    -- ---------------------------------------------------------
    FOR v_org IN
      SELECT
        o.id                AS org_id,
        o.limit_overrides   AS overrides,
        sp.limits           AS plan_limits
      FROM public.organizations        o
      JOIN public.org_subscriptions     os ON os.organization_id = o.id
      JOIN public.subscription_plans    sp ON sp.id = os.plan_id
    LOOP
      -- plan_base from subscription_plans.limits JSONB
      v_plan_base := COALESCE((v_org.plan_limits ->> v_key)::INTEGER, 0);

      -- admin_adjustment from limit_overrides delta
      v_adjustment := 0;
      IF v_org.overrides IS NOT NULL
        AND v_org.overrides ? v_key
        AND v_plan_base != -1
      THEN
        v_override_val := (v_org.overrides ->> v_key)::INTEGER;
        IF v_override_val IS DISTINCT FROM v_plan_base THEN
          v_adjustment := v_override_val - v_plan_base;
        END IF;
      END IF;

      INSERT INTO public.org_quotas (organization_id, resource_key, plan_base, purchased_addons, admin_adjustment)
      VALUES (v_org.org_id, v_key, v_plan_base, 0, v_adjustment)
      ON CONFLICT (organization_id, resource_key) DO NOTHING;

      IF FOUND THEN v_rows_inserted := v_rows_inserted + 1; END IF;
    END LOOP;

    -- ---------------------------------------------------------
    -- GROUP 2: Orgs with only legacy subscription_plan TEXT
    --          (no row in org_subscriptions)
    -- ---------------------------------------------------------
    FOR v_org IN
      SELECT
        o.id                  AS org_id,
        o.limit_overrides     AS overrides,
        sp.limits             AS plan_limits
      FROM public.organizations       o
      JOIN public.subscription_plans   sp ON sp.name = o.subscription_plan
      WHERE o.subscription_plan IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.org_subscriptions os
          WHERE os.organization_id = o.id
        )
    LOOP
      v_plan_base := COALESCE((v_org.plan_limits ->> v_key)::INTEGER, 0);

      v_adjustment := 0;
      IF v_org.overrides IS NOT NULL
        AND v_org.overrides ? v_key
        AND v_plan_base != -1
      THEN
        v_override_val := (v_org.overrides ->> v_key)::INTEGER;
        IF v_override_val IS DISTINCT FROM v_plan_base THEN
          v_adjustment := v_override_val - v_plan_base;
        END IF;
      END IF;

      INSERT INTO public.org_quotas (organization_id, resource_key, plan_base, purchased_addons, admin_adjustment)
      VALUES (v_org.org_id, v_key, v_plan_base, 0, v_adjustment)
      ON CONFLICT (organization_id, resource_key) DO NOTHING;

      IF FOUND THEN v_rows_inserted := v_rows_inserted + 1; END IF;
    END LOOP;

    -- ---------------------------------------------------------
    -- GROUP 3: Orgs with no plan at all
    --          (no org_subscription AND subscription_plan IS NULL)
    -- ---------------------------------------------------------
    FOR v_org IN
      SELECT o.id AS org_id
      FROM public.organizations o
      WHERE o.subscription_plan IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.org_subscriptions os
          WHERE os.organization_id = o.id
        )
    LOOP
      INSERT INTO public.org_quotas (organization_id, resource_key, plan_base, purchased_addons, admin_adjustment)
      VALUES (v_org.org_id, v_key, 0, 0, 0)
      ON CONFLICT (organization_id, resource_key) DO NOTHING;

      IF FOUND THEN v_rows_inserted := v_rows_inserted + 1; END IF;
    END LOOP;

  END LOOP; -- resource keys

  RAISE NOTICE 'org_quotas seed: % rows inserted', v_rows_inserted;
END;
$$;
