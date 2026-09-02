#!/usr/bin/env bash
# scripts/ensaio-scrum629.sh — ensaio transacional do SCRUM-629 (disparo por
# etapa em funil custom — freio triplo D11) contra PRODUÇÃO. Molde:
# scripts/ensaio-scrum624.sh (guardas mecânicas idênticas).
#
# BEGIN + controle + exercício de sistema com o trigger ANTIGO (ensaio-scrum629.sql)
#   / 20270908008000 (ARQUIVO DE VERDADE)
#   / depois (S1 toggle OFF→0 · S2 ON+movimento→1 · S3 corte temporal nos dois
#     claims · S5 OFF cancela pendência · S4 paridade de sistema +
#     RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK. Nada é aplicado.
#
# Escritas colaterais dos triggers (fila, net.http_request_queue, eventos) são
# transacionais: o ROLLBACK desfaz tudo e o worker do pg_net não lê linha não
# commitada — nenhum WhatsApp real sai deste ensaio.
#
# Uso:
#   scripts/ensaio-scrum629.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum629.sh            # roda contra produção (aborta sozinho)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270908008000_disparo_por_etapa_em_funil_custom.sql"
ANTES="$ROOT/scripts/ensaio-scrum629.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum629-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum629.montado.sql}"

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
grep -q "ENSAIO_OK SCRUM-629" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes (paridade/antes) -> 008000 -> depois (S1..S5 + ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
