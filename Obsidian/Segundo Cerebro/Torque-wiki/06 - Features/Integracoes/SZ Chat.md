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

# SZ Chat

## O que faz

Integracao SZ.Chat (Alamaster / Fortics) para chat multi-canal alternativo. Webhook receiver para mensagens de clientes e transferencias de atendimento. Suporta mesma logica de batch e human takeover do WhatsApp.

## Regras de negocio

- Mesma logica de batch 8s e human takeover 10 min do WhatsApp
- Auth token refresh automatico
- Team mappings configuraveis por org (6 equipes para Alamaster)
- Events: client_message, attendance_transfer, enter_queue, attendance_finish

## Como o usuario usa

Transparente - mensagens SZ.Chat aparecem no mesmo chat multi-canal do WhatsApp com badge diferente.

---

## Como funciona (tecnico)

### Edge Functions

- `sz-chat-webhook` - Recebe events (client_message, attendance_transfer, enter_queue, attendance_finish). Find/create lead by phone, store msg, batch copilot response (8s), check human takeover.
- `sz-chat-send` - Envia resposta via SZ.Chat API

### Tabelas

- `sz_chat_configs` - api_url, api_token, channel_id, whatsapp_instance_id, team_mappings JSONB, webhook_secret, is_active
- `sz_chat_sessions` - sz_chat_session_id, lead_id, phone_number, contact_name, status

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Webhooks]]

- [[Chat WhatsApp]]
- [[Copilot]]
- [[WhatsApp Evolution]]
