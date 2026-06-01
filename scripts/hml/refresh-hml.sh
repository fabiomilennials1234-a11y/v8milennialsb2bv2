#!/usr/bin/env bash
#
# refresh-hml.sh — Refresh the homologation (HML) database from production.
#
# On-demand, local, fail-closed pipeline (PRD #612, slice #615):
#   1. disable every cron job on HML (before anything else)
#   2. pg_dump prod        — auth (data-only) + public (schema+data)
#   3. restore into HML    — auth data first, then public (FK order)
#   4. neutralize_hml.sql  — sever every outbound vector
#   5. assert_hml_safe.sql — fail-closed guard; abort if anything is still live
#
# Restore and neutralize are INSEPARABLE: any failure aborts loudly and leaves
# HML with cron disabled (never "restored but live"). Storage/media is NOT
# copied. NEVER runs against prod as the target.
#
# Credentials come from .env (gitignored), Session/direct connection strings:
#   PROD_DB_URL = postgres://postgres:...@db.<prod-ref>.supabase.co:5432/postgres
#   HML_DB_URL  = postgres://postgres:...@db.<dev-ref>.supabase.co:5432/postgres
#
# Requires: pg_dump / psql (v17, matching the projects), network to both DBs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NEUTRALIZE_SQL="$ROOT/scripts/hml/neutralize_hml.sql"
ASSERT_SQL="$ROOT/scripts/hml/assert_hml_safe.sql"

PROD_REF="jsjsmuncfkbsbzqzqhfq"
HML_REF="bcfadphgsibjzivtbjvc"

log() { printf '\n\033[1m[refresh-hml]\033[0m %s\n' "$*"; }
die() { printf '\n\033[31m[refresh-hml] ABORT:\033[0m %s\n' "$*" >&2; exit 1; }

# --- Load credentials -------------------------------------------------------
[ -f "$ROOT/.env" ] && set -a && . "$ROOT/.env" && set +a
: "${PROD_DB_URL:?PROD_DB_URL not set (add it to .env — Session/direct 5432)}"
: "${HML_DB_URL:?HML_DB_URL not set (add it to .env — Session/direct 5432)}"

# --- Safety guards (fail-closed) --------------------------------------------
case "$HML_DB_URL" in
  *"$PROD_REF"*) die "HML_DB_URL points at PROD ($PROD_REF). Refusing — HML target must be dev." ;;
esac
case "$HML_DB_URL" in
  *"$HML_REF"*) : ;;
  *) die "HML_DB_URL does not point at the expected dev project ($HML_REF). Refusing." ;;
esac
case "$PROD_DB_URL" in
  *"$PROD_REF"*) : ;;
  *) die "PROD_DB_URL does not point at the expected prod project ($PROD_REF). Refusing." ;;
esac
command -v pg_dump >/dev/null || die "pg_dump not found (install libpq / postgresql client)."
command -v psql   >/dev/null || die "psql not found (install libpq / postgresql client)."
[ -f "$NEUTRALIZE_SQL" ] || die "missing $NEUTRALIZE_SQL"
[ -f "$ASSERT_SQL" ]     || die "missing $ASSERT_SQL"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PSQL_HML=(psql "$HML_DB_URL" -v ON_ERROR_STOP=1 -X -q)

log "Target HML: $HML_REF  |  Source prod: $PROD_REF"
log "Work dir: $WORK"

# --- 1. Disable cron on HML first (nothing fires while we work) -------------
log "1/5 Disabling all cron jobs on HML"
"${PSQL_HML[@]}" -c "DO \$\$ BEGIN IF to_regclass('cron.job') IS NOT NULL THEN UPDATE cron.job SET active=false WHERE active; END IF; END \$\$;"

# --- 2. Dump prod -----------------------------------------------------------
log "2/5 Dumping prod (auth data-only)"
pg_dump "$PROD_DB_URL" --schema=auth --data-only --no-owner --no-privileges \
  --disable-triggers -f "$WORK/auth_data.sql"

log "2/5 Dumping prod (public schema+data)"
pg_dump "$PROD_DB_URL" --schema=public --clean --if-exists --no-owner \
  --no-privileges --disable-triggers -f "$WORK/public.sql"

# --- 3. Restore into HML (auth before public — FK order) --------------------
log "3/5 Restoring auth data into HML"
"${PSQL_HML[@]}" -f "$WORK/auth_data.sql"

log "3/5 Restoring public (schema+data) into HML"
"${PSQL_HML[@]}" -f "$WORK/public.sql"

# --- 4. Neutralize (inseparable from restore) -------------------------------
log "4/5 Neutralizing HML (severing outbound vectors)"
"${PSQL_HML[@]}" -f "$NEUTRALIZE_SQL"

# --- 5. Fail-closed assert --------------------------------------------------
log "5/5 Asserting HML is safe"
"${PSQL_HML[@]}" -f "$ASSERT_SQL"

log "DONE — HML refreshed from prod and verified safe. Storage/media not copied."
