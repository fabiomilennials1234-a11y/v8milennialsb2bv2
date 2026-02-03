-- Uma linha por (team_member_id, resource_key, action_key). Múltiplos escopos em value_scopes JSONB.
-- Elimina constraint UNIQUE(..., value) e 409; save vira UPSERT único.
-- Data: 2026-02-23

-- 1) Adicionar coluna value_scopes (array de escopos para view/export)
ALTER TABLE public.team_member_permissions
  ADD COLUMN IF NOT EXISTS value_scopes JSONB DEFAULT NULL;

COMMENT ON COLUMN public.team_member_permissions.value_scopes IS 'Para view/export: array de escopos, ex. ["if_responsible","unassigned"]. Null = usar value.';

-- 2) Remover constraints antigas antes de consolidar
ALTER TABLE public.team_member_permissions
  DROP CONSTRAINT IF EXISTS team_member_permissions_team_member_id_resource_key_action_key_key;
ALTER TABLE public.team_member_permissions
  DROP CONSTRAINT IF EXISTS team_member_permissions_scope_unique;

-- 2b) Consolidar duplicatas: uma linha por (tm, resource, action), value_scopes = array dos values
DO $$
DECLARE
  r RECORD;
  keep_id uuid;
  scopes jsonb;
  first_val text;
BEGIN
  FOR r IN
    SELECT team_member_id, resource_key, action_key,
           array_agg(DISTINCT value) FILTER (WHERE value IS NOT NULL AND value <> 'denied') AS vals
    FROM public.team_member_permissions
    GROUP BY team_member_id, resource_key, action_key
    HAVING count(*) > 1
  LOOP
    SELECT id INTO keep_id
    FROM public.team_member_permissions
    WHERE team_member_id = r.team_member_id AND resource_key = r.resource_key AND action_key = r.action_key
    ORDER BY id LIMIT 1;
    scopes := to_jsonb(r.vals);
    IF jsonb_array_length(scopes) = 0 THEN
      scopes := NULL;
      first_val := 'denied';
    ELSE
      first_val := r.vals[1];
    END IF;
    UPDATE public.team_member_permissions
    SET value_scopes = scopes, value = first_val
    WHERE id = keep_id;
    DELETE FROM public.team_member_permissions
    WHERE team_member_id = r.team_member_id AND resource_key = r.resource_key AND action_key = r.action_key
      AND id <> keep_id;
  END LOOP;
END $$;

-- 3) Garantir uma única linha por (team_member_id, resource_key, action_key)
ALTER TABLE public.team_member_permissions
  ADD CONSTRAINT team_member_permissions_unique_slot
  UNIQUE (team_member_id, resource_key, action_key);

COMMENT ON CONSTRAINT team_member_permissions_unique_slot ON public.team_member_permissions IS 'Uma linha por (membro, recurso, ação). Múltiplos escopos em value_scopes.';

-- 4) can_see_lead: ler value_scopes quando existir
CREATE OR REPLACE FUNCTION public.can_see_lead_by_team_member_permissions(
  p_organization_id UUID,
  p_resource_key TEXT,
  p_sdr_id UUID,
  p_closer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tm_id UUID;
  v_value TEXT;
  v_value_scopes JSONB;
  v_can_see BOOLEAN := false;
BEGIN
  SELECT tm.id INTO v_tm_id
  FROM public.team_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.organization_id = p_organization_id
    AND tm.is_active = true
  LIMIT 1;

  IF v_tm_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT tmp.value, tmp.value_scopes INTO v_value, v_value_scopes
  FROM public.team_member_permissions tmp
  WHERE tmp.team_member_id = v_tm_id
    AND tmp.resource_key = p_resource_key
    AND tmp.action_key = 'view'
  LIMIT 1;

  IF v_value_scopes IS NOT NULL AND jsonb_array_length(v_value_scopes) > 0 THEN
    FOR v_value IN SELECT jsonb_array_elements_text(v_value_scopes)
    LOOP
      IF v_value = 'if_responsible' AND public.is_user_responsible(p_sdr_id, p_closer_id, NULL) THEN
        v_can_see := true;
        EXIT;
      ELSIF v_value = 'unassigned' AND public.has_no_responsible(p_sdr_id, p_closer_id, NULL) THEN
        v_can_see := true;
        EXIT;
      ELSIF v_value = 'team_access' AND public.is_responsible_in_same_org(p_sdr_id, p_closer_id) THEN
        v_can_see := true;
        EXIT;
      ELSIF v_value = 'allowed' THEN
        v_can_see := true;
        EXIT;
      END IF;
    END LOOP;
  ELSIF v_value IS NOT NULL AND v_value <> 'denied' THEN
    IF v_value = 'if_responsible' AND public.is_user_responsible(p_sdr_id, p_closer_id, NULL) THEN
      v_can_see := true;
    ELSIF v_value = 'unassigned' AND public.has_no_responsible(p_sdr_id, p_closer_id, NULL) THEN
      v_can_see := true;
    ELSIF v_value = 'team_access' AND public.is_responsible_in_same_org(p_sdr_id, p_closer_id) THEN
      v_can_see := true;
    ELSIF v_value = 'allowed' THEN
      v_can_see := true;
    END IF;
  END IF;

  RETURN v_can_see;
END;
$$;

COMMENT ON FUNCTION public.can_see_lead_by_team_member_permissions IS 'Verifica escopos de view: value_scopes (array) ou value.';

-- 5) RPC save_team_member_permissions: UPSERT uma linha por (tm, resource, action) com value_scopes
CREATE OR REPLACE FUNCTION public.save_team_member_permissions(
  p_team_member_ids uuid[],
  p_permissions jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  perm jsonb;
  v_team_member_id uuid;
  vals jsonb;
  first_val text;
  is_admin boolean;
  first_org_id uuid;
BEGIN
  IF array_length(p_team_member_ids, 1) IS NULL OR p_permissions IS NULL OR jsonb_array_length(p_permissions) = 0 THEN
    RETURN;
  END IF;

  SELECT tm.organization_id INTO first_org_id
  FROM public.team_members tm
  WHERE tm.id = p_team_member_ids[1]
  LIMIT 1;

  IF first_org_id IS NULL THEN
    RAISE EXCEPTION 'team_member_id inválido';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = auth.uid() AND tm.role = 'admin' AND tm.organization_id = first_org_id
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
  ) INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin pode alterar permissões';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = ANY(p_team_member_ids) AND tm.organization_id <> first_org_id
  ) THEN
    RAISE EXCEPTION 'Todos os membros devem ser da mesma organização';
  END IF;

  FOR v_team_member_id IN SELECT unnest(p_team_member_ids)
  LOOP
    FOR perm IN SELECT * FROM jsonb_array_elements(p_permissions)
    LOOP
      vals := COALESCE(perm->'values', '[]'::jsonb);
      IF jsonb_array_length(vals) = 0 THEN
        vals := '["denied"]'::jsonb;
      END IF;
      first_val := COALESCE(nullif(perm->'values'->>0, ''), 'denied');

      INSERT INTO public.team_member_permissions (team_member_id, resource_key, action_key, value, value_scopes)
      VALUES (
        v_team_member_id,
        (perm->>'resource_key'),
        (perm->>'action_key'),
        first_val,
        CASE WHEN (perm->>'action_key') IN ('view', 'export') AND jsonb_array_length(vals) > 0 THEN vals ELSE NULL END
      )
      ON CONFLICT (team_member_id, resource_key, action_key)
      DO UPDATE SET value = EXCLUDED.value, value_scopes = EXCLUDED.value_scopes, updated_at = NOW();
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.save_team_member_permissions IS 'UPSERT uma linha por (membro, recurso, ação). view/export: value_scopes JSONB com vários escopos.';
