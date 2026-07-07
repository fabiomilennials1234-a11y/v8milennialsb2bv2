#!/usr/bin/env bash
# scripts/reconcile-metrics.sh
#
# Wrapper do MOTOR GENÉRICO de reconciliação (ADR-0017 §8). Roda, na MESMA
# sessão psql e em ordem, o arquivo de INSTÂNCIA de um par (que monta o temp
# table recon_cells + opcional recon_invariants) e depois reconcile-metrics.sql
# (o motor, que compara e aplica o portão). Propaga o exit code do psql:
#   0  → portão passou (todo delta explicado, invariantes ok)
#   !=0 → delta inexplicado ou invariante violada (ON_ERROR_STOP + RAISE)
#
# READ-ONLY por construção: instância e motor só LEEM tabelas de dados e
# escrevem apenas temp tables (descartadas no fim da sessão). Rode com uma
# credencial read-only (prod) ou contra dev.
#
# USO:
#   DATABASE_URL=... scripts/reconcile-metrics.sh <instance.sql> [psql args...]
#
# Exemplos:
#   # par de vendas #995, org Milennials, desde o apply do caderno:
#   PROD_DATABASE_URL=... scripts/reconcile-metrics.sh \
#     scripts/reconcile-sales-995.sql \
#     -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
#
#   # todas as orgs, tolerância custom:
#   scripts/reconcile-metrics.sh scripts/reconcile-sales-995.sql \
#     -v org_id=NULL -v since="'2027-03-01'" -v tolerance=0.05
#
# #996/#997 reusam ESTE wrapper + reconcile-metrics.sql sem tocar em nada —
# só escrevem o próprio <instance.sql> (mesmo contrato de recon_cells).
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "uso: $0 <instance.sql> [psql args...]" >&2
  exit 2
fi

INSTANCE="$1"; shift
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/reconcile-metrics.sql"

[ -f "$INSTANCE" ] || { echo "instância não encontrada: $INSTANCE" >&2; exit 2; }
[ -f "$ENGINE" ]   || { echo "motor não encontrado: $ENGINE" >&2; exit 2; }

DB_URL="${DATABASE_URL:-${PROD_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}}"

echo "==> reconcile: instância=$(basename "$INSTANCE") motor=$(basename "$ENGINE")"
echo "    DB: ${DB_URL%%\?*}"

# Sessão única: instância monta recon_cells → motor compara e aplica o portão.
# --single-transaction garante rollback de qualquer escrita acidental; as temp
# tables vivem a sessão inteira e morrem no fim.
exec psql "$DB_URL" \
  --no-psqlrc --quiet \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  "$@" \
  --file "$INSTANCE" \
  --file "$ENGINE"
