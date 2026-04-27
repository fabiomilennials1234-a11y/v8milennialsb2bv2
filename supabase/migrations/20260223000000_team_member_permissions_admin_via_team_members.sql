-- RLS: team_member_permissions — admin via user_roles OU team_members.role = 'admin'
-- Quem é admin só pela Equipe (team_members) passa a poder INSERT/UPDATE/DELETE.
-- Data: 2026-02-23

DROP POLICY IF EXISTS "team_member_permissions_insert_admin" ON public.team_member_permissions;
DROP POLICY IF EXISTS "team_member_permissions_update_admin" ON public.team_member_permissions;
DROP POLICY IF EXISTS "team_member_permissions_delete_admin" ON public.team_member_permissions;

-- INSERT: admin em user_roles OU admin em team_members na mesma org do team_member_id alvo
CREATE POLICY "team_member_permissions_insert_admin"
  ON public.team_member_permissions FOR INSERT
  WITH CHECK (
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      WHERE tm2.organization_id IN (
        SELECT tm.organization_id FROM public.team_members tm
        WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
      )
    )
    OR
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      JOIN public.team_members tm ON tm.organization_id = tm2.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- UPDATE: mesma lógica
CREATE POLICY "team_member_permissions_update_admin"
  ON public.team_member_permissions FOR UPDATE
  USING (
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      WHERE tm2.organization_id IN (
        SELECT tm.organization_id FROM public.team_members tm
        WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
      )
    )
    OR
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      JOIN public.team_members tm ON tm.organization_id = tm2.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- DELETE: mesma lógica
CREATE POLICY "team_member_permissions_delete_admin"
  ON public.team_member_permissions FOR DELETE
  USING (
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      WHERE tm2.organization_id IN (
        SELECT tm.organization_id FROM public.team_members tm
        WHERE tm.user_id = auth.uid() AND tm.role = 'admin'
      )
    )
    OR
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      JOIN public.team_members tm ON tm.organization_id = tm2.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

COMMENT ON POLICY "team_member_permissions_insert_admin" ON public.team_member_permissions IS 'Admin via team_members.role ou user_roles.role na mesma org';
COMMENT ON POLICY "team_member_permissions_update_admin" ON public.team_member_permissions IS 'Admin via team_members.role ou user_roles.role na mesma org';
COMMENT ON POLICY "team_member_permissions_delete_admin" ON public.team_member_permissions IS 'Admin via team_members.role ou user_roles.role na mesma org';
