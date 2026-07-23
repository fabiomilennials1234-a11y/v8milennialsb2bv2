-- ============================================================================
-- Hotfix H1 — toggle_lead_ai / toggle_phone_ai / get_phone_ai_status
-- corrigir bug multi-org regressivo (LIMIT 1 em team_members).
--
-- Bug original:
--   SELECT organization_id INTO v_org_id
--   FROM team_members WHERE user_id=auth.uid() AND is_active=true LIMIT 1;
--
-- Sintoma: user com membership ativa em 2+ orgs cai na org errada. Pra
-- toggle_lead_ai isso causa RAISE 'Lead does not belong to your organization'
-- silencioso. Pra toggle_phone_ai escreve preference na org errada (pode
-- inclusive corromper dados).
--
-- Fix:
--   - toggle_lead_ai: deriva v_org_id do PRÓPRIO LEAD e valida membership
--     do user nessa org via EXISTS.
--   - toggle_phone_ai: aceita p_organization_id opcional. Frontend canônico
--     passa a org explicitamente. Sem org explícita, fallback ao comportamento
--     legacy (compat) mas com WARNING no log.
--   - get_phone_ai_status: idem.
--
-- Backward compat: assinaturas mantidas com adição de parâmetro opcional.
-- Callers antigos continuam funcionando (com fallback legacy).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- toggle_lead_ai — fix multi-org via lead-derived org
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
  v_lead_org_id UUID;
  v_normalized_phone TEXT;
  v_is_member BOOLEAN;
  v_affected_count INTEGER;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Deriva org DO LEAD (single source of truth)
  SELECT organization_id, normalized_phone
    INTO v_lead_org_id, v_normalized_phone
  FROM public.leads
  WHERE id = p_lead_id;

  IF v_lead_org_id IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- 2. Valida membership do user NA ORG DO LEAD (não em qualquer org)
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_user_id
      AND organization_id = v_lead_org_id
      AND is_active = true
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RAISE EXCEPTION 'User is not an active member of the lead organization';
  END IF;

  -- 3. Sync em leads (mantém comportamento 20260915 — duplicatas)
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

  -- 4. UPSERT em phone_ai_preferences (fonte única)
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

    INSERT INTO public.lead_history (lead_id, action, description, source, metadata)
    VALUES (
      p_lead_id,
      'ai_reactivated',
      'IA Copilot reativada pelo vendedor',
      'manual',
      jsonb_build_object(
        'reactivated_by', v_user_id,
        'synced_duplicates', v_affected_count,
        'source_rpc', 'toggle_lead_ai',
        'rpc_version', 'h1_2026-04-26'
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
        'source_rpc', 'toggle_lead_ai',
        'rpc_version', 'h1_2026-04-26'
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
  'H1 2026-04-26: deriva org do lead + valida membership do user nessa org '
  '(EXISTS) em vez de pegar primeira org do user (LIMIT 1). Resolve bug '
  'multi-org regressivo introduzido na mig 20260916000001.';

GRANT EXECUTE ON FUNCTION public.toggle_lead_ai(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- toggle_phone_ai — aceita p_organization_id opcional (canonical path)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_phone_ai(
  p_phone TEXT,
  p_disabled BOOLEAN,
  p_organization_id UUID DEFAULT NULL
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
  v_is_member BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Resolver org_id: explícita > fallback legacy LIMIT 1
  IF p_organization_id IS NOT NULL THEN
    -- Caminho canônico: frontend passou a org. Valida membership.
    SELECT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = v_user_id
        AND organization_id = p_organization_id
        AND is_active = true
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RAISE EXCEPTION 'User is not an active member of organization %', p_organization_id;
    END IF;

    v_org_id := p_organization_id;
  ELSE
    -- Caminho legacy: sem org explícita. Pega primeira org ativa do user.
    -- WARNING: comportamento ambíguo pra users multi-org. Frontend deve migrar
    -- pra passar p_organization_id explicitamente.
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = v_user_id AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'User is not a member of any organization';
    END IF;

    RAISE WARNING 'toggle_phone_ai called without p_organization_id (legacy path) — multi-org users may hit wrong org';
  END IF;

  -- 2. Normalização canônica
  v_normalized := public.normalize_brazilian_phone(p_phone);
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RAISE EXCEPTION 'Invalid phone number';
  END IF;

  -- 3. UPSERT na fonte única
  INSERT INTO public.phone_ai_preferences (
    organization_id, normalized_phone, ai_disabled, set_by, set_at
  ) VALUES (
    v_org_id, v_normalized, p_disabled, v_user_id, now()
  )
  ON CONFLICT (organization_id, normalized_phone) DO UPDATE
  SET ai_disabled = EXCLUDED.ai_disabled,
      set_by = EXCLUDED.set_by,
      set_at = EXCLUDED.set_at;

  -- 4. Sync leads (incluindo duplicatas)
  UPDATE public.leads
  SET ai_disabled = p_disabled,
      ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END,
      ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END
  WHERE organization_id = v_org_id
    AND normalized_phone = v_normalized;

  GET DIAGNOSTICS v_affected_leads = ROW_COUNT;

  -- 5. Reset conversations
  IF NOT p_disabled AND v_affected_leads > 0 THEN
    UPDATE public.conversations c
    SET state = 'QUALIFYING'
    FROM public.leads l
    WHERE c.lead_id = l.id
      AND l.organization_id = v_org_id
      AND l.normalized_phone = v_normalized
      AND c.state = 'WAITING_HUMAN';
  END IF;

  -- 6. Audit
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
        'rpc_version', 'h1_2026-04-26',
        'org_path', CASE WHEN p_organization_id IS NOT NULL THEN 'explicit' ELSE 'legacy_limit1' END,
        'normalized_phone', v_normalized,
        'affected_leads', v_affected_leads
      )
    FROM public.leads l
    WHERE l.organization_id = v_org_id
      AND l.normalized_phone = v_normalized;
  END IF;

  -- 7. Lead alvo (mais recente)
  SELECT id INTO v_target_lead_id
  FROM public.leads
  WHERE organization_id = v_org_id
    AND normalized_phone = v_normalized
  ORDER BY created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'lead_id', v_target_lead_id,
    'organization_id', v_org_id,
    'ai_disabled', p_disabled,
    'normalized_phone', v_normalized,
    'affected_leads', v_affected_leads
  );
END;
$$;

COMMENT ON FUNCTION public.toggle_phone_ai(TEXT, BOOLEAN, UUID) IS
  'H1 2026-04-26: aceita p_organization_id opcional (canonical). Valida '
  'membership do user nessa org via EXISTS. Sem org, fallback legacy LIMIT 1 '
  'com WARNING. Frontend deve passar org explicitamente.';

GRANT EXECUTE ON FUNCTION public.toggle_phone_ai(TEXT, BOOLEAN, UUID) TO authenticated;

-- Backward-compat shim: assinatura antiga (text, boolean) chama nova com NULL
CREATE OR REPLACE FUNCTION public.toggle_phone_ai(
  p_phone TEXT,
  p_disabled BOOLEAN
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.toggle_phone_ai(p_phone, p_disabled, NULL::UUID);
$$;

GRANT EXECUTE ON FUNCTION public.toggle_phone_ai(TEXT, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- get_phone_ai_status — aceita p_organization_id opcional
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_phone_ai_status(
  p_phone TEXT,
  p_organization_id UUID DEFAULT NULL
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
  v_ai_disabled BOOLEAN;
  v_source TEXT;
  v_lead_id UUID;
  v_is_member BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolver org: explícita > legacy
  IF p_organization_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = v_user_id
        AND organization_id = p_organization_id
        AND is_active = true
    ) INTO v_is_member;

    IF NOT v_is_member THEN
      RAISE EXCEPTION 'User is not an active member of organization %', p_organization_id;
    END IF;

    v_org_id := p_organization_id;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = v_user_id AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'User is not a member of any organization';
    END IF;
  END IF;

  v_normalized := public.normalize_brazilian_phone(p_phone);
  IF v_normalized IS NULL OR length(v_normalized) = 0 THEN
    RETURN jsonb_build_object(
      'ai_disabled', false,
      'source', 'invalid_phone',
      'normalized_phone', NULL
    );
  END IF;

  SELECT ai_disabled INTO v_ai_disabled
  FROM public.phone_ai_preferences
  WHERE organization_id = v_org_id
    AND normalized_phone = v_normalized;

  IF FOUND THEN
    v_source := 'preference';
  ELSE
    SELECT id, ai_disabled INTO v_lead_id, v_ai_disabled
    FROM public.leads
    WHERE organization_id = v_org_id
      AND normalized_phone = v_normalized
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_source := 'lead';
    ELSE
      v_ai_disabled := false;
      v_source := 'default';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ai_disabled', v_ai_disabled,
    'source', v_source,
    'organization_id', v_org_id,
    'normalized_phone', v_normalized,
    'lead_id', v_lead_id
  );
END;
$$;

COMMENT ON FUNCTION public.get_phone_ai_status(TEXT, UUID) IS
  'H1 2026-04-26: aceita p_organization_id opcional. Frontend canônico '
  'passa org explicita pra evitar bug multi-org.';

GRANT EXECUTE ON FUNCTION public.get_phone_ai_status(TEXT, UUID) TO authenticated;

-- Backward-compat shim
CREATE OR REPLACE FUNCTION public.get_phone_ai_status(p_phone TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_phone_ai_status(p_phone, NULL::UUID);
$$;

GRANT EXECUTE ON FUNCTION public.get_phone_ai_status(TEXT) TO authenticated;
