-- ============================================================================
-- FIX: toggle_lead_ai falhava para usuários com múltiplas organizações.
-- LIMIT 1 na query de team_members retornava a org errada.
--
-- FIX: Verificar diretamente se o usuário é membro da mesma org do lead.
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
  v_lead_org_id UUID;
  v_is_member BOOLEAN;
  v_result JSONB;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get lead's organization
  SELECT organization_id INTO v_lead_org_id
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- Verify user is a member of the lead's organization
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_user_id
      AND organization_id = v_lead_org_id
      AND is_active = true
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'User is not a member of this organization';
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
