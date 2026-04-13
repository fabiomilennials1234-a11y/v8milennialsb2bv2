---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Webhooks

## O que faz

Registro de webhooks outgoing que disparam em eventos do CRM (lead.created, lead.updated, pipe_*.updated, follow_up.completed, whatsapp_message.received). Test manual, retry de falhas, historico de deliveries.

## Regras de negocio

- Cada webhook tem event filter, URL, method, custom headers
- Delivery queue processada por cron (1 min, batch 100)
- Retry automatico em falha
- Dead letter queue com retry-dead-letter-jobs (cron 5 min)
- Webhook test envia payload de exemplo

## Como o usuario usa

1. Configuracoes → Webhooks
2. Criar webhook: URL, method, event, headers
3. Testar com payload de exemplo
4. Ver historico de deliveries com status
5. Retry manual de falhas

---

## Como funciona (tecnico)

### Componentes

- `src/components/settings/WebhookSettings.tsx` — CRUD, test, delivery history

### Hooks

- `useWebhooks()` / `useCreateWebhook()` / `useUpdateWebhook()` / `useDeleteWebhook()`

### Edge Functions

- `process-webhook-deliveries` — Cron 1 min, batch 100. Processa fila de deliveries pendentes.
- `webhook-send-test` — Envia payload de teste
- `webhook-validate-url` — Valida URL do webhook
- `retry-dead-letter-jobs` — Cron 5 min, retenta jobs falhos

### Shared

- `_shared/webhook-utils.ts` — Utilitarios

### Tabelas

- `webhooks` — event, url, method, headers JSONB, is_active, organization_id
- `webhook_deliveries` — webhook_id, event, payload JSONB, status, http_status, response, retried_at

---

## Historico de mudancas

## Links relacionados

- [[n8n Orquestracao]]
- [[Configuracoes]]
- [[API Docs]]
