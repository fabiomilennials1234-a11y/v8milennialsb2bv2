-- RPC para salvar permissões. Substituída em 20260223000003 para usar value_scopes (uma linha por slot).
-- Esta versão usa DELETE + INSERT múltiplas linhas (compatível com schema antes de 000003).
-- Data: 2026-02-23

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
  v_value text;
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
      DELETE FROM public.team_member_permissions
      WHERE team_member_id = v_team_member_id
        AND resource_key = (perm->>'resource_key')
        AND action_key = (perm->>'action_key');
    END LOOP;
  END LOOP;

  FOR v_team_member_id IN SELECT unnest(p_team_member_ids)
  LOOP
    FOR perm IN SELECT * FROM jsonb_array_elements(p_permissions)
    LOOP
      FOR v_value IN SELECT jsonb_array_elements_text(
        CASE WHEN jsonb_array_length(perm->'values') > 0 THEN perm->'values' ELSE '["denied"]'::jsonb END
      )
      LOOP
        IF v_value IS NOT NULL AND v_value <> '' THEN
          INSERT INTO public.team_member_permissions (team_member_id, resource_key, action_key, value)
          VALUES (v_team_member_id, (perm->>'resource_key'), (perm->>'action_key'), v_value);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.save_team_member_permissions IS 'Salva permissões. Substituída em 000003 por versão com value_scopes (uma linha por slot).';
