-- ============================================================================
-- P0 FIX: toggle_lead_ai sincroniza flag em TODOS os leads com mesmo telefone
--
-- Motivação: incidente REALSC (2026-04-15). O atendente desativou IA num
-- lead_id específico, mas o webhook (evolution-webhook, agent-message,
-- sz-chat-webhook) resolve o lead via findLeadByPhoneOrEmail, que faz
--   ORDER BY created_at DESC LIMIT 1
-- Com leads duplicados (mesma org, mesmo normalized_phone), o flag foi
-- gravado no lead antigo mas o webhook respondia pelo lead recente com
-- ai_disabled=false → Copilot continuou respondendo mesmo com IA "off".
--
-- Solução cirúrgica (P0): a RPC aplica o flag em TODOS os leads da mesma
-- organização com o mesmo normalized_phone. Duplicatas passam a ter
-- estado consistente. Não mexe em dados históricos, não consolida leads —
-- isso fica para P2 (merge + unique constraint).
--
-- Date: 2026-09-15
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
  v_normalized_phone TEXT;
  v_affected_count INTEGER;
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

  -- Load target lead (org + normalized_phone)
  SELECT organization_id, normalized_phone
    INTO v_lead_org_id, v_normalized_phone
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  IF v_lead_org_id != v_org_id THEN
    RAISE EXCEPTION 'Lead does not belong to your organization';
  END IF;

  -- Toggle: aplica no lead alvo + em todas as duplicatas com mesmo
  -- normalized_phone dentro da mesma org. Se normalized_phone for NULL,
  -- aplica só no lead alvo (fallback seguro).
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    UPDATE public.leads
    SET
      ai_disabled = p_disabled,
      ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
      ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
    WHERE organization_id = v_org_id
      AND normalized_phone = v_normalized_phone;
  ELSE
    UPDATE public.leads
    SET
      ai_disabled = p_disabled,
      ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
      ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
    WHERE id = p_lead_id;
  END IF;

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  -- When reactivating: reset conversation state for ALL affected leads and log
  IF NOT p_disabled THEN
    IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
      UPDATE public.conversations c
      SET state = 'QUALIFYING'
      FROM public.leads l
      WHERE c.lead_id = l.id
        AND l.organization_id = v_org_id
        AND l.normalized_phone = v_normalized_phone
        AND c.state = 'WAITING_HUMAN';
    ELSE
      UPDATE public.conversations
      SET state = 'QUALIFYING'
      WHERE lead_id = p_lead_id AND state = 'WAITING_HUMAN';
    END IF;

    INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
    VALUES (
      p_lead_id,
      'ai_reactivated',
      'IA Copilot reativada pelo vendedor',
      'manual',
      jsonb_build_object(
        'reactivated_by', v_user_id,
        'synced_duplicates', v_affected_count
      )
    );
  ELSE
    -- P3 parcial: audit também na desativação (antes só logava reativação)
    INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
    VALUES (
      p_lead_id,
      'ai_disabled',
      'IA Copilot desativada pelo vendedor',
      'manual',
      jsonb_build_object(
        'disabled_by', v_user_id,
        'synced_duplicates', v_affected_count
      )
    );
  END IF;

  -- Return updated target lead
  SELECT to_jsonb(l) INTO v_result
  FROM public.leads l
  WHERE l.id = p_lead_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.toggle_lead_ai IS
  'Toggle Copilot AI on/off for a lead. Applies to all leads in the same organization sharing normalized_phone (handles duplicate leads). Any team member in the same organization can use this.';

GRANT EXECUTE ON FUNCTION public.toggle_lead_ai(UUID, BOOLEAN) TO authenticated;
