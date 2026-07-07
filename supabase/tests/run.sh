#!/usr/bin/env bash
# supabase/tests/run.sh
#
# Runs the pgTAP suites (RLS invariants #638 + metric period bounds #989)
# against a Postgres database that already has the project migrations applied.
#
# In CI this runs after `supabase start` (which applies supabase/migrations/*).
# Locally: `supabase start && supabase/tests/run.sh`.
#
# Order matters:
#   1. rls_invariants_red_fixture.sql  — the TDD RED proof: plants one bad
#      object per invariant and asserts the detectors catch each one. Proves the
#      suite is load-bearing (would fail on a real violation).
#   2. rls_invariants.sql              — the GREEN gate: asserts the real schema
#      has zero violations. This is the actual CI failure condition.
#   3. metric_period_bounds_test.sql   — Metric Period foundation (#989,
#      ADR-0017 §5): organizations.timezone + metric_period_bounds().
#   4. stage_role_test.sql             — Stage Role governance (#990,
#      ADR-0017 §1): pipeline_stages.stage_role + system_stage_role() map.
#   5. pipeline_stage_events_test.sql  — append-only stage ledger (#992,
#      ADR-0017 write model): capture triggers + immutability + RLS.
#   6. sale_events_test.sql            — append-only sale ledger (#993,
#      ADR-0017 §2-4): sale/sale_lost/sale_reversed + Revenue Stream +
#      sold_at tamper-proof + immutability + RLS.
#   7. commission_projection_test.sql  — commission as projection of the sale
#      ledger (#994, ADR-0017 §6): rate snapshot + reversal mirror +
#      idempotency + projection guard + column grants.
#   8. get_sales_metrics_test.sql      — canonical sales reader (#995,
#      ADR-0017 §2-5,§8): net-of-reversal + stream split + per-closer +
#      unattributed invariant + org-tz period cut + pipeline/member filters +
#      NULL-safe ticket + assert_org_access.
#
# All files run inside rolled-back transactions, so none mutates the DB.
#
# Env:
#   DATABASE_URL  full libpq URL. Defaults to the supabase-local db on :54322.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

echo "==> pgTAP suites (RLS invariants #638 + metric period bounds #989)"
echo "    DB: ${DATABASE_URL%%\?*}"

# pgTAP harness. Prefer pg_prove (TAP aggregation); fall back to raw psql if the
# Perl TAP harness is not installed on the runner.
run_with_pg_prove() {
  pg_prove --verbose --ext .sql -d "$DATABASE_URL" \
    "$SCRIPT_DIR/rls_invariants_red_fixture.sql" \
    "$SCRIPT_DIR/rls_invariants.sql" \
    "$SCRIPT_DIR/metric_period_bounds_test.sql" \
    "$SCRIPT_DIR/stage_role_test.sql" \
    "$SCRIPT_DIR/pipeline_stage_events_test.sql" \
    "$SCRIPT_DIR/sale_events_test.sql" \
    "$SCRIPT_DIR/commission_projection_test.sql" \
    "$SCRIPT_DIR/get_sales_metrics_test.sql"
}

run_with_psql() {
  local f
  for f in rls_invariants_red_fixture.sql rls_invariants.sql metric_period_bounds_test.sql stage_role_test.sql pipeline_stage_events_test.sql sale_events_test.sql commission_projection_test.sql get_sales_metrics_test.sql; do
    echo "----- running $f via psql -----"
    # --variable ON_ERROR_STOP=1 turns any pgTAP failure (which RAISEs) into a
    # non-zero exit. We also grep for a TAP "not ok" line as a belt-and-braces
    # failure signal, since `is()` reports rather than raises.
    local out
    out="$(psql "$DATABASE_URL" \
            --no-psqlrc --quiet \
            --variable ON_ERROR_STOP=1 \
            --file "$SCRIPT_DIR/$f" 2>&1)"
    echo "$out"
    if grep -Eq '^not ok' <<<"$out"; then
      echo "FAILED: $f reported a 'not ok' assertion" >&2
      return 1
    fi
  done
}

if command -v pg_prove >/dev/null 2>&1; then
  echo "==> using pg_prove"
  run_with_pg_prove
else
  echo "==> pg_prove not found; using psql fallback"
  run_with_psql
fi

echo "==> pgTAP suites passed"
