#!/usr/bin/env bash
# scripts/ensaio-scrum616.sh — ensaio transacional de 20270906001000 (SCRUM-616,
# etapas ganham FK ao funil) contra PRODUÇÃO. Molde: scripts/ensaio-1722.sh.
#
# BEGIN / snapshot + vermelho / migration / verde (fidelidade, ordem, sonda
# INSTEAD OF, sonda reorder) / rollback pareado / depois (estado revertido +
# RAISE 'ENSAIO_OK') / ROLLBACK.
#
# Nada é aplicado: o "depois" termina em RAISE EXCEPTION 'ENSAIO_OK ...' (aborta
# a transação com as métricas) e a última instrução do payload é ROLLBACK.
#
# A migration e o rollback entram por CONCATENAÇÃO DOS ARQUIVOS DE VERDADE — não
# de cópias — para que o ensaio prove o que vai ser aplicado e o que reverte.
#
# ⚠️ Diferença deliberada do molde 1722: esta migration É migração de dados
#    (backfill + carga das 531 etapas custom), então a guarda "schema-only" não
#    se aplica. As guardas mantidas: 1 BEGIN, 0 COMMIT, última instrução
#    ROLLBACK, sem CONCURRENTLY, e o 'depois' contém o RAISE 'ENSAIO_OK' que
#    aborta antes de qualquer chance de commit.
#
# ⚠️ NÃO RODAR sem janela aprovada pelo CTO (D7 do spec) — o ensaio segura locks
#    reais em pipeline_stages/custom_pipeline_stages enquanto executa.
#
# Uso:
#   scripts/ensaio-scrum616.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum616.sh            # monta e roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270906001000_etapas_ganham_fk_ao_funil.sql"
RBK="$ROOT/supabase/migrations/rollback/20270906001000_etapas_ganham_fk_ao_funil.sql"
ANTES="$ROOT/scripts/ensaio-scrum616.sql"
VERDE="$ROOT/scripts/ensaio-scrum616-verde.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum616-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum616.montado.sql}"

for f in "$MIG" "$RBK" "$ANTES" "$VERDE" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ANTES" "$MIG" "$VERDE" "$RBK" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS, conferidas no arquivo montado ───────────────────────

# 1. A última instrução tem de ser ROLLBACK.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

# 2. Exatamente um BEGIN e um ROLLBACK de topo, e nenhum COMMIT.
SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }

# 3. CREATE INDEX CONCURRENTLY não roda dentro de transação.
CONC="$(grep -inE 'CONCURRENTLY' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$CONC" ]] || { echo "RECUSADO: CONCURRENTLY nao roda em transacao:$CONC" >&2; exit 1; }

# 4. O 'depois' precisa carregar o RAISE 'ENSAIO_OK' — é ele que garante o abort.
grep -q "ENSAIO_OK SCRUM-616" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> migration -> verde -> rollback -> depois (ENSAIO_OK) -> ROLLBACK"
echo "==> guardas: 1 BEGIN; 0 COMMIT; ultima instrucao ROLLBACK; sem CONCURRENTLY; ENSAIO_OK presente"

if [[ "${1:-}" == "--montar" ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
