#!/usr/bin/env bash
# Ensaio transacional da janela 1 do passo 3 da SCRUM-674 contra PROD.
# Monta: antes (RPCs velhas) + migration real + depois (RPCs novas) + ROLLBACK.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20271004000000_as_escritoras_saem_dos_espelhos.sql"
ANTES="$ROOT/scripts/ensaio-scrum674-passo3-rpcs.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum674-passo3-rpcs-depois.sql"
ROLLBACK_MIG="$ROOT/supabase/migrations/rollback/20271004000000_as_escritoras_saem_dos_espelhos.sql"
ROLLBACK_ANTES="$ROOT/scripts/ensaio-scrum674-passo3-rpcs-rollback-antes.sql"
ROLLBACK_DEPOIS="$ROOT/scripts/ensaio-scrum674-passo3-rpcs-rollback-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum674-passo3-rpcs.montado.sql}"

MONTAR=0
MODO=equivalencia
for arg in "$@"; do
  case "$arg" in
    --montar) MONTAR=1 ;;
    --rollback) MODO=rollback ;;
    *) echo "argumento desconhecido: $arg" >&2; exit 1 ;;
  esac
done

for file in "$ANTES" "$MIG" "$DEPOIS" "$ROLLBACK_MIG" "$ROLLBACK_ANTES" "$ROLLBACK_DEPOIS"; do
  [[ -f "$file" ]] || { echo "FALTA: $file" >&2; exit 1; }
done

if [[ "$MODO" == "rollback" ]]; then
  cat "$ROLLBACK_ANTES" "$MIG" "$ROLLBACK_MIG" "$ROLLBACK_DEPOIS" > "$OUT"
  MARCADOR="ENSAIO_OK SCRUM-674 rollback janela 1"
  ORDEM="baseline PROD -> migration -> rollback dedicado -> comparação -> ROLLBACK"
else
  cat "$ANTES" "$MIG" "$DEPOIS" > "$OUT"
  MARCADOR="ENSAIO_OK SCRUM-674 passo 3 janela 1"
  ORDEM="RPCs velhas -> migration -> RPCs novas -> ROLLBACK"
fi

ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: última instrução é '$ULTIMA'" >&2; exit 1; }

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT" >&2; exit 1; }
grep -q "CONCURRENTLY" "$OUT" && { echo "RECUSADO: CONCURRENTLY em transação" >&2; exit 1; }
grep -q "$MARCADOR" "$OUT" || { echo "RECUSADO: marcador ENSAIO_OK ausente" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: $ORDEM"

if [[ $MONTAR == 1 ]]; then
  echo "==> --montar: nada executado"
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
