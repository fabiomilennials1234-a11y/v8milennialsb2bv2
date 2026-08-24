#!/usr/bin/env bash
# scripts/ensaio-1721.sh — ensaio transacional do #1721 contra PRODUÇÃO.
#
# BEGIN / medição ANTES + vermelho / migration REAL / asserções verdes /
# rollback REAL / controle negativo + relatório / ROLLBACK.
#
# Nada é aplicado: a última instrução do arquivo montado é ROLLBACK, e qualquer
# asserção que falhe aborta a transação antes disso.
#
# A migration e o rollback entram por CONCATENAÇÃO DOS ARQUIVOS DE VERDADE — não
# de cópias — para que o ensaio prove o que vai ser aplicado e o que vai reverter.
#
# Uso:
#   scripts/ensaio-1721.sh --montar   # só monta e imprime o caminho, não roda
#   scripts/ensaio-1721.sh            # monta e roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270823000000_blast_recipient_delivery_state.sql"
RBK="$ROOT/supabase/migrations/rollback/20270823000000_blast_recipient_delivery_state.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-1721.montado.sql}"

for f in "$MIG" "$RBK" \
         "$ROOT/scripts/ensaio-1721-antes.sql" \
         "$ROOT/scripts/ensaio-1721-verde.sql" \
         "$ROOT/scripts/ensaio-1721-depois.sql"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

cat "$ROOT/scripts/ensaio-1721-antes.sql" \
    "$MIG" \
    "$ROOT/scripts/ensaio-1721-verde.sql" \
    "$RBK" \
    "$ROOT/scripts/ensaio-1721-depois.sql" > "$OUT"

# ─── GUARDAS MECÂNICAS, conferidas no arquivo montado ───────────────────────
# Não são decoração: o que autoriza este ensaio é a FORMA do payload, então a
# forma é verificada antes de sair da máquina, não prometida.

# 1. A última instrução tem de ser ROLLBACK.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

# 2. Exatamente um BEGIN e um ROLLBACK, e nenhum COMMIT em lugar nenhum.
SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }

# 3. Nenhum UPDATE / DELETE / TRUNCATE / COPY, em nenhuma linha.
DML="$(grep -inE '^[[:space:]]*(UPDATE[[:space:]]|DELETE[[:space:]]+FROM|TRUNCATE|COPY[[:space:]])' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$DML" ]] || { echo "RECUSADO: DML destrutivo no ensaio:$DML" >&2; exit 1; }

# 4. Todo INSERT tem de estar dentro de uma sonda pg_temp (que se auto-reverte).
#    Qualquer INSERT fora delas é escrita de verdade esperando um ROLLBACK — e
#    ROLLBACK não é lugar de guardar coragem.
# Casar pelo texto do INSERT deixaria passar um INSERT de topo com o mesmo
# formato. O que precisa ser verdade é POSIÇÃO: todo INSERT tem de estar DENTRO
# de um corpo `$sonda$ ... $sonda$`. Contamos as aberturas de sonda antes de cada
# INSERT — número ímpar = está dentro de uma. Achado do /code-review.
INSERTS_FORA="$(awk '
  /\$sonda\$/ { n += gsub(/\$sonda\$/, "&") }
  /^[[:space:]]*INSERT[[:space:]]+INTO/ { if (n % 2 == 0) print NR": "$0 }
' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$INSERTS_FORA" ]] || { echo "RECUSADO: INSERT fora das sondas:$INSERTS_FORA" >&2; exit 1; }

# 5. A migration concatenada tem de ser só schema (guarda F4).
MIG_DML="$(sed -e 's/--.*$//' "$MIG" "$RBK" \
           | grep -inE '^[[:space:]]*(INSERT[[:space:]]+INTO|UPDATE[[:space:]]|DELETE[[:space:]]+FROM|TRUNCATE|COPY[[:space:]])' || true)"
[[ -z "$MIG_DML" ]] || { echo "RECUSADO: migration/rollback tocam DADO:$MIG_DML" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> guardas: ultima instrucao ROLLBACK; 1 BEGIN; 0 COMMIT; 0 UPDATE/DELETE/TRUNCATE/COPY; INSERT so em sonda; migration schema-only"

if [[ "${1:-}" == "--montar" ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
