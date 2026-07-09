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
# Feature flags
ARG VITE_CHAT_ONDA_2B=true
ARG VITE_CHAT_BUBBLE=true

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID} \
    VITE_CALENDAR_SERVICE_URL=${VITE_CALENDAR_SERVICE_URL} \
    VITE_INVITE_API_URL=${VITE_INVITE_API_URL} \
    VITE_META_APP_ID=${VITE_META_APP_ID} \
    VITE_META_WA_CONFIG_ID=${VITE_META_WA_CONFIG_ID} \
    VITE_APP_VERSION=${VITE_APP_VERSION} \
    VITE_CHAT_ONDA_2B=${VITE_CHAT_ONDA_2B} \
    VITE_CHAT_BUBBLE=${VITE_CHAT_BUBBLE}

RUN npm run build

# ---- Stage 2: Serve com Nginx ----
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

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
  "add_header Content-Security-Policy \"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co https://connect.facebook.net; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.supabase.in https://generativelanguage.googleapis.com https://*.sentry.io https://openrouter.ai https://graph.facebook.com https://www.facebook.com; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; media-src 'self' blob: https:; frame-src 'self' https://www.facebook.com https://web.facebook.com https://staticxx.facebook.com https://connect.facebook.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self';\" always;" \
  > /etc/nginx/security-headers.conf && \
printf '%s\n' \
  'server {' \
  '  listen 8080;' \
  '  server_tokens off;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  include /etc/nginx/security-headers.conf;' \
  '  location ~ /\. { return 404; }' \
  '  location ~* ^/assets/.*\.(js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|webp|ico|map)$ {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "public, max-age=31536000, immutable" always;' \
  '    try_files $uri =404;' \
  '  }' \
  '  location = / {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files /index.html =404;' \
  '  }' \
  '  location = /index.html {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '  }' \
  '  location / {' \
  '    include /etc/nginx/security-headers.conf;' \
  '    add_header Cache-Control "no-store, must-revalidate" always;' \
  '    try_files $uri $uri/ /index.html;' \
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
