-- ============================================================
-- Migration: Fix infinite recursion in team_members RLS policies
-- Problem: INSERT/UPDATE/DELETE policies queried team_members inline,
--          causing RLS to re-evaluate on itself → infinite recursion.
-- Fix: Use SECURITY DEFINER function to bypass RLS in subquery.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND role = 'admin'
    AND is_active = true;
$$;

-- UPDATE
DROP POLICY IF EXISTS team_members_update_admin_org ON public.team_members;
CREATE POLICY team_members_update_admin_org ON public.team_members
  FOR UPDATE
  USING (organization_id IN (SELECT get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT get_my_admin_organization_ids()));

-- DELETE
DROP POLICY IF EXISTS team_members_delete_admin_org ON public.team_members;
CREATE POLICY team_members_delete_admin_org ON public.team_members
  FOR DELETE
  USING (organization_id IN (SELECT get_my_admin_organization_ids()));

-- INSERT
DROP POLICY IF EXISTS team_members_insert_admin_org ON public.team_members;
CREATE POLICY team_members_insert_admin_org ON public.team_members
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_my_admin_organization_ids()));
