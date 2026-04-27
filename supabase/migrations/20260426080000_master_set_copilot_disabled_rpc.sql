-- ============================================================================
-- Hotfix H4 — master_set_copilot_disabled
--
-- Master Milennials precisa togglar copilot em qualquer org cliente sem estar
-- em team_members dessa org. RPCs existentes (toggle_lead_ai, toggle_phone_ai)
-- exigem membership.
--
-- Esta RPC bypassa team_members validando via master_users (is_active=true).
-- Audit: lead_history.metadata recebe master_user_id explícito pra trace.
--
-- Decisão CTO 2026-04-26: NÃO permite toggle anônimo (sempre registra
-- master_user_id no audit log).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.master_set_copilot_disabled(
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
  v_master_user_id UUID;
  v_lead_org_id UUID;
  v_normalized_phone TEXT;
  v_affected_count INTEGER;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validar master_users ativo
  SELECT id INTO v_master_user_id
  FROM public.master_users
  WHERE user_id = v_user_id
    AND is_active = true;

  IF v_master_user_id IS NULL THEN
    RAISE EXCEPTION 'User is not an active master admin';
  END IF;

  -- 2. Lead exists?
  SELECT organization_id, normalized_phone
    INTO v_lead_org_id, v_normalized_phone
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- 3. Sync leads (incluindo duplicatas — deve ser 0 ou 1 depois do UNIQUE INDEX H2)
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    UPDATE public.leads
    SET ai_disabled = p_disabled,
        ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
        ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
    WHERE organization_id = v_lead_org_id
      AND normalized_phone = v_normalized_phone;
  ELSE
    UPDATE public.leads
    SET ai_disabled = p_disabled,
        ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
        ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
    WHERE id = p_lead_id;
  END IF;

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  -- 4. UPSERT phone_ai_preferences
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    INSERT INTO public.phone_ai_preferences (
      organization_id, normalized_phone, ai_disabled, set_by, set_at
    ) VALUES (
      v_lead_org_id, v_normalized_phone, p_disabled, v_user_id, now()
    )
    ON CONFLICT (organization_id, normalized_phone) DO UPDATE
    SET ai_disabled = EXCLUDED.ai_disabled,
        set_by = EXCLUDED.set_by,
        set_at = EXCLUDED.set_at;
  END IF;

  -- 5. Reset conversations WAITING_HUMAN se reativando
  IF NOT p_disabled THEN
    IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
      UPDATE public.conversations c
      SET state = 'QUALIFYING'
      FROM public.leads l
      WHERE c.lead_id = l.id
        AND l.organization_id = v_lead_org_id
        AND l.normalized_phone = v_normalized_phone
        AND c.state = 'WAITING_HUMAN';
    ELSE
      UPDATE public.conversations
      SET state = 'QUALIFYING'
      WHERE lead_id = p_lead_id AND state = 'WAITING_HUMAN';
    END IF;
  END IF;

  -- 6. Audit em lead_history (master_user_id obrigatório)
  INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
  VALUES (
    p_lead_id,
    CASE WHEN p_disabled THEN 'ai_disabled' ELSE 'ai_reactivated' END,
    CASE WHEN p_disabled
      THEN 'IA Copilot desativada por Master Admin'
      ELSE 'IA Copilot reativada por Master Admin'
    END,
    -- lead_history.source CHECK accepts manual|agent|automation|system.
    -- Master flag vai em metadata.set_by_master + master_user_id.
    'system',
    jsonb_build_object(
      CASE WHEN p_disabled THEN 'disabled_by' ELSE 'reactivated_by' END, v_user_id,
      'master_user_id', v_master_user_id,
      'source_rpc', 'master_set_copilot_disabled',
      'rpc_version', 'h4_2026-04-26',
      'synced_duplicates', v_affected_count
    )
  );

  -- 7. Audit em master_audit_logs (canal Master Admin)
  -- Insere se a tabela existir (degrade graceful se schema diferente)
  BEGIN
    INSERT INTO public.master_audit_logs (
      master_user_id, user_id, action, target_type, target_id, target_name, details
    ) VALUES (
      v_master_user_id,
      v_user_id,
      CASE WHEN p_disabled THEN 'copilot_disabled' ELSE 'copilot_enabled' END,
      'lead',
      p_lead_id,
      v_normalized_phone,
      jsonb_build_object(
        'organization_id', v_lead_org_id,
        'ai_disabled', p_disabled,
        'normalized_phone', v_normalized_phone,
        'synced_duplicates', v_affected_count
      )
    );
  EXCEPTION WHEN undefined_table OR undefined_column OR datatype_mismatch THEN
    RAISE NOTICE 'master_audit_logs not present or schema mismatch — skipping master log';
  END;

  SELECT to_jsonb(l) INTO v_result
  FROM public.leads l
  WHERE l.id = p_lead_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.master_set_copilot_disabled IS
  'H4 2026-04-26: bypass team_members pra master admin desligar copilot em '
  'qualquer org cliente. Audit obrigatório em lead_history + master_audit_logs.';

GRANT EXECUTE ON FUNCTION public.master_set_copilot_disabled(UUID, BOOLEAN) TO authenticated;
