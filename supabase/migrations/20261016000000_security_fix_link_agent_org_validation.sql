-- =============================================================================
-- Security fix: add organization_id validation to link/unlink_agent_to_instance
--
-- VULNERABILITY: Both functions are SECURITY DEFINER (bypass RLS) but accept
-- any agent_id/instance_id without verifying the caller owns them.
-- An authenticated user from Org A could bind their agent to Org B's instance.
--
-- FIX: Validate that both resources belong to the calling user's organization
-- before performing any updates.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.link_agent_to_instance(
  p_agent_id UUID,
  p_instance_id UUID
) RETURNS VOID AS $$
DECLARE
  v_user_org UUID;
  v_agent_org UUID;
  v_instance_org UUID;
BEGIN
  v_user_org := public.get_user_organization_id();

  SELECT organization_id INTO v_agent_org
    FROM public.copilot_agents WHERE id = p_agent_id;

  SELECT organization_id INTO v_instance_org
    FROM public.whatsapp_instances WHERE id = p_instance_id;

  IF v_agent_org IS NULL OR v_instance_org IS NULL THEN
    RAISE EXCEPTION 'Agent or instance not found';
  END IF;

  IF v_agent_org != v_user_org OR v_instance_org != v_user_org THEN
    RAISE EXCEPTION 'Cross-tenant operation denied';
  END IF;

  UPDATE public.copilot_agents SET whatsapp_instance_id = NULL
    WHERE whatsapp_instance_id = p_instance_id AND organization_id = v_user_org;

  UPDATE public.whatsapp_instances SET copilot_agent_id = NULL
    WHERE copilot_agent_id = p_agent_id AND organization_id = v_user_org;

  UPDATE public.copilot_agents SET whatsapp_instance_id = p_instance_id
    WHERE id = p_agent_id AND organization_id = v_user_org;

  UPDATE public.whatsapp_instances SET copilot_agent_id = p_agent_id
    WHERE id = p_instance_id AND organization_id = v_user_org;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.unlink_agent_from_instance(
  p_agent_id UUID
) RETURNS VOID AS $$
DECLARE
  v_user_org UUID;
  v_agent_org UUID;
  v_instance_id UUID;
BEGIN
  v_user_org := public.get_user_organization_id();

  SELECT organization_id, whatsapp_instance_id INTO v_agent_org, v_instance_id
    FROM public.copilot_agents WHERE id = p_agent_id;

  IF v_agent_org IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_agent_org != v_user_org THEN
    RAISE EXCEPTION 'Cross-tenant operation denied';
  END IF;

  UPDATE public.copilot_agents SET whatsapp_instance_id = NULL
    WHERE id = p_agent_id AND organization_id = v_user_org;

  IF v_instance_id IS NOT NULL THEN
    UPDATE public.whatsapp_instances SET copilot_agent_id = NULL
      WHERE id = v_instance_id AND organization_id = v_user_org;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
