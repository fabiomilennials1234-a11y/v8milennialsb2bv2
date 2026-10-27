# Worker da Lista Fria. Contexto de build: a raiz do repo.
#   docker build -f services/lista-fria-worker/Dockerfile -t lista-fria-worker .
#
# Sem dependências npm: Node 24 roda o TypeScript direto (type stripping) e traz
# fetch, dns e http. Nada para instalar, nada para auditar.
FROM node:24-slim
WORKDIR /app
COPY services/lista-fria-worker/src ./src
ENV NODE_ENV=production
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
