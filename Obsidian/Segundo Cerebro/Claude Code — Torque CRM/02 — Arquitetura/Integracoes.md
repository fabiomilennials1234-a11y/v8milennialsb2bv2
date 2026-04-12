---
tags:
  - claude-code
  - arquitetura
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Integracoes Externas

## Resumo

O Torque CRM integra com 9+ servicos externos. Cada integracao tem edge functions dedicadas, webhooks de entrada e/ou APIs de saida. O n8n atua como orquestrador principal para fluxos de clientes.

## Mapa de integracoes

### Evolution API (WhatsApp)

- **Proposito**: Envio e recebimento de mensagens WhatsApp
- **Tipo**: Bidirecional (webhook in + API out)
- **Edge functions**: `evolution-webhook`, `evolution-api-proxy`
- **Frontend**: `src/lib/evolutionApi.ts` (chamadas via proxy)
- **Fluxo**: Evolution → `evolution-webhook` → `channel_messages` → realtime → UI
- **Seguranca**: API key nunca exposta no frontend (proxy via edge function)

### Meta / Facebook

- **Proposito**: Messenger, Instagram DM, Lead Ads
- **Tipo**: Bidirecional
- **Edge functions**: `meta-webhook`, `meta-oauth-callback`, `send-meta-message`, `refresh-meta-tokens`, `meta-ads-insights`
- **Shared**: `_shared/meta-api.ts`
- **Cron**: `refresh-meta-tokens` (diario 2AM) — renova tokens de longa duracao
- **Fluxo**: Meta → `meta-webhook` → `channel_messages` → realtime → UI

### Google Calendar

- **Proposito**: Sincronizacao de eventos, agendamento de reunioes
- **Tipo**: Bidirecional (OAuth 2.0)
- **Edge functions**: `google-calendar-connect`, `google-calendar-disconnect`, `google-calendar-events`, `google-calendar-callback`, `google-calendar-webhook`, `google-calendar-sharing`
- **Microservico separado**: `services/google-calendar-service/` (Python + Docker)
- **Shared**: `_shared/google-calendar-utils.ts`
- **Tabela**: `google_calendar_connections`

### TinyERP

- **Proposito**: Sincronizacao de produtos, pedidos, NFe
- **Tipo**: Bidirecional
- **Edge functions**: `tinyerp-connect`, `tinyerp-disconnect`, `tinyerp-proxy`, `tinyerp-sync-products`, `tinyerp-push-order`, `tinyerp-push-upsell-order`, `tinyerp-fetch-nfe`, `tinyerp-webhook`
- **Shared**: `_shared/tinyerp-utils.ts`
- **Tabela**: `products` (sync)

### Asaas (Pagamentos)

- **Proposito**: Cobrancas, assinaturas, checkout
- **Tipo**: Webhook in + API out
- **Edge functions**: `asaas-webhook`, `checkout-create-payment`
- **Shared**: `_shared/asaas.ts`
- **Tabela**: `subscription_plans`, `organization_payments`

### n8n (Orquestracao)

- **Proposito**: Automacao de fluxos de clientes (Trello → CRM)
- **Tipo**: n8n → `lead-webhook` (HTTP POST)
- **Padrao**: 20+ workflows n8n, um por cliente
- **Fluxo tipico**:
  1. Lead entra no Trello (Meta Ads → Make/Zapier → Trello card)
  2. n8n monitora board Trello (`Trello Trigger`)
  3. n8n extrai dados do card (regex no `desc`)
  4. n8n classifica por faturamento → tag (Latao/Prata/Ouro/Diamante)
  5. n8n envia POST para `lead-webhook` com campos + tags + pipe placement

### SZ.Chat (Fortics)

- **Proposito**: Chat multi-canal alternativo ao WhatsApp Para uma unica organização em especifico. a ALAMASTER.
- **Tipo**: Bidirecional
- **Edge functions**: `sz-chat-send`, `sz-chat-webhook`
- **Referencia**: Channel ID Alamaster, 6 equipes configuradas

### ElevenLabs (TTS)

- **Proposito**: Text-to-speech para agentes Copilot
- **Tipo**: API out
- **Edge functions**: `elevenlabs-proxy`
- **Shared**: `_shared/tts-elevenlabs.ts`

### Sentry (Monitoring)

- **Proposito**: Error tracking e monitoring
- **Tipo**: SDK integrado (frontend + edge functions)
- **Frontend**: `@sentry/react` + `@sentry/vite-plugin` (source maps)
- **Backend**: `_shared/sentry.ts` (wrapper `withSentry`)
- **Config**: Source maps em producao e dev

### Google Gemini (IA)

- **Proposito**: Embeddings (1536d) + RAG via pgvector
- **Tipo**: API out (dentro de edge functions)
- **Shared**: `_shared/embeddings.ts`
- **Uso**: FAQs, business context, qualificacao de leads, oraculo comercial

## Webhook de entrada principal — lead-webhook

```json
{
  "source": "meta_ads",
  "organization_id": "uuid",
  "fields": {
    "name": "...",
    "phone": "...",
    "email": "...",
    "company": "..."
  },
  "tags": ["Ouro"],
  "place_in_pipe": {
    "pipe": "whatsapp",
    "stage": "novo_lead"
  },
  "assigned_user_id": "uuid",
  "update_existing_if_match": true
}
```

Tags aceita: array, string JSON `'["Ouro"]'`, ou string simples `"Ouro"`. Busca case-insensitive.

## Fluxo de dados geral

```
Entrada externa (n8n/webhook/Meta/WhatsApp)
  → Edge Function (validacao + normalizacao)
    → Postgres (RLS por org_id)
      → Realtime (postgres_changes)
        → React Query (invalidate + refetch)
          → UI (kanban/lista/chat)
```

## Links relacionados

- [[Visao Geral]]
- [[Modulos]]
- [[Fluxos de Trabalho]]
- [[00 — INDEX]]

## Notas do agente

> Fonte: `supabase/functions/`, `_shared/`, `src/lib/`, `CLAUDE.md`.
> A integracao com Cal.com (`webhook-calcom`) existe mas nao esta documentada no CLAUDE.md — pode ser experimental ou deprecada.
