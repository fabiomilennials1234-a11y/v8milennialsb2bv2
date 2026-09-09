#!/usr/bin/env bash
# scripts/ensaio-scrum620.sh — ensaio transacional do script de dado
# scripts/scrum620-stage-roles.sql (SCRUM-620) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum616.sh.
#
# BEGIN / controle + snapshot / script de verdade (concatenado, não cópia) /
# depois (métricas do delta + RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK.
# Nada é aplicado.
#
# Uso:
#   scripts/ensaio-scrum620.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum620.sh            # monta e roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/scrum620-stage-roles.sql"
ANTES="$ROOT/scripts/ensaio-scrum620.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum620-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum620.montado.sql}"

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
grep -q "ENSAIO_OK SCRUM-620" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> script -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ "${1:-}" == "--montar" ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
