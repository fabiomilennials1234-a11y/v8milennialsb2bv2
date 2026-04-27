-- ============================================================================
-- RPCs para phone_ai_preferences + sync bidirecional com leads.
--
-- Provides:
--   toggle_phone_ai(p_phone, p_disabled)       — NEW. Substitui toggle_conversation_ai.
--   get_phone_ai_status(p_phone)               — NEW. Leitura sem lead obrigatório.
--   toggle_lead_ai(p_lead_id, p_disabled)      — MODIFIED. Adiciona UPSERT em preferences.
--   toggle_conversation_ai(p_phone, p_disabled)— DROPPED. Bugada por enum inválido.
--
-- Garantias:
--   - Nunca mais cria shadow lead com origin='shadow_ai_toggle'.
--   - toggle_lead_ai mantém a sincronização de duplicatas da migration
--     20260915000000_toggle_lead_ai_sync_duplicates.
--   - toggle_phone_ai também sincroniza duplicatas via UPDATE em todos leads
--     com mesmo (org, normalized_phone).
--   - Fonte única: phone_ai_preferences. leads.ai_disabled é denormalização.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Drop RPC quebrada (não versionada, criada direto no banco)
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.toggle_conversation_ai(text, boolean) CASCADE;

-- ----------------------------------------------------------------------------
-- toggle_phone_ai — Nova RPC, alinhada a toggle_lead_ai
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_phone_ai(
  p_phone TEXT,
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
  v_normalized TEXT;
  v_affected_leads INTEGER := 0;
  v_target_lead_id UUID;
BEGIN
  -- 1. Autenticação
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Organização via team_members ativo
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User is not a member of any organization';
  END IF;

  -- 3. Normalização canônica (mesma usada em leads.normalized_phone)
  v_normalized := public.normalize_brazilian_phone(p_phone);
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  -- 4. UPSERT na fonte única de verdade
  INSERT INTO public.phone_ai_preferences (
    organization_id, normalized_phone, ai_disabled, set_by, set_at
  ) VALUES (
    v_org_id, v_normalized, p_disabled, v_user_id, now()
  )
  ON CONFLICT (organization_id, normalized_phone) DO UPDATE
  SET ai_disabled = EXCLUDED.ai_disabled,
      set_by = EXCLUDED.set_by,
      set_at = EXCLUDED.set_at;

  -- 5. Sincroniza todos leads com mesmo normalized_phone (duplicatas incluídas)
  UPDATE public.leads
  SET ai_disabled = p_disabled,
      ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
      ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
  WHERE organization_id = v_org_id
    AND normalized_phone = v_normalized;

  GET DIAGNOSTICS v_affected_leads = ROW_COUNT;

  -- 6. Reset conversations WAITING_HUMAN se reativando
  IF NOT p_disabled AND v_affected_leads > 0 THEN
    UPDATE public.conversations c
    SET state = 'QUALIFYING'
    FROM public.leads l
    WHERE c.lead_id = l.id
      AND l.organization_id = v_org_id
      AND l.normalized_phone = v_normalized
      AND c.state = 'WAITING_HUMAN';
  END IF;

  -- 7. Audit em lead_history por lead afetado
  IF v_affected_leads > 0 THEN
    INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
    SELECT
      l.id,
      CASE WHEN p_disabled THEN 'ai_disabled' ELSE 'ai_reactivated' END,
      CASE WHEN p_disabled
        THEN 'IA Copilot desativada pelo vendedor (via chat sem lead focado)'
        ELSE 'IA Copilot reativada pelo vendedor (via chat sem lead focado)'
      END,
      'manual',
      jsonb_build_object(
        CASE WHEN p_disabled THEN 'disabled_by' ELSE 'reactivated_by' END, v_user_id,
        'source_rpc', 'toggle_phone_ai',
        'normalized_phone', v_normalized,
        'affected_leads', v_affected_leads
      )
    FROM public.leads l
    WHERE l.organization_id = v_org_id
      AND l.normalized_phone = v_normalized;
  END IF;

  -- 8. Retorna o lead mais recente (se houver) + preferência
  SELECT id INTO v_target_lead_id
  FROM public.leads
  WHERE organization_id = v_org_id
    AND normalized_phone = v_normalized
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'lead_id', v_target_lead_id,
    'ai_disabled', p_disabled,
    'normalized_phone', v_normalized,
    'affected_leads', v_affected_leads
  );
END;
$$;

COMMENT ON FUNCTION public.toggle_phone_ai IS
  'Toggle Copilot AI por telefone. Fonte única em phone_ai_preferences, '
  'sincroniza leads.ai_disabled em todos os leads com mesmo normalized_phone. '
  'Nunca cria shadow lead. Substitui toggle_conversation_ai (removida).';

GRANT EXECUTE ON FUNCTION public.toggle_phone_ai(TEXT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- get_phone_ai_status — leitura por telefone
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_phone_ai_status(p_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_normalized TEXT;
  v_ai_disabled BOOLEAN;
  v_source TEXT;
  v_lead_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User is not a member of any organization';
  END IF;

  v_normalized := public.normalize_brazilian_phone(p_phone);
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RETURN jsonb_build_object(
      'ai_disabled', false,
      'source', 'invalid_phone',
      'normalized_phone', NULL
    );
  END IF;

  -- 1. Preferência explícita tem prioridade
  SELECT ai_disabled INTO v_ai_disabled
  FROM public.phone_ai_preferences
  WHERE organization_id = v_org_id
    AND normalized_phone = v_normalized;

  IF FOUND THEN
    v_source := 'preference';
  ELSE
    -- 2. Fallback para lead existente (preferência nunca foi salva,
    --    mas pode haver lead com flag legada)
    SELECT id, ai_disabled INTO v_lead_id, v_ai_disabled
    FROM public.leads
    WHERE organization_id = v_org_id
      AND normalized_phone = v_normalized
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_source := 'lead';
    ELSE
      -- 3. Default: IA ligada
      v_ai_disabled := false;
      v_source := 'default';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ai_disabled', v_ai_disabled,
    'source', v_source,
    'normalized_phone', v_normalized,
    'lead_id', v_lead_id
  );
END;
$$;

COMMENT ON FUNCTION public.get_phone_ai_status IS
  'Lê ai_disabled por telefone. Prioridade: phone_ai_preferences > leads (lead '
  'mais recente) > default(false). Retorna source indicando origem da resposta.';

GRANT EXECUTE ON FUNCTION public.get_phone_ai_status(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- toggle_lead_ai — reescrita preservando comportamento da 20260915000000 +
-- adicionando UPSERT em phone_ai_preferences para ser fonte única coerente.
-- ----------------------------------------------------------------------------

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
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'User is not a member of any organization';
  END IF;

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

  -- Sync em leads (comportamento da 20260915)
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    UPDATE public.leads
    SET ai_disabled = p_disabled,
        ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
        ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
    WHERE organization_id = v_org_id
      AND normalized_phone = v_normalized_phone;
  ELSE
    UPDATE public.leads
    SET ai_disabled = p_disabled,
        ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
        ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
    WHERE id = p_lead_id;
  END IF;

  GET DIAGNOSTICS v_affected_count = ROW_COUNT;

  -- NOVO: UPSERT em phone_ai_preferences para manter fonte única coerente
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    INSERT INTO public.phone_ai_preferences (
      organization_id, normalized_phone, ai_disabled, set_by, set_at
    ) VALUES (
      v_org_id, v_normalized_phone, p_disabled, v_user_id, now()
    )
    ON CONFLICT (organization_id, normalized_phone) DO UPDATE
    SET ai_disabled = EXCLUDED.ai_disabled,
        set_by = EXCLUDED.set_by,
        set_at = EXCLUDED.set_at;
  END IF;

  -- Reset conversations se reativando
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
        'synced_duplicates', v_affected_count,
        'source_rpc', 'toggle_lead_ai'
      )
    );
  ELSE
    INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
    VALUES (
      p_lead_id,
      'ai_disabled',
      'IA Copilot desativada pelo vendedor',
      'manual',
      jsonb_build_object(
        'disabled_by', v_user_id,
        'synced_duplicates', v_affected_count,
        'source_rpc', 'toggle_lead_ai'
      )
    );
  END IF;

  SELECT to_jsonb(l) INTO v_result
  FROM public.leads l
  WHERE l.id = p_lead_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.toggle_lead_ai IS
  'Toggle Copilot AI por lead_id. Sincroniza duplicatas com mesmo normalized_phone '
  '(comportamento 20260915). Também UPSERT phone_ai_preferences para fonte única '
  'coerente — novos leads com mesmo telefone herdarão a preferência.';

GRANT EXECUTE ON FUNCTION public.toggle_lead_ai(UUID, BOOLEAN) TO authenticated;
