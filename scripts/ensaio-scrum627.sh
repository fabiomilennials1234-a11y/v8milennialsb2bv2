#!/usr/bin/env bash
# Monta o ensaio SCRUM-627: BEGIN + migration 20270908006000 + cenário + ROLLBACK.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(mktemp -t ensaio627)"
awk '/^-- \(o shell injeta o conteúdo da migration aqui\)$/ {
  print;
  while ((getline line < "supabase/migrations/20270908006000_contexto_unico_dos_gatilhos_de_workflow.sql") > 0) print line;
  close("supabase/migrations/20270908006000_contexto_unico_dos_gatilhos_de_workflow.sql");
  next
} { print }' scripts/ensaio-scrum627.sql > "$OUT"
node scripts/prod-sql.mjs --file "$OUT"
rm -f "$OUT"
