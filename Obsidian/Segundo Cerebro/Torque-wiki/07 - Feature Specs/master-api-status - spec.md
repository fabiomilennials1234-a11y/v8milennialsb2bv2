---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/master-api-status/spec.md
---

# Master API Status - Aba em MasterOperations

## Problema

Não há visibilidade centralizada sobre o status das APIs externas que o sistema depende. Quando algo falha (Gemini fora, Evolution caiu, OpenRouter com rate limit), o time descobre pelos sintomas, não por um painel.

## Solução

Nova aba "APIs" em MasterOperations que mostra status em tempo real de todas as APIs globais do sistema. Uma edge function `check-api-health` faz health check em cada serviço e retorna o status.

## APIs a Monitorar

| API | Health Check | Como verificar |
|-----|-------------|----------------|
| **Evolution API** | `GET /info` | 200 = ok |
| **OpenRouter** | `GET /api/v1/models` com auth | 200 = ok |
| **Gemini** | `POST embedContent` com texto mínimo | embedding retornado = ok |
| **OpenAI** | `GET /v1/models` com auth | 200 = ok |
| **Asaas** | `GET /v3/myAccount` com auth | 200 = ok |
| **Supabase** | Já conectado - self-check via RPC | sempre ok se a page carrega |
| **Sentry** | Verificar se DSN está configurado | env var existe = ok |
| **Meta** | Verificar se App ID está configurado | env var existe = ok |

## Requisitos

### REQ-01: Edge Function `check-api-health`

- Recebe: nada (ou `{ services?: string[] }` para check seletivo)
- Retorna: array de `{ service, status, latency_ms, error?, checked_at }`
- Status: `"connected"` | `"error"` | `"not_configured"`
- Cada check tem timeout de 5s
- Todos os checks rodam em paralelo (Promise.allSettled)
- Requer auth de master admin (JWT check)

### REQ-02: Aba "APIs" em MasterOperations

- Nova aba no TabsList existente
- Grid de cards, um por API
- Cada card mostra: nome, ícone, status (badge colorido), latência, último check
- Status colors: verde = connected, vermelho = error, cinza = not_configured
- Botão "Verificar Agora" que re-executa todos os checks
- Auto-refresh a cada 60 segundos
- Loading skeleton durante o check

### REQ-03: Dados exibidos por card

```
┌──────────────────────────────┐
│ 🟢  Evolution API            │
│ Latência: 142ms              │
│ Último check: agora          │
│                              │
│ Status: Conectado            │
└──────────────────────────────┘
```

Se erro:
```
┌──────────────────────────────┐
│ 🔴  OpenRouter               │
│ Erro: 401 Unauthorized       │
│ Último check: 30s atrás      │
│                              │
│ Status: Erro                 │
└──────────────────────────────┘
```

## Fora de Escopo

- Histórico de uptime
- Alertas/notificaçoes
- Status por organização
- Health check de webhook endpoints

## Arquivos Impactados

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/check-api-health/index.ts` | Nova edge function |
| `src/pages/master/MasterOperations.tsx` | Nova aba "APIs" |
| `src/components/master/ApiStatusTab.tsx` | Novo componente da aba |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Master Admin]]

- [[Webhooks]]

- [[OpenRouter Setup]]

- [[Asaas Pagamentos]]

- [[WhatsApp Evolution]]

- [[00 - INDEX]]
- [[Visao Geral]]
