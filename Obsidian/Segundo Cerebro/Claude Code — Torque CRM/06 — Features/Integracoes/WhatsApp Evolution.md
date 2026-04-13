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

# WhatsApp Evolution

## O que faz

Integracao WhatsApp via Evolution API (open-source multidevice wrapper). QR code connect, envio/recebimento automatico, suporte a midia (texto, imagem, audio, video, documento).

## Regras de negocio

- API key nunca exposta no frontend (proxy via edge function)
- Webhook recebe: CONNECTION_UPDATE, QRCODE_UPDATED, MESSAGES_UPSERT, MESSAGES_UPDATE
- Copilot batch 8s (agrupa msgs antes de responder)
- Human takeover pausa bot por 10 min
- SmartSplitMessage para chunking natural de respostas longas
- TTS audio via ElevenLabs para agentes com voz

## Como o usuario usa

1. Configuracoes → WhatsApp
2. Cria instancia → escaneia QR code
3. Instancia conecta → mensagens fluem automaticamente
4. Copilot responde automaticamente (se configurado)

---

## Como funciona (tecnico)

### Bibliotecas

- `src/lib/evolutionApi.ts` — Client wrapper: testEvolutionConnection(), createInstance(), getConnectionState(), getQRCode(), sendMessage(), sendMedia(), disconnect(). Todas as chamadas via edge function proxy.

### Edge Functions

- `evolution-api-proxy` — Reverse proxy para Evolution API (mantem API key server-side)
- `evolution-webhook` — Webhook receiver: linka msgs a leads via phone, handles copilot batching (8s wait), TTS audio generation, human takeover detection (10min pause)

### Tabelas

- `whatsapp_instances` — instance_name, status, metadata (provider, copilot_agent_id), organization_id
- `channel_messages` — Storage unificado multi-canal
- `lead_evolution_metadata` — Link leads ↔ Evolution instances

---

## Historico de mudancas

## Links relacionados

- [[Chat WhatsApp]]
- [[Copilot]]
- [[SZ Chat]]
