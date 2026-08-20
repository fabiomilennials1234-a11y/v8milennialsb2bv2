#!/usr/bin/env bash
# scripts/ensaio-1693.sh — ensaio transacional do #1693 contra PRODUÇÃO.
#
# BEGIN / medição ANTES / migration REAL / asserções / medição DEPOIS / ROLLBACK.
# Nada é aplicado: a última instrução é ROLLBACK, e qualquer asserção que falhe
# aborta a transação antes disso.
#
# A migration entra por concatenação do arquivo de verdade — não de uma cópia —
# para que o ensaio prove o que vai ser aplicado.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIG="$ROOT/supabase/migrations/20270820160000_find_leads_no_reply_enxerga_canal_oficial.sql"
OUT="$(mktemp -t ensaio-1693).sql"

cat "$ROOT/scripts/ensaio-1693-antes.sql" "$MIG" "$ROOT/scripts/ensaio-1693-depois.sql" > "$OUT"
echo "==> ensaio montado em $OUT ($(wc -l < "$OUT") linhas)"
node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
