#!/usr/bin/env bash
# SQL contract runner in a disposable Postgres container (Chamado 6ebb4b73).
# Never points at production nor at a Supabase branch.
#
#   bash tests/integration/run-sql-contract.sh
#
# Env overrides:
#   CONTRACT_FIXTURE   schema fixture   (default tests/fixtures/chat-unread-schema.sql)
#   CONTRACT_MIGRATION migration to test (default supabase/migrations/*_whatsapp_leitura_externa*.sql, all of them;
#                      set to empty to prove the contract is red without it)
#   CONTRACT_SQL       assertions       (default tests/integration/chat-external-read.sql)
#   CONTRACT_IMAGE     postgres image   (default postgres:17-alpine)
# Prints PASS as the last line and exits 0 only if every step succeeded.
set -euo pipefail
export MSYS_NO_PATHCONV=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

FIXTURE="${CONTRACT_FIXTURE:-tests/fixtures/chat-unread-schema.sql}"
MIGRATIONS=()
if [ -z "${CONTRACT_MIGRATION+set}" ]; then
  # Every migration of this contract, in version order (the masters one rewrites the RPC body).
  shopt -s nullglob
  MIGRATIONS=(supabase/migrations/*_whatsapp_leitura_externa*.sql)
  shopt -u nullglob
  [ "${#MIGRATIONS[@]}" -ge 1 ] || { echo "no *_whatsapp_leitura_externa*.sql found" >&2; echo FAIL; exit 1; }
elif [ -n "$CONTRACT_MIGRATION" ]; then
  MIGRATIONS=("$CONTRACT_MIGRATION")
fi
SQL="${CONTRACT_SQL:-tests/integration/chat-external-read.sql}"
IMAGE="${CONTRACT_IMAGE:-postgres:17-alpine}"
NAME="sql-contract-$$-$RANDOM"

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$NAME" -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 \
    && docker exec "$NAME" psql -U postgres -h 127.0.0.1 -tAc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || { echo "postgres did not become ready" >&2; echo FAIL; exit 1; }

psql_file() {
  echo "== $1" >&2
  docker exec -i "$NAME" psql -U postgres -h 127.0.0.1 -X -q -v ON_ERROR_STOP=1 < "$1"
}

# Supabase-like prelude: auth.uid() from the JWT claim and the three API roles.
docker exec -i "$NAME" psql -U postgres -h 127.0.0.1 -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
SQL

psql_file "$FIXTURE"
if [ "${#MIGRATIONS[@]}" -gt 0 ]; then
  for m in "${MIGRATIONS[@]}"; do psql_file "$m"; done
else
  echo "== (no migration applied)" >&2
fi
out="$(psql_file "$SQL")"
echo "$out"
echo "$out" | grep -q CONTRACT_OK || { echo FAIL; exit 1; }
echo PASS
