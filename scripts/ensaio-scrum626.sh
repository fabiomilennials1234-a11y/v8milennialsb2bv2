#!/usr/bin/env bash
# scripts/ensaio-scrum626.sh — ensaio transacional do SCRUM-626 (fusão das
# RPCs de kanban/contagem/público/deleção/bulk por pipeline_id) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum622.sh (guardas mecânicas idênticas).
#
# BEGIN + _param + baselines (ensaio-scrum626.sql)
#   / 20270908003000 (a migration, só funções)
#   / depois (paridade wrapper↔baseline + sondas por id + deletes rolados +
#     RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK. Nada é aplicado.
#
# Migration 100% de funções — guarda schema-only satisfeita por construção:
# 1 BEGIN, 0 COMMIT de topo, última instrução ROLLBACK, ENSAIO_OK presente.
#
# Uso:
#   scripts/ensaio-scrum626.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum626.sh            # roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270908003000_rpcs_fundidas_por_pipeline_id.sql"
ANTES="$ROOT/scripts/ensaio-scrum626.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum626-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum626.montado.sql}"

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
grep -q "ENSAIO_OK SCRUM-626" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }
# Migration de funções: nenhum DML em tabela de negócio fora dos corpos de
# função é esperado no arquivo da migration (as sondas destrutivas moram no
# DEPOIS e rolam no ROLLBACK).

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes (baselines) -> 20270908003000 -> depois (paridade + sondas + ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
