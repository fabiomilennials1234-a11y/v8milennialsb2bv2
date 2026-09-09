#!/usr/bin/env bash
# scripts/ensaio-1722.sh — ensaio transacional de 20270823000000 + 20270824000000
# contra PRODUÇÃO. Molde: scripts/ensaio-1721.sh.
#
# BEGIN / medição + vermelho / migration #1721 / migration #1722 / asserções
# verdes / rollback #1722 / rollback #1721 / controle negativo / ROLLBACK.
#
# As DUAS migrations entram juntas porque, medido contra produção em 2026-08-24,
# nenhuma está aplicada — e o índice do claim (#1722) depende de claimed_at
# (#1721). Ensaiar só a de cima provaria uma sequência que ninguém vai executar.
#
# Nada é aplicado: a última instrução do arquivo montado é ROLLBACK, e qualquer
# asserção que falhe aborta a transação antes disso.
#
# As migrations e os rollbacks entram por CONCATENAÇÃO DOS ARQUIVOS DE VERDADE —
# não de cópias — para que o ensaio prove o que vai ser aplicado e o que reverte.
#
# Uso:
#   scripts/ensaio-1722.sh --montar   # só monta e imprime o caminho
#   scripts/ensaio-1722.sh            # monta e roda contra produção
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG1="$ROOT/supabase/migrations/20270823000000_blast_recipient_delivery_state.sql"
RBK1="$ROOT/supabase/migrations/rollback/20270823000000_blast_recipient_delivery_state.sql"
MIG2="$ROOT/supabase/migrations/20270824000000_blast_official_worker.sql"
RBK2="$ROOT/supabase/migrations/rollback/20270824000000_blast_official_worker.sql"
OUT="${ENSAIO_OUT:-$ROOT/.ensaio-1722.montado.sql}"

for f in "$MIG1" "$RBK1" "$MIG2" "$RBK2" \
         "$ROOT/scripts/ensaio-1722-antes.sql" \
         "$ROOT/scripts/ensaio-1722-verde.sql" \
         "$ROOT/scripts/ensaio-1722-depois.sql"; do
  [[ -f "$f" ]] || { echo "FALTA: $f" >&2; exit 1; }
done

# Ordem de apply e ordem INVERSA de rollback — a de baixo cai primeiro.
cat "$ROOT/scripts/ensaio-1722-antes.sql" \
    "$MIG1" "$MIG2" \
    "$ROOT/scripts/ensaio-1722-verde.sql" \
    "$RBK2" "$RBK1" \
    "$ROOT/scripts/ensaio-1722-depois.sql" > "$OUT"

# ─── GUARDAS MECÂNICAS, conferidas no arquivo montado ───────────────────────
# O que autoriza este ensaio é a FORMA do payload. A forma é verificada antes de
# sair da máquina, não prometida.

# 1. A última instrução tem de ser ROLLBACK.
ULTIMA="$(grep -vE "^[[:space:]]*(--.*)?$" "$OUT" | tail -1 | tr -d '[:space:]')"
[[ "$ULTIMA" == "ROLLBACK;" ]] || { echo "RECUSADO: ultima instrucao e '$ULTIMA', esperado 'ROLLBACK;'" >&2; exit 1; }

# 2. Exatamente um BEGIN e um ROLLBACK de topo, e nenhum COMMIT.
SEM_COMENTARIO="$(sed -e 's/--.*$//' "$OUT")"
[[ "$(grep -ciE '^[[:space:]]*BEGIN[[:space:]]*;' <<<"$SEM_COMENTARIO")"    == "1" ]] || { echo "RECUSADO: BEGIN de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '^[[:space:]]*ROLLBACK[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "1" ]] || { echo "RECUSADO: ROLLBACK de topo != 1" >&2; exit 1; }
[[ "$(grep -ciE '(^|[[:space:]])COMMIT[[:space:]]*;' <<<"$SEM_COMENTARIO")" == "0" ]] || { echo "RECUSADO: existe COMMIT no arquivo montado" >&2; exit 1; }

# 3. Nenhum UPDATE / DELETE / TRUNCATE / COPY EXECUTADO — isto é, no nível de
#    topo. Dentro de um corpo dollar-quoted o UPDATE é TEXTO de função sendo
#    criada, não escrita: `claim_blast_recipients` reivindica com
#    `UPDATE ... SET claimed_at`, e barrá-lo barraria a própria migration.
#    A distinção é POSIÇÃO, não texto — contamos as aberturas dollar-quote antes
#    de cada linha; número ímpar = está dentro de um corpo.
DML="$(awk '
  { n += gsub(/\$[a-zA-Z_]*\$/, "&") }
  /^[[:space:]]*(UPDATE[[:space:]]|DELETE[[:space:]]+FROM|TRUNCATE|COPY[[:space:]])/ {
      if (n % 2 == 0) print NR": "$0
  }
' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$DML" ]] || { echo "RECUSADO: DML destrutivo no nivel de topo:$DML" >&2; exit 1; }

# 4. Todo INSERT tem de estar dentro de um bloco DO — as sondas se auto-revertem
#    por EXCEPTION. INSERT de topo é escrita de verdade esperando um ROLLBACK, e
#    ROLLBACK não é lugar de guardar coragem.
INSERTS_FORA="$(awk '
  /\$\$/ { n += gsub(/\$\$/, "&") }
  /^[[:space:]]*INSERT[[:space:]]+INTO/ { if (n % 2 == 0) print NR": "$0 }
' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$INSERTS_FORA" ]] || { echo "RECUSADO: INSERT fora de bloco DO:$INSERTS_FORA" >&2; exit 1; }

# 5. As migrations concatenadas têm de ser só schema (guarda F4).
#    Mesma distinção da guarda 3: escrita dentro de corpo de função é texto.
MIG_DML="$(sed -e 's/--.*$//' "$MIG1" "$MIG2" "$RBK1" "$RBK2" | awk '
  { n += gsub(/\$[a-zA-Z_]*\$/, "&") }
  /^[[:space:]]*(INSERT[[:space:]]+INTO|UPDATE[[:space:]]|DELETE[[:space:]]+FROM|TRUNCATE|COPY[[:space:]])/ {
      if (n % 2 == 0) print NR": "$0
  }
' || true)"
[[ -z "$MIG_DML" ]] || { echo "RECUSADO: migration/rollback tocam DADO no nivel de topo:$MIG_DML" >&2; exit 1; }

# 6. CREATE INDEX CONCURRENTLY não roda dentro de transação — se aparecer, o
#    ensaio inteiro aborta no meio e o diagnóstico fica confuso. Barra antes.
CONC="$(grep -inE 'CONCURRENTLY' <<<"$SEM_COMENTARIO" || true)"
[[ -z "$CONC" ]] || { echo "RECUSADO: CONCURRENTLY nao roda em transacao:$CONC" >&2; exit 1; }

echo "==> ensaio montado em $OUT ($(wc -l < "$OUT" | tr -d ' ') linhas)"
echo "==> ordem: antes -> #1721 -> #1722 -> verde -> rollback #1722 -> rollback #1721 -> controle negativo -> ROLLBACK"
echo "==> guardas: ultima instrucao ROLLBACK; 1 BEGIN; 0 COMMIT; 0 UPDATE/DELETE/TRUNCATE/COPY; INSERT so em bloco DO; migrations schema-only; sem CONCURRENTLY"

if [[ "${1:-}" == "--montar" ]]; then
  echo "==> --montar: nada foi executado."
  exit 0
fi

node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
