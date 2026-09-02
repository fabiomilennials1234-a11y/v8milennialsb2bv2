#!/usr/bin/env bash
# scripts/ensaio-scrum631.sh — ensaio transacional do SCRUM-631 (analytics por
# pipeline_id: get_funnel_conversion, get_pipeline_velocity,
# get_sales_cycle_analysis, get_analytics_pipeline_metrics) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum626.sh (guardas mecânicas idênticas).
#
# BEGIN + _e631_orgs + baselines (ensaio-scrum631.sql)
#   / 20270908009000 (a migration, só funções)
#   / depois (ACL + paridade byte-a-byte + deltas medidos + sondas custom +
#     RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK. Nada é aplicado.
#
# Migration 100% de funções — guarda schema-only satisfeita por construção:
# 1 BEGIN, 0 COMMIT de topo, última instrução ROLLBACK, ENSAIO_OK presente.
#
# Uso:
#   scripts/ensaio-scrum631.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum631.sh            # roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270908009000_analytics_por_pipeline_id.sql"
ANTES="$ROOT/scripts/ensaio-scrum631.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum631-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum631.montado.sql}"

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
grep -q "ENSAIO_OK SCRUM-631" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }
# Migration de funções: nenhum DML em tabela de negócio fora dos corpos de
# função; as leituras do ensaio moram no ANTES/DEPOIS e tudo rola no ROLLBACK.

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes (baselines 3 orgs) -> 20270908009000 -> depois (ACL + paridade + deltas + sondas + ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
