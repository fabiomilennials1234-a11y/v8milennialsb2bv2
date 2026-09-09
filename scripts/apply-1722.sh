#!/usr/bin/env bash
# scripts/apply-1722.sh — APLICA 20270823000000 (#1721) e 20270824000000 (#1722)
# em PRODUÇÃO, numa transação só, com o ledger dentro dela.
#
# Este script ESCREVE. O ensaio equivalente é scripts/ensaio-1722.sh, que termina
# em ROLLBACK e já rodou verde contra produção em 2026-08-24.
#
# Ordem: precondições -> #1721 -> #1722 -> as MESMAS asserções verdes do ensaio
#        -> ledger -> COMMIT.
#
# Se qualquer asserção falhar, a transação aborta e NADA é aplicado — nem o
# schema, nem o ledger. Não existe estado intermediário.
#
# Uso:
#   scripts/apply-1722.sh                        # monta, confere guardas, NÃO executa
#   scripts/apply-1722.sh --aplicar-em-producao  # executa
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG1="$ROOT/supabase/migrations/20270823000000_blast_recipient_delivery_state.sql"
MIG2="$ROOT/supabase/migrations/20270824000000_blast_official_worker.sql"
OUT="${APPLY_OUT:-$ROOT/.apply-1722.montado.sql}"

for f in "$MIG1" "$MIG2" \
         "$ROOT/scripts/apply-1722-antes.sql" \
         "$ROOT/scripts/ensaio-1722-verde.sql" \
         "$ROOT/scripts/apply-1722-ledger.sql"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

# As asserções verdes são LITERALMENTE as do ensaio — mesmo arquivo, não cópia.
# Se elas divergissem, o ensaio teria provado outra coisa que não este apply.
cat "$ROOT/scripts/apply-1722-antes.sql" \
    "$MIG1" "$MIG2" \
    "$ROOT/scripts/ensaio-1722-verde.sql" \
    "$ROOT/scripts/apply-1722-ledger.sql" > "$OUT"

SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"

# ─── GUARDAS MECÂNICAS ──────────────────────────────────────────────────────

# 1. A última instrução tem de ser COMMIT — e só uma.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "COMMIT;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'COMMIT;'" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: COMMIT != 1" >&2; exit 1; }

# 2. Um BEGIN de topo, e NENHUM ROLLBACK — apply que carrega rollback de topo
#    é ensaio disfarçado, e a distinção entre os dois não pode depender de leitura.
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe ROLLBACK de topo — isto seria um ensaio, nao um apply" >&2; exit 1; }

# 3. Nenhum UPDATE / DELETE / TRUNCATE / COPY no nível de topo. Dentro de corpo
#    dollar-quoted é TEXTO de função (claim_blast_recipients escreve claimed_at).
DML="$(awk '
  { n += gsub(/\$[a-zA-Z_]*\$/, "&") }
  /^[[:space:]]*(UPDATE[[:space:]]|DELETE[[:space:]]+FROM|TRUNCATE|COPY[[:space:]])/ { if (n % 2 == 0) print NR": "$0 }
' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$DML" ]] || { echo "RECUSADO: DML destrutivo no nivel de topo:$DML" >&2; exit 1; }

# 4. O ÚNICO INSERT de topo permitido é o do ledger. Qualquer outro é dado de
#    cliente entrando por carona numa migration de schema.
INSERTS="$(awk '
  { n += gsub(/\$[a-zA-Z_]*\$/, "&") }
  /^[[:space:]]*INSERT[[:space:]]+INTO/ { if (n % 2 == 0) print NR": "$0 }
' <<<"$SEM_COMENTARIO" || true)"
QTD="$(grep -c . <<<"${INSERTS:-}" || true)"
[[ -z "$INSERTS" ]] && QTD=0
[[ "$QTD" == "1" ]] || { echo "RECUSADO: esperava 1 INSERT de topo (o do ledger), achei $QTD:$INSERTS" >&2; exit 1; }
grep -q "supabase_migrations.schema_migrations" <<<"$INSERTS" || { echo "RECUSADO: o INSERT de topo nao e o do ledger:$INSERTS" >&2; exit 1; }

# 5. As migrations concatenadas têm de ser só schema no nível de topo.
MIG_DML="$(sed -e 's/--.*$//' "$MIG1" "$MIG2" | awk '
  { n += gsub(/\$[a-zA-Z_]*\$/, "&") }
  /^[[:space:]]*(INSERT[[:space:]]+INTO|UPDATE[[:space:]]|DELETE[[:space:]]+FROM|TRUNCATE|COPY[[:space:]])/ { if (n % 2 == 0) print NR": "$0 }
' || true)"
[[ -z "$MIG_DML" ]] || { echo "RECUSADO: migration toca DADO no nivel de topo:$MIG_DML" >&2; exit 1; }

# 6. CONCURRENTLY não roda em transação.
CONC="$(grep -inE 'CONCURRENTLY' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$CONC" ]] || { echo "RECUSADO: CONCURRENTLY nao roda em transacao:$CONC" >&2; exit 1; }

# 7. As asserções verdes têm de ser o MESMO arquivo do ensaio, byte a byte.
ENSAIO_SHA="$(shasum -a 256 "$ROOT/scripts/ensaio-1722-verde.sql" | awk '{print $1}')"
echo "==> asserções verdes: ensaio-1722-verde.sql sha256 ${ENSAIO_SHA:0:16}… (o mesmo arquivo que o ensaio usou)"

echo "==> apply montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: precondições -> #1721 -> #1722 -> verde -> ledger -> COMMIT"
echo "==> guardas: ultima instrucao COMMIT; 1 BEGIN; 1 COMMIT; 0 ROLLBACK; 0 DML de topo; 1 INSERT de topo (ledger); migrations schema-only; sem CONCURRENTLY"

if [[ "${1:-}" != "--aplicar-em-producao" ]]; then
  echo
  echo "==> NADA FOI EXECUTADO."
  echo "==> Para aplicar de verdade:  scripts/apply-1722.sh --aplicar-em-producao"
  exit 0
fi

echo
echo "==> APLICANDO EM PRODUÇÃO (jsjsmuncfkbsbzqzqhfq)…"
node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
