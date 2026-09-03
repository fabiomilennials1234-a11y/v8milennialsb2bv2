#!/usr/bin/env bash
# scripts/ensaio-scrum641b.sh — ensaio transacional do SCRUM-641 (org nova
# nasce com o Funil de Vendas via trigger em organizations) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum624.sh (guardas mecânicas idênticas).
#
# BEGIN / controle (retrato antes, slug vendas livre, trigger ausente)
#   / 20270918000000 (ARQUIVO DE VERDADE)
#   / depois (não-mudança + sonda end-to-end + RAISE 'ENSAIO_OK' que ABORTA)
#   / ROLLBACK. Nada é aplicado.
#
# Uso:
#   scripts/ensaio-scrum641b.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum641b.sh            # roda contra produção (aborta sozinho)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG_A="$ROOT/supabase/migrations/20270918000000_org_nova_nasce_com_funil_de_vendas.sql"
MIG_B="$ROOT/supabase/migrations/20270918000010_reuniao_ancora_por_papel.sql"
ANTES="$ROOT/scripts/ensaio-scrum641b.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum641b-depois.sql"

MONTAR=0
for a in "$@"; do
  case "$a" in
    --montar) MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum641b.montado.sql}"

for f in "$ANTES" "$MIG_A" "$MIG_B" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ANTES" "$MIG_A" "$MIG_B" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
if grep -q "CONCURRENTLY" "$OUT"; then echo "RECUSADO: CONCURRENTLY nao roda em transacao" >&2; exit 1; fi
grep -q "ENSAIO_OK SCRUM-641b" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> 000000 -> 000010 -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
