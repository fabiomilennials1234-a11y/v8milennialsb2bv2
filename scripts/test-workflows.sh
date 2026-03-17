#!/bin/bash
# test-workflows.sh — Run workflow system tests against Supabase environment
#
# Usage:
#   SUPABASE_SERVICE_ROLE_KEY=... bash scripts/test-workflows.sh
#   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_URL=... bash scripts/test-workflows.sh
#   SUPABASE_SERVICE_ROLE_KEY=... bash scripts/test-workflows.sh triggers
#   SUPABASE_SERVICE_ROLE_KEY=... bash scripts/test-workflows.sh conditions

set -euo pipefail

SUPABASE_URL="${SUPABASE_URL:-https://bcfadphgsibjzivtbjvc.supabase.co}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
SUITE="${1:-all}"

echo "========================================="
echo " TorqueCRM Workflow System Tests"
echo "========================================="
echo "URL:   $SUPABASE_URL"
echo "Suite: $SUITE"
echo ""

RESULT=$(curl -sS --max-time 120 -X POST \
  "$SUPABASE_URL/functions/v1/test-workflow-system" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"suite\":\"$SUITE\"}")

# Check if jq is available
if command -v jq &> /dev/null; then
  echo "$RESULT" | jq '.'

  TOTAL=$(echo "$RESULT" | jq -r '.summary.total // 0')
  PASSED=$(echo "$RESULT" | jq -r '.summary.passed // 0')
  FAILED=$(echo "$RESULT" | jq -r '.summary.failed // 0')
  SKIPPED=$(echo "$RESULT" | jq -r '.summary.skipped // 0')
  DURATION=$(echo "$RESULT" | jq -r '.duration_ms // 0')

  echo ""
  echo "========================================="
  echo " Summary"
  echo "========================================="
  echo "Total:   $TOTAL"
  echo "Passed:  $PASSED"
  echo "Failed:  $FAILED"
  echo "Skipped: $SKIPPED"
  echo "Time:    ${DURATION}ms"
  echo ""

  # Print failed tests
  if [ "$FAILED" -gt 0 ]; then
    echo "FAILED TESTS:"
    echo "-------------"
    echo "$RESULT" | jq -r '
      [.conditions[], .triggers[], .actions[], .e2e[]]
      | map(select(.status == "failed"))
      | .[]
      | "  X \(.name): \(.error // "unknown error")"
    '
    echo ""
    echo "RESULT: FAILED ($FAILED tests failed)"
    exit 1
  else
    echo "RESULT: ALL TESTS PASSED"
    exit 0
  fi
else
  # No jq — print raw result
  echo "$RESULT"
  if echo "$RESULT" | grep -q '"failed":0'; then
    echo ""
    echo "RESULT: ALL TESTS PASSED"
    exit 0
  else
    echo ""
    echo "RESULT: SOME TESTS FAILED (install jq for detailed output)"
    exit 1
  fi
fi
