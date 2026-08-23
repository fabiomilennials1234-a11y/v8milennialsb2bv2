#!/bin/bash
# test-workflows.sh — Run workflow system tests against Supabase environment
#
# Usage:
#   SUPABASE_SERVICE_ROLE_KEY=... bash scripts/test-workflows.sh
#   SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_URL=... bash scripts/test-workflows.sh
#   SUPABASE_SERVICE_ROLE_KEY=... bash scripts/test-workflows.sh triggers
#   SUPABASE_SERVICE_ROLE_KEY=... bash scripts/test-workflows.sh conditions

set -euo pipefail

PROD_REF="jsjsmuncfkbsbzqzqhfq"
DEV_APOSENTADO_REF="bcfadphgsibjzivtbjvc"

SUPABASE_URL="${SUPABASE_URL:-}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
SUITE="${1:-all}"

# --- alvo ausente: PULA em voz alta, não morre e não inventa um default -------
#
# Antes daqui havia duas armadilhas em duas linhas (SCRUM-364):
#
#   1. `${SUPABASE_SERVICE_ROLE_KEY:?...}` matava o job do CI com
#      "SUPABASE_SERVICE_ROLE_KEY is required" — vermelho que parecia defeito de
#      código e era secret ausente no repositório. Ficou vermelho por meses e
#      treinou todo mundo a ignorar a coluna;
#   2. o default `https://bcfadphgsibjzivtbjvc.supabase.co` apontava para o
#      projeto dev APOSENTADO (decisão do CTO, 2026-07-22), 404 migrations atrás
#      de produção. Ou seja: com o secret cadastrado, o job testaria contra um
#      banco morto e chamaria isso de verde.
#
# Sem alvo, a resposta honesta é PULAR dizendo o que foi pulado. Silêncio aqui
# seria pior que vermelho — mesma doutrina de `tests/remote/guard.ts`.
pular() {
  echo "SKIP — os testes do sistema de workflows NÃO rodaram."
  echo "       Motivo: $1"
  echo "       Eles falam com um Supabase remoto e exigem SUPABASE_URL +"
  echo "       SUPABASE_SERVICE_ROLE_KEY apontando para uma BRANCH EFÊMERA."
  echo "       Como criar: .specs/project/runbook-validacao-local.md"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Workflow System Tests — PULADO"
      echo ""
      echo "**Motivo:** $1"
      echo ""
      echo "Nenhuma asserção foi executada. Verde aqui significa \"não rodou\","
      echo "não \"passou\". Para rodar, aponte \`SUPABASE_URL\` e"
      echo "\`SUPABASE_SERVICE_ROLE_KEY\` para uma branch efêmera"
      echo "(\`.specs/project/runbook-validacao-local.md\`)."
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
}

# --- alvo errado: RECUSA, e vem ANTES do pular --------------------------------
#
# A ordem é a regra: alvo proibido reprova com ou sem chave. Se a checagem de
# chave viesse antes, "https://<prod>" sem secret sairia como SKIP verde, e a
# recusa passaria a depender de uma variável ausente — a mesma proteção
# acidental que `tests/remote/guard.ts` existe para substituir.
case "$SUPABASE_URL" in
  *"$PROD_REF"*)
    echo "RECUSADO: SUPABASE_URL aponta para PRODUÇÃO ($PROD_REF)." >&2
    echo "          Nenhum teste deste repositório escreve em produção — decisão" >&2
    echo "          do CTO, 2026-08-12. Use uma branch efêmera." >&2
    exit 1
    ;;
  *"$DEV_APOSENTADO_REF"*)
    echo "RECUSADO: SUPABASE_URL aponta para o dev APOSENTADO ($DEV_APOSENTADO_REF)," >&2
    echo "          que está 404 migrations atrás de produção. Use uma branch efêmera." >&2
    exit 1
    ;;
esac

[ -z "$SERVICE_KEY" ] && pular "SUPABASE_SERVICE_ROLE_KEY não está definida"
[ -z "$SUPABASE_URL" ] && pular "SUPABASE_URL não está definida (não existe mais default — o antigo apontava para o dev aposentado)"

echo "========================================="
echo " TorqueCRM Workflow System Tests"
echo "========================================="
echo "URL:   $SUPABASE_URL"
echo "Suite: $SUITE"
echo ""

RESULT=$(curl -sS --max-time 120 -X POST \
  "$SUPABASE_URL/functions/v1/test-workflow-system" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"suite\":\"$SUITE\"}")

# Check if jq is available
if command -v jq &> /dev/null; then
  echo "$RESULT" | jq '.'

  TOTAL=$(echo "$RESULT" | jq -r '.summary.total // 0')
  PASSED=$(echo "$RESULT" | jq -r '.summary.passed // 0')
  FAILED=$(echo "$RESULT" | jq -r '.summary.failed // 0')
  SKIPPED=$(echo "$RESULT" | jq -r '.summary.skipped // 0')
  DURATION=$(echo "$RESULT" | jq -r '.duration_ms // 0')

  echo ""
  echo "========================================="
  echo " Summary"
  echo "========================================="
  echo "Total:   $TOTAL"
  echo "Passed:  $PASSED"
  echo "Failed:  $FAILED"
  echo "Skipped: $SKIPPED"
  echo "Time:    ${DURATION}ms"
  echo ""

  # Print failed tests
  if [ "$FAILED" -gt 0 ]; then
    echo "FAILED TESTS:"
    echo "-------------"
    echo "$RESULT" | jq -r '
      [.conditions[], .triggers[], .actions[], .e2e[]]
      | map(select(.status == "failed"))
      | .[]
      | "  X \(.name): \(.error // "unknown error")"
    '
    echo ""
    echo "RESULT: FAILED ($FAILED tests failed)"
    exit 1
  else
    echo "RESULT: ALL TESTS PASSED"
    exit 0
  fi
else
  # No jq — print raw result
  echo "$RESULT"
  if echo "$RESULT" | grep -q '"failed":0'; then
    echo ""
    echo "RESULT: ALL TESTS PASSED"
    exit 0
  else
    echo ""
    echo "RESULT: SOME TESTS FAILED (install jq for detailed output)"
    exit 1
  fi
fi
