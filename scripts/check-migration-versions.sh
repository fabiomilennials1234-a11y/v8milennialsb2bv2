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

# --- (b) same version as the base, under a different filename ---------------
#
# Compares the FULL set on both sides, not the set the branch "adds". Three
# attempts taught why (issue #1534):
#
#   * merge-base as the base side: every real collision on 2026-08-11 had the
#     twin landing on `main` AFTER the branch forked, so at the merge-base it is
#     not there yet and the guard passes on the case it exists to catch;
#   * `--diff-filter=A` as the branch side: it misses the branch that KEEPS a
#     file whose version the base later reused under another name — measured
#     live on 20270730000010 (`deals_rls_org_scope` here, `voip_webhook_ingest`
#     on main).
#
# What defines a collision is not who added what and when. It is: the same
# 14-digit version resolving to DIFFERENT filenames on the two sides. Same
# version and same name is the same migration — a cherry-pick or a shared
# ancestor — and git merges the one path, so flagging it is a false red.
#
# Run on the base itself every version matches its own name, so the set comes
# out empty. No special case needed.
if git rev-parse --verify --quiet "${BASE_REF}" >/dev/null; then
  pares() {
    git ls-tree -r --name-only "$1" "${GIT_PATH}" 2>/dev/null \
      | sed 's|.*/||' | grep -E '^[0-9]{14}' | awk '{print substr($0,1,14), $0}' | sort -u
  }
  base_pairs="$(pares "${BASE_REF}" || true)"
  here_pairs="$(pares HEAD || true)"

  # CONTROLE POSITIVO, e não é enfeite: "0 colisões" é ambíguo — significa
  # "nenhuma colidiu" E TAMBÉM "não li árvore nenhuma". Um GIT_PATH errado, um
  # ref vazio ou um filtro que não casa nada produzem exatamente o mesmo silêncio
  # de um repositório limpo. Dizer QUANTAS versões foram inspecionadas de cada
  # lado desambigua as duas leituras, e é o que o teste ancora.
  n_here="$(printf '%s' "${here_pairs}" | grep -c . || true)"
  n_base="$(printf '%s' "${base_pairs}" | grep -c . || true)"
  echo "Migration versions inspected: ${n_here} here, ${n_base} on ${BASE_REF}"
  if [ "${n_here}" -eq 0 ]; then
    echo "FAIL: read ZERO migration versions in '${GIT_PATH}'. A guard that inspects" >&2
    echo "      nothing reports no collision — that silence is not a pass." >&2
    fail=1
  fi

  cross=""
  while read -r ver nome; do
    [ -z "${ver:-}" ] && continue
    homonimos="$(printf '%s\n' "${base_pairs}" | awk -v v="$ver" '$1==v {print $2}')"
    [ -z "${homonimos}" ] && continue
    printf '%s\n' "${homonimos}" | grep -qxF "${nome}" && continue
    cross="${cross}${ver}  ${nome}  <->  $(printf '%s\n' "${homonimos}" | paste -sd, -)
"
  done <<< "${here_pairs}"

  ncross="$(printf '%s' "$cross" | grep -c . || true)"
  echo "Versions colliding with ${BASE_REF} under another name: ${ncross}"
  if [ "${ncross}" -gt 0 ]; then
    printf '%s' "${cross}" | sed 's/^/  - /'
    echo "FAIL: this version already exists on ${BASE_REF} under another name." >&2
    echo "      \`supabase db push\` would SKIP one of them in silence — it would merge," >&2
    echo "      CI would stay green, and the migration would never reach production." >&2
    echo "      Renumber to a free version." >&2
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
