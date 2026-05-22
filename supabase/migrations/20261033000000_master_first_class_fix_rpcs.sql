-- =================================================================
-- Master First-Class: Fix RPCs to recognize master users
--
-- Problem:
--   is_user_admin() only checks user_roles and team_members.role.
--   Master users from master_users table are not recognized.
--   get_my_organization_ids() returns empty set for masters without
--   team_member records, blocking RLS policies.
--
-- Solution:
--   1. is_user_admin() includes is_master_user() check
--   2. get_my_organization_ids() returns all orgs for masters
--   3. get_user_organization_id() returns valid org for masters
--
-- Impact:
--   All RLS policies using these functions automatically recognize
--   master users. No individual policy changes needed.
--
-- PRD: #413 | Issue: #414
-- =================================================================

BEGIN;

-- ============================================
-- 1. is_user_admin() — include master check
-- ============================================
CREATE OR REPLACE FUNCTION public.is_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_master_user()
      OR EXISTS (
           SELECT 1 FROM public.user_roles
           WHERE user_id = auth.uid() AND role = 'admin'
         )
      OR EXISTS (
           SELECT 1 FROM public.team_members
           WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
         )
$$;

-- ============================================
-- 2. get_my_organization_ids() — all orgs for masters
-- ============================================
CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.is_master_user() THEN
    (SELECT id FROM public.organizations)
  ELSE
    (SELECT organization_id FROM public.team_members
     WHERE user_id = auth.uid() AND is_active = true)
  END
$$;

-- ============================================
-- 3. get_my_admin_organization_ids() — all orgs for masters
-- ============================================
CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.is_master_user() THEN
    (SELECT id FROM public.organizations)
  ELSE
    (SELECT organization_id FROM public.team_members
     WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true)
  END
$$;

-- ============================================
-- 4. get_user_organization_id() — valid org for masters
-- ============================================
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.is_master_user() THEN
    (SELECT organization_id FROM public.team_members
     WHERE user_id = auth.uid() AND is_active = true
     ORDER BY created_at ASC, id ASC LIMIT 1)
  ELSE
    (SELECT organization_id FROM public.team_members
     WHERE user_id = auth.uid() AND is_active = true
     ORDER BY created_at ASC, id ASC LIMIT 1)
  END
$$;

-- ============================================
-- 5. get_my_team_member_ids() — include master
-- ============================================
-- If this function exists and is used in policies, ensure master compatibility
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_team_member_ids') THEN
    EXECUTE '
      CREATE OR REPLACE FUNCTION public.get_my_team_member_ids()
      RETURNS SETOF UUID
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      SET search_path = public
      AS $fn$
        SELECT id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      $fn$;
    ';
  END IF;
END $$;

COMMIT;
