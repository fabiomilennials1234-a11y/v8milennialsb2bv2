-- ============================================================================
-- Atribuição de autor nos eventos ai_disabled / ai_reactivated do lead_history.
--
-- Problema: toggle_lead_ai / toggle_phone_ai gravavam lead_history com
-- created_by NULL, organization_id NULL e description genérica
-- ("IA Copilot desativada pelo vendedor"). O autor real ficava só em
-- metadata.disabled_by (UUID), que a timeline não resolve.
--
-- Fix:
--   1. created_by = auth.uid() e organization_id preenchidos no INSERT.
--   2. description embute o nome do team_member (fallback: texto genérico).
--   3. metadata ganha disabled_by_name / reactivated_by_name.
--   4. rpc_version bump → h2_2026-06-11.
--
-- IMPORTANTE — fonte desta definição: função LIVE de prod (h1_2026-04-26),
-- que difere da migration 20260916000001 no repo. A live valida membership
-- na org DO LEAD (toggle_lead_ai) e tem overload com p_organization_id
-- explícito (toggle_phone_ai). Esta migration re-baseia sobre a live para
-- não regredir esses fixes. O wrapper toggle_phone_ai(text, boolean) não
-- muda (delega pro 3-arg).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- toggle_lead_ai — atribuição de autor
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
  v_user_name TEXT;
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

  -- 2b. Nome do autor para atribuição no histórico (NULL se não resolver)
  SELECT name INTO v_user_name
  FROM public.team_members
  WHERE user_id = v_user_id
    AND organization_id = v_lead_org_id
    AND is_active = true
  LIMIT 1;

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

    INSERT INTO public.lead_history (
      lead_id, organization_id, action, description, source, metadata, created_by
    )
    VALUES (
      p_lead_id,
      v_lead_org_id,
      'ai_reactivated',
      CASE WHEN v_user_name IS NOT NULL AND length(trim(v_user_name)) > 0
        THEN 'IA Copilot reativada por ' || v_user_name
        ELSE 'IA Copilot reativada pelo vendedor'
      END,
      'manual',
      jsonb_build_object(
        'reactivated_by', v_user_id,
        'reactivated_by_name', v_user_name,
        'synced_duplicates', v_affected_count,
        'source_rpc', 'toggle_lead_ai',
        'rpc_version', 'h2_2026-06-11'
      ),
      v_user_id
    );
  ELSE
    INSERT INTO public.lead_history (
      lead_id, organization_id, action, description, source, metadata, created_by
    )
    VALUES (
      p_lead_id,
      v_lead_org_id,
      'ai_disabled',
      CASE WHEN v_user_name IS NOT NULL AND length(trim(v_user_name)) > 0
        THEN 'IA Copilot desativada por ' || v_user_name
        ELSE 'IA Copilot desativada pelo vendedor'
      END,
      'manual',
      jsonb_build_object(
        'disabled_by', v_user_id,
        'disabled_by_name', v_user_name,
        'synced_duplicates', v_affected_count,
        'source_rpc', 'toggle_lead_ai',
        'rpc_version', 'h2_2026-06-11'
      ),
      v_user_id
    );
  END IF;

  SELECT to_jsonb(l) INTO v_result
  FROM public.leads l
  WHERE l.id = p_lead_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.toggle_lead_ai(UUID, BOOLEAN) IS
  'Toggle Copilot AI por lead_id. Org derivada do lead + membership validado. '
  'Sincroniza duplicatas (normalized_phone) e phone_ai_preferences. '
  'h2_2026-06-11: lead_history com created_by/organization_id e nome do autor.';

-- ----------------------------------------------------------------------------
-- toggle_phone_ai (3-arg) — atribuição de autor
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.toggle_phone_ai(
  p_phone TEXT,
  p_disabled BOOLEAN,
  p_organization_id UUID DEFAULT NULL::uuid
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_name TEXT;
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

  -- 1b. Nome do autor para atribuição no histórico (NULL se não resolver)
  SELECT name INTO v_user_name
  FROM public.team_members
  WHERE user_id = v_user_id
    AND organization_id = v_org_id
    AND is_active = true
  LIMIT 1;

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
    INSERT INTO public.lead_history (
      lead_id, organization_id, action, description, source, metadata, created_by
    )
    SELECT
      l.id,
      v_org_id,
      CASE WHEN p_disabled THEN 'ai_disabled' ELSE 'ai_reactivated' END,
      CASE
        WHEN v_user_name IS NOT NULL AND length(trim(v_user_name)) > 0 THEN
          CASE WHEN p_disabled
            THEN 'IA Copilot desativada por ' || v_user_name
            ELSE 'IA Copilot reativada por ' || v_user_name
          END
        ELSE
          CASE WHEN p_disabled
            THEN 'IA Copilot desativada pelo vendedor (via chat sem lead focado)'
            ELSE 'IA Copilot reativada pelo vendedor (via chat sem lead focado)'
          END
      END,
      'manual',
      jsonb_build_object(
        CASE WHEN p_disabled THEN 'disabled_by' ELSE 'reactivated_by' END, v_user_id,
        CASE WHEN p_disabled THEN 'disabled_by_name' ELSE 'reactivated_by_name' END, v_user_name,
        'source_rpc', 'toggle_phone_ai',
        'rpc_version', 'h2_2026-06-11',
        'org_path', CASE WHEN p_organization_id IS NOT NULL THEN 'explicit' ELSE 'legacy_limit1' END,
        'normalized_phone', v_normalized,
        'affected_leads', v_affected_leads
      ),
      v_user_id
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
  'Toggle Copilot AI por telefone. Org explícita validada (fallback legacy LIMIT 1). '
  'h2_2026-06-11: lead_history com created_by/organization_id e nome do autor.';
