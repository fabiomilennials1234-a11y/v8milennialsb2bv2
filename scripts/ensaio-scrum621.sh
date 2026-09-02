#!/usr/bin/env bash
# scripts/ensaio-scrum621.sh — ensaio transacional da migration
# supabase/migrations/20270908001000_inversao_do_silo_custom.sql (SCRUM-621)
# contra PRODUÇÃO. Molde: scripts/ensaio-scrum620.sh.
#
# BEGIN / controle + snapshot / MIGRATION DE VERDADE (concatenada, não cópia) /
# depois (sondas I-U-D + workflow ADR-0031 + dispatch D11 + tenancy +
# RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK. Nada é aplicado.
#
# Uso:
#   scripts/ensaio-scrum621.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum621.sh            # monta e roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/supabase/migrations/20270908001000_inversao_do_silo_custom.sql"
ANTES="$ROOT/scripts/ensaio-scrum621.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum621-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum621.montado.sql}"

for f in "$SCRIPT" "$ANTES" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ANTES" "$SCRIPT" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
grep -q "ENSAIO_OK SCRUM-621" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> migration -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ "${1:-}" == "--montar" ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
