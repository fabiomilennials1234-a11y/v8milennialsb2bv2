-- Permissões por membro da equipe (seleção múltipla de features)
-- Cada membro pode ter várias permissões habilitadas, independente do role.
-- Se não houver linha para um (team_member_id, permission_key), vale o padrão do role em organization_role_permissions.

CREATE TABLE IF NOT EXISTS public.team_member_org_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL CHECK (permission_key IN (
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads'
  )),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_member_id, permission_key)
);

COMMENT ON TABLE public.team_member_org_permissions IS 'Permissões por membro (seleção múltipla). Override do padrão do role; admin sempre tem todas.';

CREATE INDEX IF NOT EXISTS idx_team_member_org_permissions_team_member
  ON public.team_member_org_permissions(team_member_id);

ALTER TABLE public.team_member_org_permissions ENABLE ROW LEVEL SECURITY;

-- Ver: membros da mesma org; inserir/atualizar/deletar: apenas admin da org
DROP POLICY IF EXISTS "team_member_org_permissions_select_own_org" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_select_own_org"
  ON public.team_member_org_permissions FOR SELECT
  USING (
    team_member_id IN (
      SELECT tm.id FROM public.team_members tm
      WHERE tm.organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "team_member_org_permissions_insert_admin" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_insert_admin"
  ON public.team_member_org_permissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE ur.role = 'admin' AND tm.user_id = auth.uid()
      AND tm.organization_id = (
        SELECT organization_id FROM public.team_members WHERE id = team_member_id
      )
    )
  );

DROP POLICY IF EXISTS "team_member_org_permissions_update_admin" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_update_admin"
  ON public.team_member_org_permissions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE ur.role = 'admin' AND tm.user_id = auth.uid()
      AND tm.organization_id = (
        SELECT organization_id FROM public.team_members WHERE id = team_member_id
      )
    )
  );

DROP POLICY IF EXISTS "team_member_org_permissions_delete_admin" ON public.team_member_org_permissions;
CREATE POLICY "team_member_org_permissions_delete_admin"
  ON public.team_member_org_permissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE ur.role = 'admin' AND tm.user_id = auth.uid()
      AND tm.organization_id = (
        SELECT organization_id FROM public.team_members WHERE id = team_member_id
      )
    )
  );

-- user_has_org_permission: primeiro verifica team_member_org_permissions; se houver linha, usa; senão usa role (organization_role_permissions)
CREATE OR REPLACE FUNCTION public.user_has_org_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT true FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin' LIMIT 1),
    (SELECT tmo.enabled
     FROM public.team_member_org_permissions tmo
     JOIN public.team_members tm ON tm.id = tmo.team_member_id
     WHERE tm.user_id = auth.uid() AND tm.is_active = true
       AND tmo.permission_key = p_permission_key
     LIMIT 1),
    (SELECT orp.enabled
     FROM public.organization_role_permissions orp
     JOIN public.team_members tm ON tm.organization_id = orp.organization_id AND tm.role::text = orp.role
     WHERE tm.user_id = auth.uid() AND tm.is_active = true
       AND orp.permission_key = p_permission_key
     LIMIT 1),
    false
  )
$$;

COMMENT ON FUNCTION public.user_has_org_permission IS 'Admin sempre true. Senão: se existir team_member_org_permissions para o membro, usa; caso contrário usa organization_role_permissions por role.';

-- Master pode ver/gerenciar team_member_org_permissions
DROP POLICY IF EXISTS "master_select_all_team_member_org_permissions" ON public.team_member_org_permissions;
CREATE POLICY "master_select_all_team_member_org_permissions"
  ON public.team_member_org_permissions FOR SELECT
  USING (public.is_master_user());

DROP POLICY IF EXISTS "master_all_team_member_org_permissions" ON public.team_member_org_permissions;
CREATE POLICY "master_all_team_member_org_permissions"
  ON public.team_member_org_permissions FOR ALL
  USING (public.is_master_user());
