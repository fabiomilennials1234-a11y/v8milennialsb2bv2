#!/usr/bin/env bash
# check-metric-antipatterns.sh — block the metric anti-patterns behind the
# 2026-07-02 audit's root causes (ADR-0017) from entering NEW migrations.
#
# Rules (heuristics — suppress a deliberate line with `-- metric-lint-allow`):
#   R3-system-predicate     type='system' as filter predicate (blinds custom pipelines)
#   R5-attribution-coalesce COALESCE chaining 2+ attribution keys (soma ≠ total)
#   R4-updated_at-anchor    updated_at as metric time anchor (non-deterministic)
#   ledger-revenue          SUM of sale value in a file that never reads sale_events
#
# RATCHET: files listed in METRIC_LINT_BASELINE (frozen backlog) are exempt.
# Everything else that matches a rule fails the build.
set -euo pipefail

MIG_DIR="${1:-supabase/migrations}"
BASELINE="${METRIC_LINT_BASELINE:-scripts/metric-antipatterns-baseline.txt}"

fail=0

is_baselined() {
  local file="$1"
  [ -f "$BASELINE" ] && grep -qxF "$(basename "$file")" "$BASELINE"
}

report() {
  local rule="$1" file="$2" line_no="$3" line="$4" why="$5"
  echo "FAIL [$rule] $(basename "$file"):$line_no" >&2
  echo "    $line" >&2
  echo "    → $why (ver ADR-0017: docs/adr/0017-event-sourced-sales-and-stage-metrics.md)" >&2
  fail=1
}

for file in "$MIG_DIR"/*.sql; do
  [ -e "$file" ] || continue
  is_baselined "$file" && continue

  # R3 — type='system' as filter predicate (WHERE/AND/ON context).
  # INSERT seeds ("VALUES (..., 'system')") don't match: no filter keyword.
  while IFS=: read -r line_no line; do
    [ -z "$line_no" ] && continue
    echo "$line" | grep -qi 'metric-lint-allow' && continue
    report "R3-system-predicate" "$file" "$line_no" "$line" \
      "métrica não pode filtrar por type='system' — parametrize por pipeline_id"
  done < <(grep -inE "(where|and|on)[^']*type\s*=\s*'system'" "$file" || true)

  # R5 — COALESCE chaining two or more attribution keys (soma ≠ total).
  # One attribution key + literal fallback is fine; two keys = divergent chain.
  ATTR="(sale_responsible_id|closer_id|pre_sale_responsible_id|sdr_id|responsible_id)"
  while IFS=: read -r line_no line; do
    [ -z "$line_no" ] && continue
    echo "$line" | grep -qi 'metric-lint-allow' && continue
    report "R5-attribution-coalesce" "$file" "$line_no" "$line" \
      "atribuição deve usar 1 chave canônica por papel (snapshot no evento), nunca cadeia de fallback"
  done < <(grep -inE "coalesce\([^)]*${ATTR}[^)]*,[^)]*${ATTR}" "$file" || true)

  # R4 — updated_at as time anchor (non-deterministic: any touch moves the sale).
  # Maintenance triggers (SET updated_at = now()) are legitimate and don't match:
  # we only flag updated_at inside COALESCE or compared against a period boundary.
  while IFS=: read -r line_no line; do
    [ -z "$line_no" ] && continue
    echo "$line" | grep -qi 'metric-lint-allow' && continue
    report "R4-updated_at-anchor" "$file" "$line_no" "$line" \
      "updated_at não é âncora temporal de métrica — use a data gravada no evento (sold_at/occurred_at)"
  done < <(grep -inE "coalesce\([^)]*updated_at|updated_at\s*(>=|<=|<|>|between)" "$file" || true)

  # ledger-revenue — revenue aggregated outside the sale_events ledger.
  # File-level heuristic: SUM over a sale-value column in a file that never
  # references sale_events means the revenue is being derived from mutable state.
  if ! grep -qi "sale_events" "$file"; then
    while IFS=: read -r line_no line; do
      [ -z "$line_no" ] && continue
      echo "$line" | grep -qi 'metric-lint-allow' && continue
      report "ledger-revenue" "$file" "$line_no" "$line" \
        "receita só pode ser agregada do caderno sale_events (líquido de estornos)"
    done < <(grep -inE "sum\([^)]*(sale_value|deal_value|valor_venda)" "$file" || true)
  fi
done

if [ "$fail" -eq 1 ]; then
  echo "Migration lint FAILED: anti-padrão de métrica em arquivo novo (ADR-0017)." >&2
  exit 1
fi
echo "OK: nenhum anti-padrão de métrica em migrations novas."
