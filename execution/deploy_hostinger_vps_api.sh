#!/usr/bin/env bash
# Deploy na VPS Hostinger via API: lista VPS, cria projeto Docker a partir do repo GitHub.
# Ver diretiva: directives/deploy_hostinger_vps.md (Fluxo A)
# Variáveis: HOSTINGER_API_TOKEN (obrigatório), HOSTINGER_VPS_ID (opcional), GITHUB_REPO_URL (opcional)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Carregar .env
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_BASE="${HOSTINGER_API_BASE_URL:-https://developers.hostinger.com}"
REPO_URL="${GITHUB_REPO_URL:-https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2}"
PROJECT_NAME="${HOSTINGER_PROJECT_NAME:-v8milennialsb2b}"

if [[ -z "${HOSTINGER_API_TOKEN}" ]]; then
  echo "Erro: defina HOSTINGER_API_TOKEN no .env ou export (token em hPanel → Perfil → API)."
  exit 1
fi

echo "→ Listando VPS..."
RESP=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${HOSTINGER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  "${API_BASE}/api/vps/v1/virtual-machines")
HTTP_BODY=$(echo "$RESP" | head -n -1)
HTTP_CODE=$(echo "$RESP" | tail -n 1)

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Erro ao listar VPS (HTTP $HTTP_CODE): $HTTP_BODY"
  exit 1
fi

# Descobrir virtualMachineId (primeiro da lista, ou use HOSTINGER_VPS_ID)
if [[ -n "${HOSTINGER_VPS_ID}" ]]; then
  VM_ID="${HOSTINGER_VPS_ID}"
  echo "→ Usando VPS ID: $VM_ID"
else
  VM_ID=$(echo "$HTTP_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data') or d.get('virtual_machines') or []
    if isinstance(items, list) and len(items) > 0:
        vm = items[0]
        print(vm.get('id') or vm.get('virtual_machine_id') or '')
    else:
        print('')
except Exception as e:
    print('', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null || echo "")
  if [[ -z "$VM_ID" ]]; then
    echo "Nenhuma VPS encontrada na conta. Crie uma VPS no hPanel ou defina HOSTINGER_VPS_ID no .env."
    echo "Resposta da API: $HTTP_BODY"
    exit 1
  fi
  echo "→ VPS ID (primeira da lista): $VM_ID"
fi

echo "→ Criando projeto Docker na VPS (repo: $REPO_URL, projeto: $PROJECT_NAME)..."
CREATE_RESP=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Authorization: Bearer ${HOSTINGER_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"project_name\":\"${PROJECT_NAME}\",\"content\":\"${REPO_URL}\"}" \
  "${API_BASE}/api/vps/v1/virtual-machines/${VM_ID}/docker")
CREATE_BODY=$(echo "$CREATE_RESP" | head -n -1)
CREATE_CODE=$(echo "$CREATE_RESP" | tail -n 1)

if [[ "$CREATE_CODE" != "200" && "$CREATE_CODE" != "201" ]]; then
  echo "Erro ao criar projeto (HTTP $CREATE_CODE): $CREATE_BODY"
  exit 1
fi

echo "✓ Deploy iniciado. A VPS está clonando o repositório e subindo o Docker."
echo "  Acompanhe no hPanel (VPS → Docker) ou aguarde alguns minutos e acesse o IP da VPS na porta 80."
echo "  Para atualizar depois: use VPS_updateProjectV1 no MCP ou defina o mesmo project_name e content novamente."
