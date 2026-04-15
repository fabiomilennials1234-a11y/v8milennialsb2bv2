---
tags:
  - claude-code
  - feature
  - torque-crm
  - integracoes
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# n8n Orquestracao

## O que faz

n8n e o orquestrador principal de automacoes externas. 20+ workflows (um por cliente), fluxo tipico: Trello → n8n → CRM via lead-webhook. Bidirecional via webhooks.

## Regras de negocio

- n8n autentica via `x-webhook-key` no header
- Body parameters sao sempre strings (edge function normaliza)
- Tags aceita: array, JSON string `'["Ouro"]'`, ou string simples `"Ouro"`
- Busca de tags e case-insensitive
- `update_existing_if_match: true` atualiza lead existente (match por phone/email)

## Fluxo tipico (padrao para 20+ clientes)

1. Lead entra no Trello (Meta Ads → Make/Zapier → Trello card)
2. n8n monitora board Trello (`Trello Trigger`)
3. n8n extrai dados do card (nome, telefone, empresa, faturamento via regex no `desc`)
4. n8n classifica por faturamento → tag (Latao/Prata/Ouro/Diamante)
5. n8n envia POST para `lead-webhook` com campos + tags + pipe placement

## Payload lead-webhook

```json
{
  "source": "meta_ads",
  "organization_id": "uuid",
  "fields": { "name": "...", "phone": "...", "email": "...", "company": "..." },
  "tags": ["Ouro"],
  "place_in_pipe": { "pipe": "whatsapp", "stage": "novo_lead" },
  "assigned_user_id": "uuid",
  "update_existing_if_match": true
}
```

---

## Como funciona (tecnico)

### Edge Functions

- `lead-webhook` - Gateway principal. Recebe lead data + routing instructions. Retorna `{success, lead_id, pipe_records_created}`.

### Integracao bidirecional

- **n8n → CRM**: POST lead-webhook com x-webhook-key
- **CRM → n8n**: Webhook outgoing (lead.created, pipe_*.updated, etc.) - n8n subscribes via webhook endpoints

### Tabelas

- `webhooks` - n8n subscribes aqui para eventos do CRM
- `webhook_deliveries` - Historico de entregas
- `leads`, `pipe_whatsapp`, `campanha_leads` - Criados/atualizados pelo lead-webhook

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Campanhas]]

- [[Meta Facebook]]

- [[WhatsApp Evolution]]

- [[Webhooks]]
- [[Chat WhatsApp]]
- [[Pipe WhatsApp]]
