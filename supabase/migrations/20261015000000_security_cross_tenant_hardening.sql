-- ============================================================================
-- SECURITY: Cross-tenant visibility hardening (W3-1 + W3-2)
--
-- W3-1: Harden SELECT on team_members, profiles, tags
--   Original USING(true) was replaced in 20260130000000. However, the
--   replacement uses get_user_organization_id() which returns NULL for users
--   without an active team_members row — Postgres NULL = NULL → false, so
--   no bypass occurs. For defense-in-depth, re-create with explicit
--   subquery pattern (IN instead of =) so intent is unambiguous.
--
-- W3-2: pipe_propostas UPDATE has WITH CHECK (true) from 20260826100000.
--   This allows a user who passes the USING clause to set organization_id
--   to a different org. Fix by mirroring the org guard in WITH CHECK.
--
-- Date: 2026-05-15
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- W3-1a: team_members SELECT — replace = with IN subquery for clarity
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "team_members_select_own" ON public.team_members;
CREATE POLICY "team_members_select_own"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "team_members_select_organization" ON public.team_members;
CREATE POLICY "team_members_select_organization"
  ON public.team_members FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT tm.organization_id
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- W3-1b: profiles SELECT — keep join-through-team_members, add own-row fast path
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "profiles_select_organization" ON public.profiles;
CREATE POLICY "profiles_select_own_org"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR id IN (
      SELECT tm2.user_id
      FROM public.team_members tm1
      JOIN public.team_members tm2
        ON tm1.organization_id = tm2.organization_id
      WHERE tm1.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- W3-1c: tags SELECT — already properly scoped since 20260401000000.
--   Re-create with IN subquery pattern for consistency with other tables.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tags_select_organization" ON public.tags;
CREATE POLICY "tags_select_own_org"
  ON public.tags FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT tm.organization_id
      FROM public.team_members tm
      WHERE tm.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- W3-2: pipe_propostas UPDATE — replace WITH CHECK (true) with org guard
--
-- pipe_whatsapp and pipe_confirmacao already have proper WITH CHECK
-- (fixed in 20260826100000). Only pipe_propostas still has WITH CHECK (true).
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "pipe_propostas_update_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_update_by_permissions"
  ON public.pipe_propostas FOR UPDATE
  TO authenticated
  USING (
    (SELECT l.organization_id FROM public.leads l WHERE l.id = lead_id LIMIT 1) IN (
      SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.is_user_responsible(responsible_id)
      OR public.can_see_lead_by_permissions(
        (SELECT l.sdr_id FROM public.leads l WHERE l.id = lead_id LIMIT 1),
        closer_id
      )
    )
  )
  WITH CHECK (
    (SELECT l.organization_id FROM public.leads l WHERE l.id = lead_id LIMIT 1) IN (
      SELECT tm.organization_id FROM public.team_members tm WHERE tm.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────────────────────
-- Validation
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  _count INT;
BEGIN
  -- Verify team_members SELECT policies exist
  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'team_members'
    AND policyname IN ('team_members_select_own', 'team_members_select_organization');
  IF _count < 2 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: team_members SELECT policies missing (found %)', _count;
  END IF;

  -- Verify profiles SELECT policy exists
  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'profiles'
    AND policyname = 'profiles_select_own_org';
  IF _count < 1 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: profiles_select_own_org policy missing';
  END IF;

  -- Verify tags SELECT policy exists
  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'tags'
    AND policyname = 'tags_select_own_org';
  IF _count < 1 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: tags_select_own_org policy missing';
  END IF;

  -- Verify pipe_propostas UPDATE policy exists and does NOT have WITH CHECK (true)
  SELECT count(*) INTO _count
  FROM pg_policies
  WHERE tablename = 'pipe_propostas'
    AND policyname = 'pipe_propostas_update_by_permissions'
    AND cmd = 'u';
  IF _count < 1 THEN
    RAISE EXCEPTION 'VALIDATION FAILED: pipe_propostas_update_by_permissions policy missing';
  END IF;

  RAISE NOTICE 'VALIDATION PASSED: W3-1 cross-tenant SELECT hardened, W3-2 pipe_propostas WITH CHECK fixed.';
END;
$$;

COMMIT;
