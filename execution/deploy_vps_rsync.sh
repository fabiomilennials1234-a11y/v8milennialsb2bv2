#!/usr/bin/env bash
# Deploy do frontend Vite na VPS via build local + rsync.
# Ver diretiva: directives/deploy_hostinger_vps.md (Fluxo B)
# Variáveis no .env: VPS_HOST, VPS_USER, VPS_PATH, VPS_SSH_KEY (opcional)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Carregar .env (apenas variáveis VPS_* e as usadas no build)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

for var in VPS_HOST VPS_USER VPS_PATH; do
  if [[ -z "${!var}" ]]; then
    echo "Erro: defina $var no .env (ex.: VPS_HOST=ip.da.vps VPS_USER=root VPS_PATH=/var/www/html)"
    exit 1
  fi
done

echo "→ Build do frontend (npm run build)..."
npm run build

if [[ ! -d dist ]]; then
  echo "Erro: pasta dist/ não foi criada pelo build."
  exit 1
fi

RSYNC_OPTS=(-avz --delete)
if [[ -n "${VPS_SSH_KEY}" && -f "${VPS_SSH_KEY}" ]]; then
  RSYNC_OPTS+=(-e "ssh -i ${VPS_SSH_KEY} -o StrictHostKeyChecking=accept-new")
fi

echo "→ Enviando dist/ para ${VPS_USER}@${VPS_HOST}:${VPS_PATH} ..."
rsync "${RSYNC_OPTS[@]}" dist/ "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

echo "✓ Deploy concluído. Servidor: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "  Configure Nginx/Apache para servir o document root em ${VPS_PATH}."
