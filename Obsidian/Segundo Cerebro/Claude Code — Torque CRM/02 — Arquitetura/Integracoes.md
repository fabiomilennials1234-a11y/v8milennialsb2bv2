---
type: architecture
title: Integrações Externas
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [arquitetura, integracoes]
related: ["[[Visao Geral]]", "[[Webhooks Outbound]]"]
owner: gabriel
---

# Integrações Externas

> Diátaxis: **Explanation**.
> Para credenciais/env vars, ver [[Env Vars]].
> Para fluxos detalhados, ver `docs/architecture/03-data-flow.md`.

## Mapa

| Sistema | Direção | Função | Owner code |
|---|---|---|---|
| Uazapi | bidirecional | WhatsApp send/receive | `_shared/whatsapp-client.ts` |
| Meta (Ads + Messenger + IG) | inbound + outbound | Lead ingestion + multi-canal | `meta-*` edge functions |
| Google Calendar | bidirecional | Sync meetings | `google-calendar-*` |
| Google Gemini | outbound | LLM + embeddings | `_shared/gemini.ts` |
| TinyERP | bidirecional | Produtos + pedidos + NFe | `tiny-*` edge functions |
| Asaas | outbound + webhook | PIX + cards + subscriptions | `asaas-*` |
| n8n | inbound | Orquestração 20+ workflows | `lead-webhook` |
| SZ.Chat (Alamaster) | bidirecional | Multi-canal chat | `szchat-*` |
| ElevenLabs | outbound | TTS | `_shared/elevenlabs.ts` |
| Sentry | outbound | Error tracking | `_shared/sentry.ts` |

## Padrão geral

- Provider-agnostic via adapter quando possível (WhatsApp, Calendar)
- Webhook inbound: secret path + signature verification + DLQ
- Auth: per-tenant credentials em tabela dedicada (`*_secrets`) com RLS deny-all
- Rate limit: por org + por endpoint quando provider suporta
- Retry: exponential backoff + DLQ pra failures persistentes

(stub — expandir por integração conforme tasks tocam)
