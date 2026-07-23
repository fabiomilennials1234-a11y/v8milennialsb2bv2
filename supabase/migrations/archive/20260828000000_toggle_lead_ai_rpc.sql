-- ============================================================================
-- RPC: toggle_lead_ai
--
-- Permite que QUALQUER team member da organização ative/desative o Copilot
-- em uma conversa (lead). A RLS de leads exige que o usuário seja admin,
-- tenha leads.view_all, ou seja SDR/closer/responsável — o que bloqueia
-- vendedores comuns de usar o toggle. Esta RPC usa SECURITY DEFINER para
-- bypassar o RLS, verificando apenas que o usuário pertence à organização.
--
-- Date: 2026-08-28
-- ============================================================================

CREATE OR REPLACE FUNCTION public.toggle_lead_ai(
  p_lead_id UUID,
  p_disabled BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_lead_org_id UUID;
  v_result JSONB;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get user's organization
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User is not a member of any organization';
  END IF;

  -- Verify lead belongs to same organization
  SELECT organization_id INTO v_lead_org_id
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  IF v_lead_org_id != v_org_id THEN
    RAISE EXCEPTION 'Lead does not belong to your organization';
  END IF;

  -- Toggle AI
  UPDATE public.leads
  SET
    ai_disabled = p_disabled,
    ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
    ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
  WHERE id = p_lead_id;

  -- When reactivating: reset conversation state and log
  IF NOT p_disabled THEN
    UPDATE public.conversations
    SET state = 'QUALIFYING'
    WHERE lead_id = p_lead_id AND state = 'WAITING_HUMAN';

    INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
    VALUES (
      p_lead_id,
      'ai_reactivated',
      'IA Copilot reativada pelo vendedor',
      'manual',
      jsonb_build_object('reactivated_by', v_user_id)
    );
  END IF;

  -- Return updated lead
  SELECT to_jsonb(l) INTO v_result
  FROM public.leads l
  WHERE l.id = p_lead_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.toggle_lead_ai IS
  'Toggle Copilot AI on/off for a lead. Any team member in the same organization can use this.';

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.toggle_lead_ai(UUID, BOOLEAN) TO authenticated;
