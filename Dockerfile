# ============================================
# Deploy Vite + React (v8milennialsb2b) - Hostinger VPS
# Build multi-stage: Node para build, Nginx para servir
# ============================================

# ---- Stage 1: Build ----
FROM node:20-alpine AS builder

WORKDIR /app

# Dependências (cache melhor se package*.json não mudar)
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Variáveis de build do Vite (VITE_*). Passadas no docker build ou em docker-compose.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ARG VITE_CALENDAR_SERVICE_URL
ARG VITE_INVITE_API_URL
ARG VITE_INTERNAL_API_KEY

ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    VITE_SUPABASE_PROJECT_ID=${VITE_SUPABASE_PROJECT_ID} \
    VITE_CALENDAR_SERVICE_URL=${VITE_CALENDAR_SERVICE_URL} \
    VITE_INVITE_API_URL=${VITE_INVITE_API_URL} \
    VITE_INTERNAL_API_KEY=${VITE_INTERNAL_API_KEY}

RUN npm run build

# ---- Stage 2: Serve com Nginx ----
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA + headers de segurança (prioridade conforme regras do projeto)
RUN echo 'server { \
  listen 80; \
  root /usr/share/nginx/html; \
  index index.html; \
  add_header X-Content-Type-Options "nosniff" always; \
  add_header X-Frame-Options "DENY" always; \
  add_header X-XSS-Protection "1; mode=block" always; \
  add_header Referrer-Policy "strict-origin-when-cross-origin" always; \
  location / { try_files $uri $uri/ /index.html; } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
