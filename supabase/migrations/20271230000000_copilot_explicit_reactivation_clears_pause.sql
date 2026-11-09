-- Explicit Copilot activation must clear both canonical and conversation pauses.
-- Preserves membership/master checks, duplicate synchronization, history and ACLs.
-- Generated with "supabase migration new"; ordered after the repository's
-- 20271229000000 migration so older RPC definitions cannot overwrite this fix.

CREATE OR REPLACE FUNCTION public.toggle_lead_ai(p_lead_id uuid, p_disabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Explicit enable overrides the temporary pause created by a manual send.
  -- Keep automatic pause behavior unchanged for subsequent human messages.
  IF NOT p_disabled THEN
    IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
      UPDATE public.phone_ai_preferences
      SET human_paused_until = NULL, updated_at = now()
      WHERE organization_id = v_lead_org_id
        AND normalized_phone = v_normalized_phone
        AND human_paused_until IS NOT NULL;

      UPDATE public.conversations c
      SET human_paused_until = NULL, updated_at = now()
      FROM public.leads l
      WHERE c.lead_id = l.id
        AND c.organization_id = v_lead_org_id
        AND l.organization_id = v_lead_org_id
        AND l.normalized_phone = v_normalized_phone
        AND c.human_paused_until IS NOT NULL;
    ELSE
      UPDATE public.conversations
      SET human_paused_until = NULL, updated_at = now()
      WHERE organization_id = v_lead_org_id
        AND lead_id = p_lead_id
        AND human_paused_until IS NOT NULL;
    END IF;
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
$function$;

CREATE OR REPLACE FUNCTION public.toggle_phone_ai(p_phone text, p_disabled boolean, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Explicit enable overrides the temporary pause created by a manual send.
  -- Keep automatic pause behavior unchanged for subsequent human messages.
  IF NOT p_disabled THEN
    IF v_normalized IS NOT NULL AND length(v_normalized) > 0 THEN
      UPDATE public.phone_ai_preferences
      SET human_paused_until = NULL, updated_at = now()
      WHERE organization_id = v_org_id
        AND normalized_phone = v_normalized
        AND human_paused_until IS NOT NULL;

      UPDATE public.conversations c
      SET human_paused_until = NULL, updated_at = now()
      FROM public.leads l
      WHERE c.lead_id = l.id
        AND c.organization_id = v_org_id
        AND l.organization_id = v_org_id
        AND l.normalized_phone = v_normalized
        AND c.human_paused_until IS NOT NULL;
    END IF;
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.master_set_copilot_disabled(p_lead_id uuid, p_disabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID; v_master_user_id UUID; v_lead_org_id UUID; v_normalized_phone TEXT; v_affected_count INTEGER; v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_master_user_id FROM public.master_users WHERE user_id = v_user_id AND is_active = true;
  IF v_master_user_id IS NULL THEN RAISE EXCEPTION 'User is not an active master admin'; END IF;
  SELECT organization_id, normalized_phone INTO v_lead_org_id, v_normalized_phone FROM public.leads WHERE id = p_lead_id;
  IF v_lead_org_id IS NULL THEN RAISE EXCEPTION 'Lead not found'; END IF;
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    UPDATE public.leads SET ai_disabled = p_disabled, ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END, ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END WHERE organization_id = v_lead_org_id AND normalized_phone = v_normalized_phone;
  ELSE
    UPDATE public.leads SET ai_disabled = p_disabled, ai_disabled_at = CASE WHEN p_disabled THEN now() ELSE NULL END, ai_disabled_by = CASE WHEN p_disabled THEN v_user_id ELSE NULL END WHERE id = p_lead_id;
  END IF;
  GET DIAGNOSTICS v_affected_count = ROW_COUNT;
  IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
    INSERT INTO public.phone_ai_preferences (organization_id, normalized_phone, ai_disabled, set_by, set_at) VALUES (v_lead_org_id, v_normalized_phone, p_disabled, v_user_id, now())
    ON CONFLICT (organization_id, normalized_phone) DO UPDATE SET ai_disabled = EXCLUDED.ai_disabled, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
  END IF;
  -- Explicit enable overrides the temporary pause created by a manual send.
  -- Keep automatic pause behavior unchanged for subsequent human messages.
  IF NOT p_disabled THEN
    IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
      UPDATE public.phone_ai_preferences
      SET human_paused_until = NULL, updated_at = now()
      WHERE organization_id = v_lead_org_id
        AND normalized_phone = v_normalized_phone
        AND human_paused_until IS NOT NULL;

      UPDATE public.conversations c
      SET human_paused_until = NULL, updated_at = now()
      FROM public.leads l
      WHERE c.lead_id = l.id
        AND c.organization_id = v_lead_org_id
        AND l.organization_id = v_lead_org_id
        AND l.normalized_phone = v_normalized_phone
        AND c.human_paused_until IS NOT NULL;
    ELSE
      UPDATE public.conversations
      SET human_paused_until = NULL, updated_at = now()
      WHERE organization_id = v_lead_org_id
        AND lead_id = p_lead_id
        AND human_paused_until IS NOT NULL;
    END IF;
  END IF;

  IF NOT p_disabled THEN
    IF v_normalized_phone IS NOT NULL AND length(v_normalized_phone) > 0 THEN
      UPDATE public.conversations c SET state = 'QUALIFYING' FROM public.leads l WHERE c.lead_id = l.id AND l.organization_id = v_lead_org_id AND l.normalized_phone = v_normalized_phone AND c.state = 'WAITING_HUMAN';
    ELSE
      UPDATE public.conversations SET state = 'QUALIFYING' WHERE lead_id = p_lead_id AND state = 'WAITING_HUMAN';
    END IF;
  END IF;
  INSERT INTO public.lead_history (lead_id, action, description, source, metadata) VALUES (p_lead_id, CASE WHEN p_disabled THEN 'ai_disabled' ELSE 'ai_reactivated' END, CASE WHEN p_disabled THEN 'IA Copilot desativada por Master Admin' ELSE 'IA Copilot reativada por Master Admin' END, 'system', jsonb_build_object(CASE WHEN p_disabled THEN 'disabled_by' ELSE 'reactivated_by' END, v_user_id, 'master_user_id', v_master_user_id, 'source_rpc', 'master_set_copilot_disabled', 'rpc_version', 'h4_2026-04-26_hotfix2', 'set_by_master', true, 'synced_duplicates', v_affected_count));
  BEGIN
    INSERT INTO public.master_audit_logs (master_user_id, user_id, action, target_type, target_id, target_name, details) VALUES (v_master_user_id, v_user_id, CASE WHEN p_disabled THEN 'copilot_disabled' ELSE 'copilot_enabled' END, 'lead', p_lead_id, v_normalized_phone, jsonb_build_object('organization_id', v_lead_org_id, 'ai_disabled', p_disabled, 'normalized_phone', v_normalized_phone, 'synced_duplicates', v_affected_count));
  EXCEPTION WHEN undefined_table OR undefined_column OR datatype_mismatch THEN RAISE NOTICE 'master_audit_logs schema mismatch — skipping'; END;
  SELECT to_jsonb(l) INTO v_result FROM public.leads l WHERE l.id = p_lead_id;
  RETURN v_result;
END; $function$;
