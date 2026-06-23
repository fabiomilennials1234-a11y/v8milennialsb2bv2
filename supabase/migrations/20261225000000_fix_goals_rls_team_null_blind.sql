-- =============================================================================
-- Fix: goals RLS is NULL-blind on team_member_id → team-level goals (the DEFAULT
-- "Meta do Time" in GestaoMetas / Performance > Gestão) can be neither inserted
-- nor selected by ANY role (admin, membro, master).
--
-- Root cause: every prior goals policy gated visibility/manage through
--   EXISTS (SELECT 1 FROM team_members WHERE team_members.id = goals.team_member_id ...)
-- When goals.team_member_id IS NULL (team goal), `id = NULL` → NULL → never TRUE,
-- so the EXISTS is always false. Result:
--   • INSERT team goal  → WITH CHECK false → RLS rejected (admin AND master)
--   • SELECT team goal  → false → invisible to everyone (goals has no master_ghost)
-- Individual goals (team_member_id set) were unaffected, which is why the bug
-- looked partial.
--
-- Fix: gate directly on goals.organization_id (added in 20260124000000, populated
-- by every write path). NULL-safe, covers team + individual goals, and restores a
-- master branch. Membros keep read-only org-wide visibility (needed for ranking /
-- Metas display); only admin/master can write.
-- =============================================================================

DROP POLICY IF EXISTS goals_select_org           ON public.goals;
DROP POLICY IF EXISTS goals_manage_admin_org      ON public.goals;
DROP POLICY IF EXISTS "Goals visíveis para autenticados"      ON public.goals;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar goals"   ON public.goals;

-- SELECT: any member of the org sees all org goals (team + individual); master ghost.
CREATE POLICY goals_select_org ON public.goals
  FOR SELECT TO authenticated
  USING (
    public.is_master_user()
    OR organization_id = public.get_user_organization_id()
  );

-- MANAGE (INSERT/UPDATE/DELETE): admin within own org, or master (cross-org ghost).
CREATE POLICY goals_manage_admin_org ON public.goals
  FOR ALL TO authenticated
  USING (
    public.is_master_user()
    OR (public.is_user_admin() AND organization_id = public.get_user_organization_id())
  )
  WITH CHECK (
    public.is_master_user()
    OR (public.is_user_admin() AND organization_id = public.get_user_organization_id())
  );
