#!/usr/bin/env bash
# Disposable real PostgreSQL contract test, independent of production credentials.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cluster="$(mktemp -d "${TMPDIR:-/tmp}/torque-comment-docs.XXXXXX")"
trap 'pg_ctl -D "$cluster/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
initdb -D "$cluster/data" -A trust >/dev/null
# A private unix socket avoids TCP port conflicts/exposure.
pg_ctl -D "$cluster/data" -l "$cluster/postgres.log" -o "-h '' -k '$cluster'" start >/dev/null
createdb -h "$cluster" comments
psql -X -v ON_ERROR_STOP=1 -h "$cluster" -d comments \
  -f "$root/tests/integration/fixtures/deal-comment-documents-schema.sql" \
  -f "$root/supabase/migrations/20271019000009_deal_comment_documents.sql" \
  -f "$root/tests/integration/fixtures/deal-comment-documents-test.sql" \
  -f "$root/supabase/migrations/rollback/20271019000009_deal_comment_documents.sql"
printf 'PostgreSQL: upload, metadata, tenant isolation, master, edits and soft-delete passed.\n'
