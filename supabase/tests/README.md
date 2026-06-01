# supabase/tests — pgTAP RLS-invariant gate (issue #638)

A pgTAP suite that asserts four tenant-isolation invariants over the live
Postgres catalog. It is the durable, automated follow-up requested by the
2026-06-01 security incident migration
(`20260601150000_security_anon_definer_writers_and_leaks.sql`, final note).

## Invariants

| ID    | Property | Mode |
|-------|----------|------|
| INV-1 | No table with an `organization_id` column has any RLS policy whose roles include `public`/`anon`/`authenticated` **and** whose `USING` qual is `true` (or `WITH CHECK` is `true`). | hard, zero-tolerance |
| INV-2 | No writing (`INSERT INTO`/`UPDATE`/`DELETE FROM`) `SECURITY DEFINER` function is `EXECUTE`-able by `anon` or `PUBLIC`. Trigger/event-trigger functions are excluded (not directly callable). | ratchet |
| INV-3 | Every table with an `organization_id` column has `relrowsecurity = true`. | hard, zero-tolerance |
| INV-4 | Every `SECURITY DEFINER` function in schema `public` pins `SET search_path` (in `proconfig`). | ratchet |

INV-1 and INV-3 carry no known backlog and fail the build on any violation.
INV-2 and INV-4 had a pre-existing backlog at authoring time, so they are
**ratcheted** against `rls_invariants_baseline.sql`: the live violation count
must be `<=` the frozen baseline, which means no *new* violation can land while
the legacy backlog is burned down. Baseline numbers may only ever be lowered.

## Files

- `_rls_invariants_detectors.sql` — four `SECURITY INVOKER` catalog functions
  (`public._rls_inv_*`), each returning the *violating* rows. Shared by both
  entrypoints so the assertion logic is identical across green and red proofs.
- `rls_invariants.sql` — the **green gate**. Asserts the real schema upholds the
  invariants (within baseline). This is what CI runs as the failure condition.
- `rls_invariants_red_fixture.sql` — the **TDD red proof**. Plants one
  deliberately-bad object per invariant inside a rolled-back transaction and
  asserts the same detectors catch each one. Guarantees the gate is
  load-bearing, not vacuously passing.
- `rls_invariants_baseline.sql` — the ratchet floors for INV-2 / INV-4.
- `run.sh` — runner. Prefers `pg_prove`; falls back to `psql`.

Everything runs inside rolled-back transactions and creates only `TEMP` /
`ON COMMIT DROP` objects — no schema mutation, fully idempotent.

## Running locally

```bash
supabase start                 # boots local Postgres + applies migrations
bash supabase/tests/run.sh     # red fixture, then green gate
```

`run.sh` honours `DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

## CI

The `rls-invariants` job in `.github/workflows/test.yml` boots supabase-local,
installs `pg_prove`, and runs `run.sh`. The first CI run prints the exact live
violation counts via `diag()` lines — tighten the INV-2 / INV-4 baseline
ceilings down to those numbers in a follow-up PR so the ratchet bites
immediately, then burn both down to 0.

## Burning down the backlog

- INV-4: add `SET search_path = public, pg_temp` to a flagged `SECURITY DEFINER`
  function, then lower the INV-4 number in `rls_invariants_baseline.sql`.
- INV-2: `REVOKE EXECUTE ON FUNCTION <fn> FROM PUBLIC, anon;` (keep
  `authenticated`/`service_role` as appropriate), then lower the INV-2 number.
