-- supabase/tests/rls_invariants_baseline.sql
--
-- Ratchet baseline for the RLS-invariant suite (issue #638). Same philosophy as
-- the repo's dependency-cruiser ratchet (scripts/dep-cruise-ratchet.cjs): the
-- two invariants that have a *pre-existing* backlog are gated at "no NEW
-- violations beyond this frozen count", so CI is GREEN today while every future
-- regression fails the build. INV-1 and INV-3 carry NO backlog and are hard
-- zero-tolerance gates (baseline 0).
--
-- HOW TO BURN DOWN: when you fix offenders (add `SET search_path` to a DEFINER
-- function, or REVOKE EXECUTE ... FROM PUBLIC, anon on a writing DEFINER
-- function), LOWER the matching number here in the same PR. The suite asserts
-- the live violation count is `<=` the baseline, so lowering it ratchets the
-- floor down and prevents backslide. The number must never be raised to land
-- new violating code — fix the code instead.
--
-- Provenance of the non-zero baselines (captured 2026-06-01 from
-- supabase/migrations/* static resolution, issue #638):
--   INV-2: writing SECURITY DEFINER functions still reachable by anon/PUBLIC.
--          Follow-up backlog from incident migration
--          20260601150000_security_anon_definer_writers_and_leaks.sql, which
--          swept then-existing writers but post-sweep additions re-inherited the
--          PUBLIC default EXECUTE grant.
--   INV-4: SECURITY DEFINER functions lacking SET search_path. Explicitly noted
--          as an undone follow-up in that same migration ("~60 ... lack SET
--          search_path").
--
-- These tables are TEMP and only live for the duration of a suite run.

CREATE TEMP TABLE IF NOT EXISTS _rls_inv_baseline (
  invariant      text PRIMARY KEY,
  max_violations integer NOT NULL,
  note           text
) ON COMMIT DROP;

TRUNCATE _rls_inv_baseline;

-- NOTE ON THE NON-ZERO CEILINGS: these were sized from static resolution of
-- supabase/migrations/* (live grant ACLs were not reachable from the authoring
-- environment), so they are deliberately conservative *upper bounds* chosen to
-- guarantee the gate is GREEN on the current clean schema. The FIRST CI run
-- prints the exact live counts via the diag() lines in rls_invariants.sql —
-- tighten each ceiling down to (live_count) in a follow-up PR so the ratchet
-- bites immediately. From there, burn both down to 0.
INSERT INTO _rls_inv_baseline (invariant, max_violations, note) VALUES
  ('INV-1', 0,   'zero-tolerance: no broad-role USING(true)/WITH CHECK(true) on org tables'),
  ('INV-2', 100, 'ratchet ceiling: writing DEFINER fns reachable by anon/PUBLIC (static est. <=89 callable writers; tighten then burn down to 0)'),
  ('INV-3', 0,   'zero-tolerance: every org table must have RLS enabled'),
  ('INV-4', 90,  'ratchet ceiling: DEFINER fns lacking SET search_path (static est. ~70; tighten then burn down to 0)');
