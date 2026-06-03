-- Bug D (2026-06-03) — get_phone_ai_status mostrava "IA ativa" falso em master-shadow.
--
-- Sintoma: master vendo org em shadow mode via toggle "IA ativa" verde, mas a IA
-- estava DESLIGADA no gate (phone_ai_preferences.ai_disabled=true). O lead ficava
-- no vácuo e o operador não percebia.
--
-- Causa: get_phone_ai_status exige team_members membership; master NÃO é membro da
-- org-alvo → RAISE 'User is not an active member' → o hook useCopilotToggleStatus
-- cai no catch e retorna default ai_disabled=false → UI pinta "IA ativa".
--
-- Fix: bypass de master (master_users) — master lê o status de qualquer org via
-- p_organization_id explícito, sem exigir membership. Mesmo predicado usado em
-- master_set_copilot_disabled (mutação já era master-aware; faltava o read).

CREATE OR REPLACE FUNCTION public.get_phone_ai_status(p_phone text, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_org_id UUID;
  v_normalized TEXT;
  v_ai_disabled BOOLEAN;
  v_source TEXT;
  v_lead_id UUID;
  v_is_member BOOLEAN;
  v_is_master BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Master ativo: pode ler status de qualquer org (shadow mode).
  SELECT EXISTS (
    SELECT 1 FROM public.master_users
    WHERE user_id = v_user_id AND is_active = true
  ) INTO v_is_master;

  -- Resolver org: explícita > legacy
  IF p_organization_id IS NOT NULL THEN
    IF v_is_master THEN
      v_org_id := p_organization_id;  -- master bypass: sem checagem de membership
    ELSE
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
    END IF;
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
$function$;
