#!/usr/bin/env bash
# scripts/ensaio-scrum674-passo2.sh — ensaio transacional do passo 2 da
# SCRUM-674 (os INSTEAD OF delegam às funções) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum641.sh — mesmas guardas mecânicas.
#
# BEGIN / antes (as 4 funções não existem + 5 escritoras pelos espelhos)
#   / 20271003000000 (ARQUIVO DE VERDADE, sem transação própria)
#   / depois (igualdade view-vs-função + controle positivo + RAISE ENSAIO_OK)
#   / ROLLBACK. Nada é aplicado.
#
# Uso:
#   scripts/ensaio-scrum674-passo2.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum674-passo2.sh            # roda contra prod (aborta sozinho)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20271003000000_os_espelhos_delegam.sql"
ANTES="$ROOT/scripts/ensaio-scrum674-passo2.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum674-passo2-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum674-passo2.montado.sql}"

for f in "$ANTES" "$MIG" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ANTES" "$MIG" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────
# Sem elas, um COMMIT esquecido no meio APLICA em produção o que deveria ser
# só ensaio. É a diferença entre um teste e um incidente.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
grep -q "CONCURRENTLY" "$OUT" && { echo "RECUSADO: CONCURRENTLY nao roda em transacao" >&2; exit 1; }
grep -q "ENSAIO_OK SCRUM-674" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> 20271003000000 -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
