-- Fix remaining RLS infinite recursion for Realtime
-- commissions + goals policies had inline FROM team_members
-- which triggers RLS recursion when Realtime evaluates apply_rls()

-- Helper: all team_member_ids in the current user's orgs (bypasses RLS)
CREATE OR REPLACE FUNCTION get_org_team_member_ids()
RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT id FROM public.team_members
  WHERE organization_id IN (SELECT public.get_my_organization_ids())
$$;

-- commissions: replace inline team_members join
DROP POLICY IF EXISTS commissions_select_org ON commissions;
CREATE POLICY commissions_select_org ON commissions FOR SELECT USING (
  team_member_id IN (SELECT get_my_team_member_ids())
  OR team_member_id IN (SELECT get_org_team_member_ids())
);

-- goals: replace inline team_members join
DROP POLICY IF EXISTS goals_select_org ON goals;
CREATE POLICY goals_select_org ON goals FOR SELECT USING (
  team_member_id IN (SELECT get_my_team_member_ids())
  OR team_member_id IN (SELECT get_org_team_member_ids())
);

DROP POLICY IF EXISTS goals_manage_admin_org ON goals;
CREATE POLICY goals_manage_admin_org ON goals FOR ALL USING (
  (is_user_admin() OR is_master_user())
  AND team_member_id IN (SELECT get_org_team_member_ids())
);
