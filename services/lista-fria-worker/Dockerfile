# Worker da Lista Fria. Contexto de build: a raiz do repo.
#   docker build -f services/lista-fria-worker/Dockerfile -t lista-fria-worker .
#
# Node 24 roda o TypeScript direto (type stripping) e traz fetch, dns e http. A ÚNICA dependência é o
# DuckDB (ler a base de CNPJ em Parquet, ADR-0043), fixada por versão exata no package-lock.
FROM node:24-slim
WORKDIR /app
COPY services/lista-fria-worker/package.json services/lista-fria-worker/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY services/lista-fria-worker/src ./src
ENV NODE_ENV=production
# A base de CNPJ (~0,4 GB) fica num volume: sobrevive a reinício e só baixa de novo quando muda.
ENV LISTA_FRIA_BASE_DIR=/data/base
RUN mkdir -p /data/base && chown -R node:node /data /app
USER node
# Saudável = o worker falou com o banco nos últimos 2 min (ver comPulso em src/main.ts). Start period largo:
# no primeiro boot ele baixa a base de CNPJ (~450 MB) antes de começar a pulsar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD node -e "const s=require('fs').statSync(process.env.WORKER_PULSO||'/tmp/worker-vivo');process.exit(Date.now()-s.mtimeMs<90000?0:1)"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
