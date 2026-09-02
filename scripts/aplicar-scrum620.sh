#!/usr/bin/env bash
# scripts/aplicar-scrum620.sh — APLICA o script de dado SCRUM-620 em PRODUÇÃO.
# ⚠️ SÓ NA JANELA DO CTO, com o ensaio (scripts/ensaio-scrum620.sh) verde na
#    mesma janela. Embrulha em BEGIN/COMMIT (SET LOCAL ROLE exige transação;
#    as asserções A1/A2/A3 dentro do script abortam tudo se falharem).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/scrum620-stage-roles.sql"
OUT="$ROOT/.aplicar-scrum620.montado.sql"

[[ "${1:-}" == "--sim-cto-aprovou" ]] || {
  echo "RECUSADO: rode com --sim-cto-aprovou apos aprovacao explicita da janela." >&2; exit 1; }

{ echo "BEGIN;"; cat "$SCRIPT"; echo "COMMIT;"; } > "$OUT"
echo "==> aplicando $SCRIPT em PRODUCAO (jsjsmuncfkbsbzqzqhfq)"
node "$ROOT/scripts/prod-sql.mjs" --file "$OUT"
echo "==> COMMIT feito. Proximo passo: CTO carimba a fila em /master/stage-roles."
