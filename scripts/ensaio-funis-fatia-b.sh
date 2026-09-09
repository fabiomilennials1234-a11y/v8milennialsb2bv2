#!/usr/bin/env bash
# scripts/ensaio-funis-fatia-b.sh — ensaio transacional da Fatia B do épico
# Funil é Funil (campanha e disparo por pipeline_id) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum631.sh (guardas mecânicas idênticas).
#
# BEGIN + baselines (ensaio-funis-fatia-b.sql)
#   / 20270917000000 (a migration: DDL + backfill + asserções A1–A5)
#   / depois (deltas medidos + provas id-first + RAISE 'ENSAIO_OK' que ABORTA)
#   / ROLLBACK. Nada é aplicado.
#
# Uso:
#   scripts/ensaio-funis-fatia-b.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-funis-fatia-b.sh            # roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270917000000_campanha_e_disparo_por_pipeline_id.sql"
ANTES="$ROOT/scripts/ensaio-funis-fatia-b.sql"
DEPOIS="$ROOT/scripts/ensaio-funis-fatia-b-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-funis-fatia-b.montado.sql}"

for f in "$ANTES" "$MIG" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ANTES" "$MIG" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
if grep -q "CONCURRENTLY" "$OUT"; then echo "RECUSADO: CONCURRENTLY nao roda em transacao" >&2; exit 1; fi
grep -q "ENSAIO_OK FATIA-B" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes (baselines) -> 20270917000000 -> depois (deltas + id-first + ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
