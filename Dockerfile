# ============================================
# Deploy Vite + React (v8milennialsb2b) - Hostinger VPS
# Build multi-stage: Node para build, Nginx para servir
# ============================================

# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Dependências (npm install tolera lock file desatualizado; use npm ci após atualizar package-lock.json)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Variáveis de build do Vite (VITE_*). Passadas no docker build ou em docker-compose.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_CALENDAR_SERVICE_URL
ARG VITE_INVITE_API_URL
ARG VITE_META_APP_ID
ARG VITE_META_WA_CONFIG_ID
ARG VITE_APP_VERSION
# Sentry (ADR-0038, S6). O DSN é público por desenho (vai no bundle de qualquer
# jeito), então o do projeto `torque-web` (org EU) é o padrão: a imagem de
# produção nasce com o Sentry ligado sem depender de build arg no EasyPanel.
# Para desligar, passe VITE_SENTRY_DSN vazio no build. O DSN só aceita eventos
# de torquecrm.com.br (Allowed Domains) e tem teto de 200/h.
ARG VITE_SENTRY_DSN=https://e85f15eeea72098a71636681f0574932@o4512181312946176.ingest.de.sentry.io/4512181365702736
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_REPLAY_ON_ERROR_RATE
# Upload de source map. Só ARG, NUNCA ENV: vive só neste estágio, que não vai
# para a imagem servida. Use token de ORGANIZAÇÃO (escopo org:ci — só sobe map e
# cria release), nunca token pessoal. Sem token, o build segue sem upload.
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG=torquecrm
ARG SENTRY_PROJECT=torque-web
ARG SENTRY_URL=https://de.sentry.io
# Feature flags
ARG VITE_CHAT_ONDA_2B=true
ARG VITE_CHAT_BUBBLE=true
# Interface nova (V5) ou clássica, por organização: a guarda das duas builds só
# troca quando este é "true" (docs/ui-v5/interface-por-organizacao.md).
ARG VITE_UI_SWITCH=true

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID} \
    VITE_CALENDAR_SERVICE_URL=${VITE_CALENDAR_SERVICE_URL} \
    VITE_INVITE_API_URL=${VITE_INVITE_API_URL} \
    VITE_META_APP_ID=${VITE_META_APP_ID} \
    VITE_META_WA_CONFIG_ID=${VITE_META_WA_CONFIG_ID} \
    VITE_APP_VERSION=${VITE_APP_VERSION} \
    VITE_SENTRY_DSN=${VITE_SENTRY_DSN} \
    VITE_SENTRY_ENVIRONMENT=${VITE_SENTRY_ENVIRONMENT} \
    VITE_SENTRY_REPLAY_ON_ERROR_RATE=${VITE_SENTRY_REPLAY_ON_ERROR_RATE} \
    VITE_CHAT_ONDA_2B=${VITE_CHAT_ONDA_2B} \
    VITE_CHAT_BUBBLE=${VITE_CHAT_BUBBLE} \
    VITE_UI_SWITCH=${VITE_UI_SWITCH}

# Duas builds no mesmo dist/: V5 (src/) e clássica (classic/), mescladas por
# scripts/ui-classic/merge-dist.mjs. O nginx abaixo escolhe pelo cookie.
RUN npm run build:dual

# ---- Stage 2: Serve com Nginx ----
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Source map não vai para a imagem servida. Até 2026-09-30 o nginx entregava
# `/assets/*.js.map` (7,3 MB: o código-fonte inteiro, com comentários) para
# qualquer um. O `location` de /assets/ continua casando `.map`, mas o
# `try_files $uri =404` agora devolve 404 porque o arquivo não existe.
# O map continua nascendo no build (`sourcemap: 'hidden'`) para ser enviado ao
# Sentry no estágio builder — ver docs/adr/0038.
RUN find /usr/share/nginx/html -type f -name '*.map' -exec rm -f {} \;

# SPA + headers de segurança + cache estratégico.
# Assets hashados (Vite gera /assets/xxx-HASH.{js,css}) ficam 1 ano immutable.
# index.html NUNCA é cacheado — garante que deploy novo invalide chunks antigos.
# Security headers shared across all location blocks (nginx add_header does NOT inherit)
RUN printf '%s\n' \
  'add_header X-Content-Type-Options "nosniff" always;' \
  'add_header X-Frame-Options "DENY" always;' \
  'add_header X-XSS-Protection "1; mode=block" always;' \
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;' \
  'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' \
  'add_header Permissions-Policy "geolocation=(), payment=()" always;' \
  "add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co https://connect.facebook.net; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in https://generativelanguage.googleapis.com https://*.sentry.io https://openrouter.ai https://graph.facebook.com https://www.facebook.com https://fonts.googleapis.com https://calls.torquecrm.com.br; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; media-src 'self' blob: https:; frame-src 'self' https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com https://connect.facebook.net; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self';\" always;" \
  > /etc/nginx/security-headers.conf && \
printf '%s\n' \
  '# Landing pages estáticas em /lp/ (public/lp/v1, v2, v3): CSP própria, mais permissiva' \
  '# que a do app — GSAP/Tailwind via CDN, Cal.com embutido, formulário → webhook n8n,' \
  '# fontes Google e VSL hospedada fora. Não afeta as rotas do SPA.' \
  'add_header X-Content-Type-Options "nosniff" always;' \
  'add_header X-Frame-Options "DENY" always;' \
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;' \
  'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;' \
  'add_header Permissions-Policy "geolocation=(), payment=()" always;' \
  "add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.tailwindcss.com https://app.cal.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' blob: https:; connect-src 'self' https://n8nwebhook.v3l8jq.easypanel.host https://app.cal.com https://cal.com; frame-src https://app.cal.com https://cal.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self';\" always;" \
  > /etc/nginx/lp-headers.conf && \
printf '%s\n' \
  '# Interface por organização: o cookie `torque_ui` (gravado pela guarda do app' \
  '# a partir de organizations.ui_v5_enabled) escolhe o index.html e o sw.js.' \
  '# Sem cookie = clássica, que é o que todo mundo usava antes. Os assets são a' \
  '# união das duas builds (nomes com hash), então não dependem do cookie.' \
  'map $cookie_torque_ui $ui_index {' \
  '  default /index.classic.html;' \
  '  v5      /index.html;' \
  '}' \
  'map $cookie_torque_ui $ui_sw {' \
  '  default /sw.classic.js;' \
  '  v5      /sw.js;' \
  '}' \
  'server {' \
  '  listen 8080;' \
  '  server_tokens off;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  include /etc/nginx/security-headers.conf;' \
  '  location ~ /\. { return 404; }' \
  '  # API REST pública v1 — proxy transparente p/ a edge function `api` do Supabase.' \
  '  # URL limpa: torquecrm.com.br/api/v1/* -> .../functions/v1/api/v1/* (Supabase corta' \
  '  # o prefixo /functions/v1, entao a function ve /api/v1/* e casa o router). Auth e' \
  '  # scoping por X-API-Key (validada pela function); qualquer origem/cliente com key valida.' \
  '  location ^~ /api/v1/ {' \
  '    proxy_pass https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/api/v1/;' \
  '    proxy_ssl_server_name on;' \
  '    proxy_set_header Host jsjsmuncfkbsbzqzqhfq.supabase.co;' \
  '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
  '    proxy_set_header X-Forwarded-Proto $scheme;' \
  '    proxy_read_timeout 30s;' \
  '  }' \
  '  location ~* ^/assets/.*\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|map)$ {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "public, max-age=31536000, immutable" always;' \
  '    try_files $uri =404;' \
  '  }' \
  '  # Landing pages do Torque: torquecrm.com.br/lp/v1/, /lp/v2/, /lp/v3/ (estáticas, public/lp).' \
  '  # `^~` vence o regex de /assets/ e o fallback do SPA; sem index.html no caminho → 404.' \
  '  # Os HTML das LPs fazem cache-busting com ?v= nos css/js, então cache curto basta.' \
  '  location ^~ /lp/ {' \
  '    include /etc/nginx/lp-headers.conf;' \
  '    add_header Cache-Control "public, max-age=600, must-revalidate" always;' \
  '    try_files $uri $uri/ =404;' \
  '  }' \
  '  location = /sobre {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files /sobre.html =404;' \
  '  }' \
  '  location = /privacidade {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files /privacidade.html =404;' \
  '  }' \
  '  location = / {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files $ui_index =404;' \
  '  }' \
  '  location = /index.html {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files $ui_index =404;' \
  '  }' \
  '  # O service worker precisa ser o da build servida: ele precacheia o index' \
  '  # e os assets dela. Mesmo caminho (/sw.js) para o escopo continuar sendo /.' \
  '  location = /sw.js {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files $ui_sw =404;' \
  '  }' \
  '  location / {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files $uri $uri/ $ui_index;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
