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
#   4b. stage_role_money_guard_test.sql — write-gate on won/lost (FIX-4,
#      ADR-0017 §1): only master/org-admin/backend may set money roles.
#   5. pipeline_stage_events_test.sql  — append-only stage ledger (#992,
#      ADR-0017 write model): capture triggers + immutability + RLS.
#   6. sale_events_test.sql            — append-only sale ledger (#993,
#      ADR-0017 §2-4): sale/sale_lost/sale_reversed + Revenue Stream +
#      sold_at tamper-proof + immutability + RLS.
#   6b. sale_events_state_backfill_test.sql — governed CURRENT-STATE sale
#      backfill (U2, ADR-0017 §7): live won/lost entries emit one honest
#      sale/sale_lost anchored on the REAL stage_changed_at (NOT now()),
#      role-resolved (not hardcoded 'vendido'), Revenue Stream by client,
#      value snapshot (malformed → NULL), idempotent vs re-run AND live capture.
#   7. commission_projection_test.sql  — commission as projection of the sale
#      ledger (#994, ADR-0017 §6): rate snapshot + reversal mirror +
#      idempotency + projection guard + column grants.
#   8. get_sales_metrics_test.sql      — canonical sales reader (#995,
#      ADR-0017 §2-5,§8): net-of-reversal + stream split + per-closer +
#      unattributed invariant + org-tz period cut + pipeline/member filters +
#      NULL-safe ticket + assert_org_access.
#   9. get_funnel_flow_test.sql        — canonical funnel reader (#996,
#      ADR-0017 §1,§5,§7,§8): cohort-by-entry + monotonic reached-role (skip-safe)
#      + [0,100] rates + NULL-safe conversion_from_prev (#6) + custom-pipeline
#      real numbers (R3) + org-tz cohort boundary + assert_org_access.
#  10. get_ranking_test.sql            — canonical sales leaderboard (#997,
#      ADR-0017 §2-5,§8): single-attribution + net-of-reversal + Σ(member)+
#      unattributed==total + ranking==get_sales_metrics.by_closer + no
#      metric_type bucket (#8) + no type='system' (R3) + rank/share + org-tz +
#      assert_org_access.
#  11. get_commission_ledger_test.sql  — commission as ledger read (#997,
#      ADR-0017 §6,§8): reads only the projection, net-of-reversal, rate
#      snapshot immovable, R5-killer equivalence (ranking member ⟺ ledger line,
#      base==get_ranking.revenue), member filter, org-tz, assert_org_access.
#  12. productivity_canonical_test.sql — produtividade activity-in-period (#1000,
#      ADR-0013 / ADR-0017 §2-5): dimensão `vendido` lê SÓ sale_events, líquida
#      de estorno + atribuição sale_responsible_id única (R5) + sem type='system'
#      (R3) + âncora sold_at (R4); novos por created_at, reuniões por
#      meeting_events; drill do caderno; assert_org_access.
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
    "$SCRIPT_DIR/stage_role_money_guard_test.sql" \
    "$SCRIPT_DIR/pipeline_stage_events_test.sql" \
    "$SCRIPT_DIR/sale_events_test.sql" \
    "$SCRIPT_DIR/sale_events_state_backfill_test.sql" \
    "$SCRIPT_DIR/commission_projection_test.sql" \
    "$SCRIPT_DIR/get_sales_metrics_test.sql" \
    "$SCRIPT_DIR/get_funnel_flow_test.sql" \
    "$SCRIPT_DIR/get_ranking_test.sql" \
    "$SCRIPT_DIR/get_commission_ledger_test.sql" \
    "$SCRIPT_DIR/productivity_canonical_test.sql"
}

run_with_psql() {
  local f
  for f in rls_invariants_red_fixture.sql rls_invariants.sql metric_period_bounds_test.sql stage_role_test.sql stage_role_money_guard_test.sql pipeline_stage_events_test.sql sale_events_test.sql sale_events_state_backfill_test.sql commission_projection_test.sql get_sales_metrics_test.sql get_funnel_flow_test.sql get_ranking_test.sql get_commission_ledger_test.sql productivity_canonical_test.sql; do
    echo "----- running $f via psql -----"
    # --variable ON_ERROR_STOP=1 turns any pgTAP failure (which RAISEs) into a
    # non-zero exit. We also grep for a TAP "not ok" line as a belt-and-braces
    # failure signal, since `is()`/`ok()`/`cmp_ok()` REPORT rather than raise.
    #
    # -t -A (tuples-only, unaligned) is load-bearing: without it psql prints TAP
    # inside its ALIGNED table layout, so every `not ok` line comes out as
    # "␠not ok N" (leading space + column framing). That made the old
    # `^not ok` anchor never match — with pg_prove absent, every failing
    # assertion in all 12 suites was silently reported as PASS. -t -A emits TAP
    # at column 0; the widened `(^|[[:space:]])not ok` grep is a second belt.
    local out
    out="$(psql "$DATABASE_URL" \
            --no-psqlrc --quiet -t -A \
            --variable ON_ERROR_STOP=1 \
            --file "$SCRIPT_DIR/$f" 2>&1)"
    echo "$out"
    if grep -Eq '(^|[[:space:]])not ok' <<<"$out"; then
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
