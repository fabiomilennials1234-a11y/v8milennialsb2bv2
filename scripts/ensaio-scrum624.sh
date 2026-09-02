#!/usr/bin/env bash
# scripts/ensaio-scrum624.sh — ensaio transacional do SCRUM-624 (funil padrão
# da org: coluna organizations.default_pipeline_id + backfill + guarda de
# deleção) contra PRODUÇÃO. Molde: scripts/ensaio-scrum622.sh (guardas
# mecânicas idênticas).
#
# BEGIN / controle (retrato antes, coluna inexistente)
#   / 20270908004000 (ARQUIVO DE VERDADE)
#   / depois (asserções de cobertura + sonda de DELETE + idempotência +
#     RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK. Nada é aplicado.
#
# Independência: a 004000 não referencia nada criado por 001000/002000/003000
# — o ensaio standalone prova o estado real de prod.
#
# Uso:
#   scripts/ensaio-scrum624.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum624.sh            # roda contra produção (aborta sozinho)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270908004000_funil_padrao_da_org.sql"
ANTES="$ROOT/scripts/ensaio-scrum624.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum624-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum624.montado.sql}"

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
grep -q "ENSAIO_OK SCRUM-624" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> 004000 -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
