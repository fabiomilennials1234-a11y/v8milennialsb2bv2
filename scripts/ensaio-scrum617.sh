#!/usr/bin/env bash
# scripts/ensaio-scrum617.sh — ensaio transacional de 20270906001000 (SCRUM-616)
# + 20270906002000 (SCRUM-617, cards apontam etapa por UUID) contra PRODUÇÃO.
# Molde: scripts/ensaio-scrum616.sh.
#
# Prod ainda NÃO tem a 20270906001000: o ensaio roda as DUAS em sequência.
#
# BEGIN / snapshot + vermelho / 001000 / 002000 / verde (cobertura, identidade,
# sonda INSTEAD OF pipe_whatsapp, sonda sync custom_pipe_entries) / rollback
# 002000 / rollback 001000 / depois (estado revertido + RAISE 'ENSAIO_OK') /
# ROLLBACK.
#
# Nada é aplicado: o "depois" termina em RAISE EXCEPTION 'ENSAIO_OK ...' (aborta
# a transação com as métricas) e a última instrução do payload é ROLLBACK.
#
# As migrations e os rollbacks entram por CONCATENAÇÃO DOS ARQUIVOS DE VERDADE —
# não de cópias — para que o ensaio prove o que vai ser aplicado e o que reverte.
#
# ⚠️ Migrações de DADOS (backfill de stage_id + reparo uuid-key + carga do
#    SCRUM-616): a guarda "schema-only" não se aplica. Guardas mantidas:
#    1 BEGIN, 0 COMMIT, última instrução ROLLBACK, sem CONCURRENTLY, e o
#    'depois' contém o RAISE 'ENSAIO_OK' que aborta antes de qualquer commit.
#
# ⚠️ NÃO RODAR sem janela aprovada pelo CTO (D7 do spec) — o ensaio segura locks
#    reais em pipeline_entries/pipeline_stages/custom_pipeline_stages.
#
# Uso:
#   scripts/ensaio-scrum617.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-scrum617.sh            # monta e roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG616="$ROOT/supabase/migrations/20270906001000_etapas_ganham_fk_ao_funil.sql"
MIG617="$ROOT/supabase/migrations/20270906002000_cards_apontam_etapa_por_uuid.sql"
RBK617="$ROOT/supabase/migrations/rollback/20270906002000_cards_apontam_etapa_por_uuid.sql"
RBK616="$ROOT/supabase/migrations/rollback/20270906001000_etapas_ganham_fk_ao_funil.sql"
ANTES="$ROOT/scripts/ensaio-scrum617.sql"
VERDE="$ROOT/scripts/ensaio-scrum617-verde.sql"
DEPOIS="$ROOT/scripts/ensaio-scrum617-depois.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-scrum617.montado.sql}"

for f in "$MIG616" "$MIG617" "$RBK617" "$RBK616" "$ANTES" "$VERDE" "$DEPOIS"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

# Ordem: rollback do 617 ANTES do rollback do 616 — a FK de pipeline_entries
# aponta para pipeline_stages; o 616 não consegue reverter com ela viva.
cat "$ANTES" "$MIG616" "$MIG617" "$VERDE" "$RBK617" "$RBK616" "$DEPOIS" > "$OUT"

# ─── GUARDAS MECÂNICAS, conferidas no arquivo montado ───────────────────────

# 1. A última instrução tem de ser ROLLBACK.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

# 2. Exatamente um BEGIN e um ROLLBACK de topo, e nenhum COMMIT.
#    (Os BEGIN/END de blocos plpgsql não contam: vivem dentro de DO $$...$$ e
#    os das sondas terminam sem ';' no início da linha? — não: o filtro pega
#    apenas 'BEGIN;' sozinho na linha, forma que plpgsql não usa.)
SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;[[:space:]]*$' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;[[:space:]]*$' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }

# 3. CREATE INDEX CONCURRENTLY não roda dentro de transação.
CONC="$(grep -inE 'CONCURRENTLY' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$CONC" ]] || { echo "RECUSADO: CONCURRENTLY nao roda em transacao:$CONC" >&2; exit 1; }

# 4. O 'depois' precisa carregar o RAISE 'ENSAIO_OK' — é ele que garante o abort.
grep -q "ENSAIO_OK SCRUM-617" "$DEPOIS" || { echo "RECUSADO: depois sem RAISE ENSAIO_OK" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> 001000 -> 002000 -> verde -> rbk 002000 -> rbk 001000 -> depois (ENSAIO_OK) -> ROLLBACK"
echo "==> guardas: 1 BEGIN; 0 COMMIT; ultima instrucao ROLLBACK; sem CONCURRENTLY; ENSAIO_OK presente"

if [[ "${1:-}" == "--montar" ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
