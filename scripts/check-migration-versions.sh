#!/usr/bin/env bash
# check-migration-versions.sh — guard against duplicate migration version prefixes.
#
# Two migration files sharing the same 14-digit version prefix make `supabase db
# push` silently SKIP one of them (schema_migrations records a version once), which
# is the root cause of the prod<->repo drift behind the 2026-06-01 incident (#640).
#
# This is a RATCHET: it fails only if the number of duplicate version prefixes
# EXCEEDS the frozen baseline, so new collisions are blocked while the known
# backlog is renumbered down over time. Lower BASELINE as collisions are fixed.
set -euo pipefail

MIG_DIR="${1:-supabase/migrations}"
BASELINE="${MIGRATION_DUP_BASELINE:-13}"

dups="$(ls "$MIG_DIR" 2>/dev/null \
  | grep -oE '^[0-9]{14}' \
  | sort | uniq -d || true)"
count="$(printf '%s' "$dups" | grep -c . || true)"

echo "Duplicate migration version prefixes: ${count} (baseline ${BASELINE})"
if [ "${count}" -gt 0 ]; then
  echo "${dups}" | sed 's/^/  - /'
fi

if [ "${count}" -gt "${BASELINE}" ]; then
  echo "FAIL: a NEW duplicate migration version was introduced. Renumber it to a unique prefix." >&2
  exit 1
fi
echo "OK (no new collisions beyond the frozen backlog)."
