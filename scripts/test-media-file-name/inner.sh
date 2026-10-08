#!/usr/bin/env bash
# Roda DENTRO do container descartável (ver run.sh). /w = raiz do repo (ro).
set -euo pipefail
T=/w/scripts/test-media-file-name
M=/w/supabase/migrations
P="psql -X -q -v ON_ERROR_STOP=1 -U postgres"

$P -f $T/01-fixture.sql
echo "== migration (1st apply)"
psql -X -v ON_ERROR_STOP=1 -U postgres -f $M/20271108000100_whatsapp_messages_media_file_name.sql
echo "== migration (2nd apply, idempotent)"
psql -X -v ON_ERROR_STOP=1 -U postgres -f $M/20271108000100_whatsapp_messages_media_file_name.sql 2>&1 | grep -E 'NOTICE|ERROR|COMMIT'
echo "== extract + trigger tests"
$P -f $T/02-extract-and-trigger.test.sql
for run in 1 2; do
  echo "== backfill script (run $run)"
  psql -X -v ON_ERROR_STOP=1 -U postgres -f /w/scripts/backfill-media-file-name.sql > /tmp/b$run.log 2>&1
  echo "batches=$(grep -c '^UPDATE' /tmp/b$run.log) nonzero: $(grep '^UPDATE [1-9]' /tmp/b$run.log | tr '\n' ' ') errors=$(grep -c ERROR /tmp/b$run.log || true)"
done
echo "== post-backfill asserts + plan"
$P -f $T/03-after-backfill.test.sql
echo "== rollback"
psql -X -v ON_ERROR_STOP=1 -U postgres -f $M/rollback/20271108000100_whatsapp_messages_media_file_name.sql
psql -X -U postgres -tAc "select 'cols_after_rollback=' || count(*) from information_schema.columns where table_name='whatsapp_messages' and column_name='media_file_name'"
psql -X -U postgres -tAc "select 'fns_after_rollback=' || count(*) from pg_proc where proname like 'whatsapp_messages_%file_name'"
echo "ALL OK"
