#!/usr/bin/env bash
# scripts/ensaio-scrum622.sh — ensaio transacional do SCRUM-622 (migration do
# CHECK 20270908002000 + backfill um-Negócio-por-card-custom) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum621.sh (guardas mecânicas idênticas).
#
# BEGIN / controle + _param (todas as orgs do recorte, Milennials ord=1)
#   / [--com-621: 20270908001000 concatenada — prova o estado pós-inversão]
#   / 20270908002000 (CHECK) / scrum622-backfill-negocios.sql (ARQUIVO DE
#   VERDADE, com todas as guardas dentro) / depois (sonda de procedência +
#   RAISE 'ENSAIO_OK' que ABORTA) / ROLLBACK. Nada é aplicado.
#
# O backfill detecta sozinho o estado do espelho (relkind de
# custom_pipe_entries). PROD JÁ TEM a 20270908001000 (aplicada 2026-09-02):
# o ensaio sem flag prova o estado real (VIEW/pós-621) — ENSAIO_OK capturado
# nesse estado. --com-621 só serve contra um banco que ainda NÃO tenha a
# inversão (branch/preview); contra prod ela falharia no meio e abortaria.
#
# ⚠️ Migração de DADOS: a guarda "schema-only" não se aplica. Mantidas:
#    1 BEGIN, 0 COMMIT de topo, última instrução ROLLBACK, ENSAIO_OK presente.
#
# Uso:
#   scripts/ensaio-scrum622.sh --montar             # só monta e imprime o caminho
#   scripts/ensaio-scrum622.sh                      # roda contra produção (estado atual)
#   scripts/ensaio-scrum622.sh --com-621            # roda encadeando a 20270908001000
#   scripts/ensaio-scrum622.sh --com-621 --montar
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG621="$ROOT/supabase/migrations/20270908001000_inversao_do_silo_custom.sql"
MIG622="$ROOT/supabase/migrations/20270908002000_procedencia_backfill_funil_custom.sql"
DADO="$ROOT/scripts/scrum622-backfill-negocios.sql"
ANTES="$ROOT/scripts/ensaio-scrum622.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum622-depois.sql"

COM621=0
MONTAR=0
for a in "$@"; do
  case "$a" in
    --com-621) COM621=1 ;;
    --montar)  MONTAR=1 ;;
    *) echo "argumento desconhecido: $a" >&2; exit 1 ;;
  esac
done

SUFIXO=""
if [[ $COM621 == 1 ]]; then SUFIXO=".com-621"; fi
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum622${SUFIXO}.montado.sql}"

FILES=("$ANTES")
[[ $COM621 == 1 ]] && FILES+=("$MIG621")
FILES+=("$MIG622" "$DADO" "$DEPOIS")
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "${FILES[@]}" > "$OUT"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }
if grep -q "CONCURRENTLY" "$OUT"; then echo "RECUSADO: CONCURRENTLY nao roda em transacao" >&2; exit 1; fi
grep -q "ENSAIO_OK SCRUM-622" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas; com-621=$COM621)"
CADEIA="002000 -> backfill"
if [[ $COM621 == 1 ]]; then CADEIA="001000 -> $CADEIA"; fi
echo "==> ordem: antes -> $CADEIA -> depois (ENSAIO_OK) -> ROLLBACK"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
