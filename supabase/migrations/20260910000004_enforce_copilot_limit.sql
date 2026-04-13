-- ============================================================
-- Migration: Copilot agent limit enforcement trigger
-- Feature: org-quota-enforcement
-- Traces: REQ-Q08
-- Depends on: 20260910000002_quota_resolution_rpcs
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_copilot_agent_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quota JSONB;
BEGIN
  -- Lock org row to serialize concurrent inserts
  PERFORM 1 FROM public.organizations WHERE id = NEW.organization_id FOR UPDATE;

  -- Resolve quota (includes current usage count)
  v_quota := public.org_resolve_quota(NEW.organization_id, 'max_copilot_agents');

  -- Enforce: block if not unlimited AND at or over limit
  IF NOT (v_quota->>'is_unlimited')::BOOLEAN
     AND NOT (v_quota->>'can_add')::BOOLEAN
  THEN
    RAISE EXCEPTION 'Limite de agentes Copilot atingido. Uso: %/%. Contrate mais ou contate o administrador.',
      (v_quota->>'current_usage')::INTEGER,
      (v_quota->>'effective_limit')::INTEGER
    USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to copilot_agents table
DROP TRIGGER IF EXISTS trg_enforce_copilot_agent_limit ON public.copilot_agents;

CREATE TRIGGER trg_enforce_copilot_agent_limit
  BEFORE INSERT ON public.copilot_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_copilot_agent_limit();
