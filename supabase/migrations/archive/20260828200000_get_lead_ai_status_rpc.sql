-- ============================================================================
-- RPC: get_lead_ai_status
--
-- Retorna o status ai_disabled de um lead, bypassing RLS.
-- Necessário porque useLeadByPhone pode retornar null para usuários
-- que não têm permissão SELECT via RLS no lead, mesmo pertencendo
-- à mesma organização. Esse RPC garante que o switch de IA
-- sempre reflita o estado real do banco.
--
-- Date: 2026-08-28
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_lead_ai_status(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_lead_org_id UUID;
  v_is_member BOOLEAN;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ai_disabled', false);
  END IF;

  -- Get lead's org and ai_disabled in one query
  SELECT organization_id, ai_disabled, ai_disabled_at, ai_disabled_by
  INTO v_lead_org_id
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RETURN jsonb_build_object('ai_disabled', false);
  END IF;

  -- Verify user belongs to the lead's org
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_user_id
      AND organization_id = v_lead_org_id
      AND is_active = true
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN jsonb_build_object('ai_disabled', false);
  END IF;

  -- Return the ai_disabled status
  SELECT jsonb_build_object(
    'ai_disabled', COALESCE(l.ai_disabled, false),
    'ai_disabled_at', l.ai_disabled_at,
    'ai_disabled_by', l.ai_disabled_by
  ) INTO v_result
  FROM public.leads l
  WHERE l.id = p_lead_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_lead_ai_status IS
  'Returns ai_disabled status for a lead. Bypasses RLS so any org member can check.';

GRANT EXECUTE ON FUNCTION public.get_lead_ai_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_ai_status(UUID) TO anon;
