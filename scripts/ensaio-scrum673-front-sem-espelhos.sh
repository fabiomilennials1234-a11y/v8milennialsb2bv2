#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANTES="$ROOT/scripts/ensaio-scrum673-front-sem-espelhos-antes.sql"
MIG="$ROOT/supabase/migrations/20271006000000_front_escreve_sem_espelhos.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum673-front-sem-espelhos-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum673-front-sem-espelhos.montado.sql}"

cat "$ANTES" "$MIG" "$DEPOIS" > "$OUT"

ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || {
  echo "RECUSADO: última instrução é '$ULTIMA'" >&2
  exit 1
}

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || {
  echo "RECUSADO: BEGIN de topo != 1" >&2
  exit 1
}
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || {
  echo "RECUSADO: ROLLBACK de topo != 1" >&2
  exit 1
}

if [[ "${1:-}" == "--montar" ]]; then
  echo "$OUT"
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
