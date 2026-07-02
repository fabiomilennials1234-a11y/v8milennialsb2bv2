-- 20270103000000_org_has_feature_and_guards.sql
-- Backstop server-side de gating por plano.
--
-- org_has_feature reusa org_get_features_and_limits (mesma resolução que o
-- frontend: plano base + organization_features overrides + feature_flags
-- default), então nunca diverge do hasFeature do cliente.
-- search_path pinado (classe dos 58 definers — hardening).

CREATE OR REPLACE FUNCTION public.org_has_feature(p_org_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (public.org_get_features_and_limits(p_org_id) -> 'features' ->> p_feature_key)::boolean,
    false
  );
$$;

COMMENT ON FUNCTION public.org_has_feature(uuid, text) IS
  'True se a org tem a feature liberada no plano (reusa org_get_features_and_limits).';

-- ── Trigger genérico de guard de INSERT ──────────────────────
-- Cada trigger passa a feature_key esperada via TG_ARGV[0].
CREATE OR REPLACE FUNCTION public.enforce_feature_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_feature text := TG_ARGV[0];
BEGIN
  IF NOT public.org_has_feature(NEW.organization_id, v_feature) THEN
    RAISE EXCEPTION 'feature_locked: % indisponível no plano da organização', v_feature
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- copilot_agents → feature "copilot"
DROP TRIGGER IF EXISTS trg_enforce_feature_copilot ON public.copilot_agents;
CREATE TRIGGER trg_enforce_feature_copilot
  BEFORE INSERT ON public.copilot_agents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_on_insert('copilot');

-- custom_pipelines → feature "funnels_custom"
DROP TRIGGER IF EXISTS trg_enforce_feature_custom_funnels ON public.custom_pipelines;
CREATE TRIGGER trg_enforce_feature_custom_funnels
  BEFORE INSERT ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_on_insert('funnels_custom');

-- message_templates → feature "message_templates"
DROP TRIGGER IF EXISTS trg_enforce_feature_templates ON public.message_templates;
CREATE TRIGGER trg_enforce_feature_templates
  BEFORE INSERT ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_on_insert('message_templates');
