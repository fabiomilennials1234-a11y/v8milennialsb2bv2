-- ============================================================
-- Migration: Update org_get_features_and_limits to read from org_quotas
-- Feature: org-quota-enforcement
-- Traces: REQ-Q06
-- Depends on: 20260910000002_quota_resolution_rpcs
--
-- For the 3 quota-managed resources (max_whatsapp_instances,
-- max_users, max_copilot_agents), prefers org_quotas.effective_limit
-- over plan JSONB + limit_overrides.
--
-- Other limits (max_leads, max_funnels, etc.) continue using
-- the original plan JSONB + limit_overrides path.
-- ============================================================

CREATE OR REPLACE FUNCTION public.org_get_features_and_limits(p_org_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_features     JSONB := '{}';
  v_limits       JSONB := '{}';
  v_plan_features JSONB;
  v_plan_limits  JSONB;
  v_org          RECORD;
  v_override     RECORD;
  v_flag         RECORD;
  v_quota_row    RECORD;
  v_quota_keys   TEXT[] := ARRAY['max_whatsapp_instances', 'max_users', 'max_copilot_agents'];
BEGIN
  -- Master: tudo habilitado e ilimitado (unchanged)
  IF public.is_master_user() THEN
    FOR v_flag IN SELECT key FROM public.feature_flags LOOP
      v_features := v_features || jsonb_build_object(v_flag.key, true);
    END LOOP;
    RETURN jsonb_build_object(
      'features', v_features,
      'limits', '{"max_leads":-1,"max_users":-1,"max_campaigns":-1,"max_copilot_agents":-1,"max_whatsapp_instances":-1,"max_funnels":-1,"max_documents_per_agent":-1}'::JSONB,
      'plan_name', 'master'
    );
  END IF;

  -- Buscar plano da org
  SELECT o.subscription_plan, o.limit_overrides,
         COALESCE(sp.features, '{}') AS plan_features,
         COALESCE(sp.limits, '{}') AS plan_limits
  INTO v_org
  FROM public.organizations o
  LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
  WHERE o.id = p_org_id;

  v_plan_features := COALESCE(v_org.plan_features, '{}');
  v_plan_limits := COALESCE(v_org.plan_limits, '{}');

  -- Montar features: plano base
  v_features := v_plan_features;

  -- Aplicar overrides de features (organization_features)
  FOR v_override IN
    SELECT feature_key, enabled
    FROM public.organization_features
    WHERE organization_id = p_org_id
      AND (expires_at IS NULL OR expires_at > NOW())
  LOOP
    v_features := v_features || jsonb_build_object(v_override.feature_key, v_override.enabled);
  END LOOP;

  -- Para features nao presentes no plano, usar default_enabled
  FOR v_flag IN
    SELECT key, default_enabled FROM public.feature_flags
    WHERE NOT (v_features ? key)
  LOOP
    v_features := v_features || jsonb_build_object(v_flag.key, v_flag.default_enabled);
  END LOOP;

  -- Montar limites: plano base + overrides (non-quota limits)
  v_limits := v_plan_limits;
  IF v_org.limit_overrides IS NOT NULL AND v_org.limit_overrides != '{}'::JSONB THEN
    v_limits := v_limits || v_org.limit_overrides;
  END IF;

  -- Override quota-managed resources with org_quotas.effective_limit
  FOR v_quota_row IN
    SELECT oq.resource_key, oq.effective_limit
    FROM public.org_quotas oq
    WHERE oq.organization_id = p_org_id
      AND oq.resource_key = ANY(v_quota_keys)
  LOOP
    v_limits := v_limits || jsonb_build_object(v_quota_row.resource_key, v_quota_row.effective_limit);
  END LOOP;

  RETURN jsonb_build_object(
    'features', v_features,
    'limits', v_limits,
    'plan_name', COALESCE(v_org.subscription_plan, 'free')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
