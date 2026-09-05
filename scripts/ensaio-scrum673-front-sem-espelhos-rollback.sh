#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANTES="$ROOT/scripts/ensaio-scrum673-front-sem-espelhos-rollback-antes.sql"
MIG="$ROOT/supabase/migrations/20271006000000_front_escreve_sem_espelhos.sql"
ROLLBACK_MIG="$ROOT/supabase/migrations/rollback/20271006000000_front_escreve_sem_espelhos.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum673-front-sem-espelhos-rollback-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum673-front-sem-espelhos-rollback.montado.sql}"

cat "$ANTES" "$MIG" "$ROLLBACK_MIG" "$DEPOIS" > "$OUT"

ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || {
  echo "RECUSADO: última instrução é '$ULTIMA'" >&2
  exit 1
}

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
