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
  ('INV-4', 90,  'ratchet ceiling: DEFINER fns lacking SET search_path (static est. ~70; tighten then burn down to 0)'),
  ('INV-6', 90,  'ratchet ceiling: DEFINER fns reachable by anon/authenticated with no authorization gate (SCRUM-339). MEASURED 2026-08-11 = 90, zero headroom. 18 of the 90 are reachable by anon. See note below.');

-- ---------------------------------------------------------------------------
-- INV-6 (SCRUM-339) — provenance of this ceiling, and why it is not 2.
--
-- The intent registered on the ticket is "baseline = 2": after the 2026-08-11
-- sweep, the only violations that should remain are `create_default_pipelines`
-- and `ensure_pipeline_display_config`, which the browser genuinely calls and
-- which are waiting on the `_unchecked` + wrapper treatment.
--
-- That number describes PRODUCTION. This suite does not run against production
-- — it runs against a database built from `supabase/migrations/*`, and those
-- two populations are NOT the same:
--
--   * The 23 REVOKEs applied on 2026-08-11 were executed directly in prod and
--     never landed in a migration. Measured on a migrations-built database,
--     `fire_workflow_trigger`, `enqueue_webhook_deliveries_for_org`,
--     `schedule_pipe_rule_steps_from_position` and `acquire_copilot_lock` still
--     answer `has_function_privilege('authenticated', …) = true`. The fix does
--     not exist in the repo, so CI cannot see it — and neither can a fresh
--     branch, a rebuild, or a restore.
--   * A live count on a (differently-branched) local database returned 90, not
--     2, which is the order of magnitude to expect here.
--
-- MEASURED, 2026-08-11: the live count is 90, of which 18 are reachable by
-- `anon` (no login at all). The ceiling above is set to exactly that — zero
-- headroom, so the 91st ungated function fails the build. It was measured on an
-- isolated Supabase stack booted from THIS branch's `supabase/migrations/*`
-- (own project id, ports 5452x, so the shared local database the other
-- worktrees use was never touched), which is the same construction CI performs
-- via `supabase start`. Ledger: 74 versions, matching the branch file count.
--
-- Burning this down is SCRUM-339, and it is not a formality: 90 ungated
-- DEFINER functions reachable from a browser is the population that produced
-- the 23 closed on 2026-08-11.
--
-- Do NOT repeat the INV-2/INV-4 history: those shipped as "conservative upper
-- bounds, tighten in a follow-up PR" on 2026-06-01 and were never tightened —
-- they still read 100 and 90, which is why a gate that has been failing since
-- 2026-07-30 went unnoticed. A ceiling far above the live count is not a
-- ratchet; it is decoration.
-- ---------------------------------------------------------------------------
