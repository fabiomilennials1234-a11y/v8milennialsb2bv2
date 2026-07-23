-- ============================================================================
-- SECURITY: Cross-tenant visibility hardening (W3-1 + W3-2)
--
-- W3-1: Harden SELECT on team_members, profiles, tags
--   Original USING(true) policies leaked data cross-tenant.
--   Replace with org-scoped policies using get_my_organization_ids()
--   SECURITY DEFINER function to avoid infinite recursion (a policy on
--   team_members cannot subquery team_members — Postgres error 42P17).
--
-- W3-2: pipe_propostas — SKIPPED. pipe_propostas is a VIEW in prod, not
--   a table. Views inherit security from underlying tables' RLS policies.
--
-- Date: 2026-05-15
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Helper: SECURITY DEFINER function to get current user's org IDs
-- Bypasses RLS so policies can reference it without infinite recursion.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_organization_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_organization_ids() TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- W3-1a: team_members SELECT
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "TEMPORARY: All authenticated users can see all team members" ON public.team_members;

DROP POLICY IF EXISTS "team_members_select_own" ON public.team_members;
CREATE POLICY "team_members_select_own"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "team_members_select_organization" ON public.team_members;
CREATE POLICY "team_members_select_organization"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));


-- ────────────────────────────────────────────────────────────────────────────
-- W3-1b: profiles SELECT
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Profiles são visíveis para usuários autenticados" ON public.profiles;

DROP POLICY IF EXISTS "profiles_select_own_org" ON public.profiles;
CREATE POLICY "profiles_select_own_org"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT tm.user_id
      FROM public.team_members tm
      WHERE tm.organization_id IN (SELECT public.get_my_organization_ids())
        AND tm.is_active = true
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- W3-1c: tags SELECT
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tags visíveis para autenticados" ON public.tags;

DROP POLICY IF EXISTS "tags_select_own_org" ON public.tags;
CREATE POLICY "tags_select_own_org"
  ON public.tags FOR SELECT
  TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()));


-- ────────────────────────────────────────────────────────────────────────────
-- W3-2: pipe_propostas — SKIPPED
-- pipe_propostas is a VIEW in prod. Views cannot have RLS policies.
-- Security is enforced by the underlying tables' RLS (leads, etc).
-- ────────────────────────────────────────────────────────────────────────────


-- ────────────────────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  _count INT;
BEGIN
  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'team_members'
    AND policyname IN ('team_members_select_own', 'team_members_select_organization');
  IF _count < 2 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: team_members SELECT policies missing (found %)', _count;
  END IF;

  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'profiles'
    AND policyname = 'profiles_select_own_org';
  IF _count < 1 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: profiles_select_own_org policy missing';
  END IF;

  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'tags'
    AND policyname = 'tags_select_own_org';
  IF _count < 1 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: tags_select_own_org policy missing';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: W3-1 cross-tenant hardened via get_my_organization_ids(). W3-2 skipped (view).';
END;
$$;

COMMIT;
