#!/usr/bin/env bash
# check-migration-versions.sh — guard against duplicate migration version prefixes.
#
# Two migration files sharing the same 14-digit version prefix make `supabase db
# push` silently SKIP one of them (schema_migrations records a version once), which
# is the root cause of the prod<->repo drift behind the 2026-06-01 incident (#640).
#
# The guard has TWO halves, and it needs both (issue #1534):
#
#   (a) duplicates INSIDE this checkout;
#   (b) a version this branch introduces that the BASE BRANCH already has.
#
# (b) exists because (a) alone is blind to the shape every real collision took on
# 2026-08-11: one file here, its twin on `main`. Each side is internally clean, both
# CIs go green, and the collision only exists after the merge — when nobody is
# looking. Four live collisions were found by hand that day; all four passed (a).
#
# BASELINE is 0 and must stay 0. It was frozen at 13 when 13 duplicates existed;
# the old migrations were later moved to archive/ and the real count fell to zero,
# but the number never followed. A ratchet whose ceiling outlives the debt it
# described is indistinguishable from no gate at all.
set -euo pipefail

MIG_DIR="${1:-supabase/migrations}"
# Path INSIDE the git tree. Separate from MIG_DIR on purpose: a test harness points
# MIG_DIR at a temp directory, and `git ls-tree` on that path returns nothing — the
# guard would then report "no collision" for a collision. That false green is the
# very defect this guard exists to catch, so the two are distinct parameters.
GIT_PATH="${2:-supabase/migrations}"
BASE_REF="${MIGRATION_BASE_REF:-origin/main}"
BASELINE="${MIGRATION_DUP_BASELINE:-0}"

fail=0

# --- (a) duplicates inside this checkout ------------------------------------
dups="$(ls "$MIG_DIR" 2>/dev/null | grep -oE '^[0-9]{14}' | sort | uniq -d || true)"
count="$(printf '%s' "$dups" | grep -c . || true)"

echo "Duplicate version prefixes inside the checkout: ${count} (baseline ${BASELINE})"
if [ "${count}" -gt 0 ]; then
  echo "${dups}" | sed 's/^/  - /'
fi
if [ "${count}" -gt "${BASELINE}" ]; then
  echo "FAIL: duplicate migration version inside this checkout. Renumber it." >&2
  fail=1
fi

# --- (b) versions this branch INTRODUCES that the base already has ----------
#
# "Introduces" is the operative word: comparing every file present against the
# base flags the whole tree when run on the base itself. What matters is the set
# ADDED relative to the merge-base.
if git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  merge_base="$(git merge-base "${BASE_REF}" HEAD 2>/dev/null || echo "${BASE_REF}")"

  added="$(git diff --name-only --diff-filter=A "${merge_base}...HEAD" -- "${GIT_PATH}" 2>/dev/null \
             | sed 's|.*/||' | grep -oE '^[0-9]{14}' | sort -u || true)"
  base_versions="$(git ls-tree -r --name-only "${merge_base}" "${GIT_PATH}" 2>/dev/null \
             | sed 's|.*/||' | grep -oE '^[0-9]{14}' | sort -u || true)"

  cross="$(comm -12 <(printf '%s\n' "${base_versions}") <(printf '%s\n' "${added}") | grep -v '^$' || true)"
  ncross="$(printf '%s' "$cross" | grep -c . || true)"

  echo "Versions this branch introduces that ${BASE_REF} already has: ${ncross}"
  if [ "${ncross}" -gt 0 ]; then
    echo "${cross}" | sed 's/^/  - /'
    echo "FAIL: this version already exists on ${BASE_REF}. \`supabase db push\` would" >&2
    echo "      SKIP the file in silence — it would merge, CI would stay green, and the" >&2
    echo "      migration would never reach production. Renumber to a free version." >&2
    fail=1
  fi
else
  # Not a hard failure: a shallow clone or a fork without the base ref still runs
  # half (a). Loud, so nobody reads the missing half as a pass.
  echo "WARN: ${BASE_REF} not available — half (b) skipped. Fetch it to check cross-branch collisions." >&2
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: no duplicate versions here and none colliding with ${BASE_REF}."
fi
exit "$fail"
