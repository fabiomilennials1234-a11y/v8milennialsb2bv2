#!/usr/bin/env bash
# scripts/ensaio-scrum647.sh — ensaio transacional da SCRUM-647 (projeção única
# das métricas de dinheiro) contra PRODUÇÃO. Molde: scripts/ensaio-scrum641.sh.
#
# BEGIN / controle (projeção ausente, 6 views de compat com security_invoker)
#         + retrato ANTES das 6 funções em 3 orgs reais + retrato dos grants
#   / 20270919000000 (ARQUIVO DE VERDADE)
#   / depois (forma da view + projeção vs as 4 views de entrada, linha a linha
#             + igualdade por org antes/depois + grants + RAISE 'ENSAIO_OK')
#   / ROLLBACK. Nada é aplicado.
#
# Uso:
#   scripts/ensaio-scrum647.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum647.sh            # roda contra produção (aborta sozinho)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270919000000_projecao_canonica_do_negocio.sql"
ANTES="$ROOT/scripts/ensaio-scrum647.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum647-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum647.montado.sql}"

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
grep -q "ENSAIO_OK SCRUM-647" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

# Este ensaio é sobre DINHEIRO: nenhuma escrita de dado pode estar no caminho.
if grep -qiE '^[[:space:]]*(INSERT[[:space:]]+INTO[[:space:]]+public\.|UPDATE[[:space:]]+public\.|DELETE[[:space:]]+FROM[[:space:]]+public\.|TRUNCATE)' "$OUT"; then
  echo "RECUSADO: o montado escreve em tabela do schema public" >&2; exit 1
fi
# A demolição dos espelhos é da SCRUM-639, não daqui.
if grep -qiE 'DROP[[:space:]]+VIEW' "$OUT"; then
  echo "RECUSADO: DROP VIEW no montado — as 6 views de compat ficam de pé" >&2; exit 1
fi
# DROP FUNCTION resetaria os grants para PUBLIC/anon.
if grep -qiE 'DROP[[:space:]]+FUNCTION' "$OUT"; then
  echo "RECUSADO: DROP FUNCTION no montado — use CREATE OR REPLACE" >&2; exit 1
fi

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> 20270919000000 -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
