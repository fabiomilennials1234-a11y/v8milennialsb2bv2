-- supabase/tests/rls_invariants_red_fixture.sql
--
-- RED proof for the RLS invariant suite (issue #638). This is the TDD
-- demonstration: it injects one deliberately-bad object per invariant, then
-- asserts the *same* detectors used by the clean suite now report the
-- violation. If a detector failed to catch its planted violation, this file
-- goes RED — which is what guarantees the green suite is actually load-bearing
-- and not vacuously passing.
--
-- Everything runs inside a single transaction that is ROLLED BACK at the end,
-- so the bad objects never persist. Safe to run against any throwaway DB.
--
--   pg_prove --ext .sql -d "$DATABASE_URL" supabase/tests/rls_invariants_red_fixture.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

\ir _rls_invariants_detectors.sql

SELECT plan(7);

-- ===========================================================================
-- Baseline assertions: with NO bad objects planted yet, detectors that look at
-- *temp* fixture objects are empty. (We can't assert the whole DB is clean here
-- because that's the job of rls_invariants.sql; instead we assert each detector
-- starts not-seeing our fixture, then sees it after planting.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- INV-1 fixture: a table with organization_id + a {authenticated} USING(true)
-- policy. Detector MUST flag it.
-- ---------------------------------------------------------------------------
CREATE TABLE public._rls_inv_bad_org_tbl (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
);
ALTER TABLE public._rls_inv_bad_org_tbl ENABLE ROW LEVEL SECURITY;

-- pre-condition: no open policy yet on this fixture table
SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_open_policies_on_org_tables()
     WHERE tablename = '_rls_inv_bad_org_tbl'),
  0,
  'INV-1 RED setup: fixture table has no open policy before planting'
);

CREATE POLICY "_rls_inv_open" ON public._rls_inv_bad_org_tbl
  FOR SELECT TO authenticated USING (true);

-- post-condition: detector now flags the {authenticated} USING(true) policy
SELECT isnt(
  (SELECT count(*)::int FROM public._rls_inv_open_policies_on_org_tables()
     WHERE tablename = '_rls_inv_bad_org_tbl'),
  0,
  'INV-1 RED: detector flags authenticated USING(true) policy on org table'
);

-- ---------------------------------------------------------------------------
-- INV-2 fixture: a writing SECURITY DEFINER function EXECUTE-able by PUBLIC
-- (default grant). Detector MUST flag it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv_bad_writer(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $bad$
BEGIN
  -- writing body: should be caught by the INSERT INTO matcher
  INSERT INTO public._rls_inv_bad_org_tbl (organization_id) VALUES (p_org);
END;
$bad$;
-- leave the default PUBLIC EXECUTE grant in place (the violation)

SELECT isnt(
  (SELECT count(*)::int FROM public._rls_inv_writing_definer_exec_by_anon_or_public()
     WHERE functionname = '_rls_inv_bad_writer'),
  0,
  'INV-2 RED: detector flags writing DEFINER function executable by PUBLIC'
);

-- and once the function is out of reach, the detector clears it.
--
-- REVOKE FROM PUBLIC alone does NOT clear it, and that is not a detector bug —
-- it is the Supabase default privilege (SCRUM-361). Every function created in
-- `public` is born with an EXPLICIT grant to `anon`, `authenticated` and
-- `service_role` (ALTER DEFAULT PRIVILEGES, shipped with the platform), on top
-- of the PUBLIC default. Dropping PUBLIC leaves anon's own grant standing, and
-- the detector — correctly — keeps flagging a writing DEFINER function that
-- anon can call.
--
-- This is the same trap in reverse of the one that made `REVOKE ... FROM anon`
-- read as a no-op elsewhere in the repo: whoever revokes has to name every
-- grantee, because the two grants are independent.
REVOKE EXECUTE ON FUNCTION public._rls_inv_bad_writer(uuid) FROM PUBLIC, anon, authenticated;
SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_writing_definer_exec_by_anon_or_public()
     WHERE functionname = '_rls_inv_bad_writer'),
  0,
  'INV-2 GREEN-after-fix: revoking PUBLIC EXECUTE clears the violation'
);

-- ---------------------------------------------------------------------------
-- INV-3 fixture: a table with organization_id but RLS DISABLED.
-- Detector MUST flag it.
-- ---------------------------------------------------------------------------
CREATE TABLE public._rls_inv_bad_no_rls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
);
-- intentionally NOT enabling RLS

SELECT isnt(
  (SELECT count(*)::int FROM public._rls_inv_org_tables_without_rls()
     WHERE tablename = '_rls_inv_bad_no_rls'),
  0,
  'INV-3 RED: detector flags org table with RLS disabled'
);

-- enabling RLS clears it
ALTER TABLE public._rls_inv_bad_no_rls ENABLE ROW LEVEL SECURITY;
SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_org_tables_without_rls()
     WHERE tablename = '_rls_inv_bad_no_rls'),
  0,
  'INV-3 GREEN-after-fix: enabling RLS clears the violation'
);

-- ---------------------------------------------------------------------------
-- INV-4 fixture: a SECURITY DEFINER function with NO SET search_path.
-- Detector MUST flag it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rls_inv_bad_no_path()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $bad$ SELECT 1 $bad$;
-- intentionally NO `SET search_path`

SELECT isnt(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_search_path()
     WHERE functionname = '_rls_inv_bad_no_path'),
  0,
  'INV-4 RED: detector flags DEFINER function with no SET search_path'
);

SELECT * FROM finish();

ROLLBACK;
