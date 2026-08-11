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
  ('INV-6', 91,  'ratchet ceiling: DEFINER fns reachable by anon/authenticated with no authorization gate (SCRUM-339). MEASURED 2026-08-11 = 91, zero headroom; tighten on every fix and burn down to 0. See note below.');

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
-- MEASURED, 2026-08-11: the live count is 91. The ceiling above is set to
-- exactly that — zero headroom, so the 92nd ungated function fails the build.
-- Measured on an isolated Supabase stack booted from THIS branch's
-- `supabase/migrations/*` (own project id, ports 5452x, so the shared local
-- database the other worktrees use was never touched), which is the same
-- construction CI performs via `supabase start`. Ledger: 74 versions, matching
-- the branch file count.
--
-- HOW THE NUMBER MOVED, each correction measured in isolation. Summed they
-- cancel and the net lies, so they are recorded separately:
--
--     starting point (bare `auth.uid(` counted as a gate) .............. 90
--     ONLY requiring auth.uid() in a deciding position ................ 101   (+11)
--     ONLY widening the helper list .................................... 80   (-10)
--     both (first ship) ................................................ 89
--     + transitive closure, `is_master_user` dropped by NAME ........... 101   (+12, WRONG)
--     - `is_master_user()` recognised by its DEFAULT (what ships) ....... 91   (-10)
--
-- Each delta is a finding, not noise:
--
--   +11 — eleven functions were passing on a STAMP. `owner_id, auth.uid()` in a
--         VALUES records who acted and refuses nobody.
--   -10 — seven identity-derived helpers were missing, so functions that DO
--         hold a gate were being counted as violations.
--   +12 — dropping `is_master_user` from the trusted set. This was WRONG, and
--         the measurement that justified it was INVERTED. See below.
--   -10 — undoing it correctly.
--
-- THE INVERTED MEASUREMENT, worth writing down because it is a trap that looks
-- like evidence. The signature is
--     is_master_user("_user_id" uuid DEFAULT auth.uid())        (baseline:13760)
-- so the parameter exists but its DEFAULT is auth.uid(). Nobody writes
-- `is_master_user(auth.uid())` — the default already does it — which means the
-- IDIOMATIC GATED FORM IS EMPTY PARENS. Counting occurrences of the literal
-- `auth.uid()` inside the parens therefore returns zero and reads as "nothing
-- is gated", when the truth is the opposite. Measured properly on this branch:
--     is_master_user()   — subject is the caller, GATED ......... 44
--     is_master_user(x)  — answers about someone else ............ 9
-- Treating the name as never-a-gate turned ~44 genuinely gated calls into
-- violations: false positives in bulk, and exactly what makes a target of 0
-- unreachable.
--
-- The rule that ships needs no heuristic: empty parens counts, parens with
-- content does not. `has_role` and `is_team_member` have NO default
-- (baseline:12579), so they count only with `auth.uid()` as the argument — the
-- asymmetry is the DEFAULT, not "takes a parameter".
--
-- REAL DEBT, recomputed on the correct population: of the 91 violations, TWO
-- call `is_master_user(<argument>)` — checking whether some uuid handed in is a
-- master, which gates nothing. Two, not the twelve computed over the wrong
-- population. Cheapest place to start burning down.
--
-- BURN-DOWN TARGET: 0, and it is now REACHABLE — which is the point of the
-- transitive closure. A helper that gates but sits outside the list would make
-- its callers count forever, and a target that cannot be reached is the same
-- trap as a ceiling too high, wearing a different name. Every PR that adds a
-- gate or revokes a grant lowers this number in the same PR. The ceiling may
-- never be raised to land code: raising it is what turned INV-2 (100) and INV-4
-- (90) into decoration, which is why a gate failing since 2026-07-30 went
-- unnoticed for twelve days. When the migration carrying the 23 production
-- REVOKEs finally lands in the repo, this number drops on its own.
--
-- Burning it down is SCRUM-339, and it is not a formality: 91 ungated DEFINER
-- functions reachable from a browser is the population that produced the 23
-- closed on 2026-08-11.
--
-- Do NOT repeat the INV-2/INV-4 history: those shipped as "conservative upper
-- bounds, tighten in a follow-up PR" on 2026-06-01 and were never tightened —
-- they still read 100 and 90, which is why a gate that has been failing since
-- 2026-07-30 went unnoticed. A ceiling far above the live count is not a
-- ratchet; it is decoration.
-- ---------------------------------------------------------------------------
