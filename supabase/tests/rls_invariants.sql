-- supabase/tests/rls_invariants.sql
--
-- pgTAP suite: tenant-isolation RLS invariants (issue #638).
--
-- Asserts the clean schema (all applied migrations) upholds four invariants:
--   INV-1  no broad-role USING(true)/WITH CHECK(true) policy on any org table   [hard, 0]
--   INV-2  no writing SECURITY DEFINER fn EXECUTE-able by anon/PUBLIC           [ratchet]
--   INV-3  every org table has relrowsecurity = true                           [hard, 0]
--   INV-4  every SECURITY DEFINER fn in public pins search_path                [ratchet]
--
-- INV-1 and INV-3 are zero-tolerance: any violation fails the build. INV-2 and
-- INV-4 are ratcheted against a frozen baseline (rls_invariants_baseline.sql):
-- the live violation count must be <= the baseline, so no NEW violation can land
-- while the documented legacy backlog is burned down. The baseline numbers may
-- only ever be lowered.
--
-- Run with the bundled runner (preferred) or pg_prove:
--   bash supabase/tests/run.sh
--   pg_prove --ext .sql -d "$DATABASE_URL" supabase/tests/rls_invariants.sql
--
-- Idempotent and side-effect free: everything runs inside a rolled-back
-- transaction; the only objects created are TEMP and ON COMMIT DROP.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Load the shared catalog detectors (public._rls_inv_* functions) and the
-- ratchet baseline (TEMP _rls_inv_baseline).
\ir _rls_invariants_detectors.sql
\ir rls_invariants_baseline.sql

SELECT plan(4);

-- ---------------------------------------------------------------------------
-- INV-1 (hard, 0): no public/anon/authenticated USING(true)/WITH CHECK(true)
-- policy on any table carrying organization_id.
-- On violation, the offending rows are surfaced via diag().
-- ---------------------------------------------------------------------------
SELECT diag('INV-1 violation: ' || schemaname || '.' || tablename ||
            ' policy "' || policyname || '" cmd=' || cmd ||
            ' roles=' || roles::text)
FROM public._rls_inv_open_policies_on_org_tables();

SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_open_policies_on_org_tables()),
  (SELECT max_violations FROM _rls_inv_baseline WHERE invariant = 'INV-1'),
  'INV-1: no public/anon/authenticated USING(true)/WITH CHECK(true) policy on any organization_id table'
);

-- ---------------------------------------------------------------------------
-- INV-2 (ratchet): no writing SECURITY DEFINER function EXECUTE-able by anon
-- or PUBLIC. Live count must not exceed the frozen baseline.
-- ---------------------------------------------------------------------------
SELECT diag('INV-2 still-open writer: ' || schemaname || '.' || functionname ||
            '(' || identity_args || ')' ||
            ' anon=' || anon_can_execute || ' public=' || public_can_execute)
FROM public._rls_inv_writing_definer_exec_by_anon_or_public();

SELECT cmp_ok(
  (SELECT count(*)::int FROM public._rls_inv_writing_definer_exec_by_anon_or_public()),
  '<=',
  (SELECT max_violations FROM _rls_inv_baseline WHERE invariant = 'INV-2'),
  'INV-2: writing SECURITY DEFINER functions reachable by anon/PUBLIC do not exceed ratchet baseline'
);

-- ---------------------------------------------------------------------------
-- INV-3 (hard, 0): every organization_id table has RLS enabled.
-- ---------------------------------------------------------------------------
SELECT diag('INV-3 violation: ' || schemaname || '.' || tablename ||
            ' relrowsecurity=' || relrowsecurity)
FROM public._rls_inv_org_tables_without_rls();

SELECT is(
  (SELECT count(*)::int FROM public._rls_inv_org_tables_without_rls()),
  (SELECT max_violations FROM _rls_inv_baseline WHERE invariant = 'INV-3'),
  'INV-3: every table with organization_id has relrowsecurity = true'
);

-- ---------------------------------------------------------------------------
-- INV-4 (ratchet): every SECURITY DEFINER function in public pins search_path.
-- Live count must not exceed the frozen baseline.
-- ---------------------------------------------------------------------------
SELECT diag('INV-4 missing search_path: ' || schemaname || '.' || functionname ||
            '(' || identity_args || ')')
FROM public._rls_inv_definer_without_search_path();

SELECT cmp_ok(
  (SELECT count(*)::int FROM public._rls_inv_definer_without_search_path()),
  '<=',
  (SELECT max_violations FROM _rls_inv_baseline WHERE invariant = 'INV-4'),
  'INV-4: SECURITY DEFINER functions lacking SET search_path do not exceed ratchet baseline'
);

SELECT * FROM finish();

ROLLBACK;
