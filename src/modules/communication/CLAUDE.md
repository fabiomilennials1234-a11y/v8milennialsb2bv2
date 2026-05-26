# Module — communication

**Status:** 🟡 Skeleton (slice 6 popula)
**BC:** communication
**Entidade primária:** Conversation + Message + Instance + Message Gateway
**Owner:** vendas + ops

## Escopo

Multi-canal de mensagens. Canais ativos:
- **WhatsApp** (Uazapi — migração de Evolution concluída)
- **Meta** (Messenger + Instagram Direct)
- **SZ.Chat** (canal experimental)

Inclui:
- Chat UI por canal (composer, bubble, context panel)
- Conversations + Messages (CRUD + realtime)
- Instance management (1 instance por org, allowlist quem pode escrever)
- Message gateway (humanização, chunking, dedup)
- Mass send (slice paralelo `campaigns/mass-send`)
- History sync (importar histórico Uazapi)
- Mockups (dev tools — auditar pra deletar)

## Não-escopo

- Copilot/agente IA que responde → `copilot`
- Workflows que enviam mensagem como action → `workflows` (delega pra `MessageSender` deste módulo)
- Templates de mensagem (cross-cutting) → `platform`?

## API pública (`index.ts`) — TBD slice 6

Provável superfície:
- Hooks: `useWhatsAppChat`, `useWhatsAppConversations`, `useWhatsAppInstances`, `useConversationDraft`, `useMessageActions`, `useChatBubble`, `useScheduledMessages`
- Components: `<ChatShell>`, `<MessageBubble>`, `<ChatComposer>`, `<ContextPanel>`
- Types: `Conversation`, `Message`, `Instance`, `Channel`
- Eventos (post slice 19): `message.received`, `message.sent`, `conversation.read`, `instance.session_died`

## Áreas frágeis

🔴 **Área frágil declarada em CLAUDE.md raiz.**

- Provider-agnostic via adapter (`_shared/whatsapp-client.ts` + `whatsapp-providers/`)
- Features Uazapi-only: sendMenu, sendPixButton, react/edit/pin/deleteForAll/markRead, historySync, `/sender/*`
- Kill-switch: `organizations.whatsapp_provider_override`
- Janela 24h Meta: composer disable se `now - last_inbound_at > 24h`
- RLS strict em `whatsapp_instance_secrets` (deny-all)
- Realtime onUpdate: só campos alterados, sem joins

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/chat/` (WhatsApp)
- `src/components/chat-meta/` (Meta)
- `src/hooks/chat/` (subpasta existente)
- `src/hooks/chat-meta/` (subpasta existente)
- `src/hooks/useWhatsApp*.ts` (10 hooks)
- `src/hooks/useChatBubble.ts`, `useChatBubbleState.ts`
- `src/hooks/useConversation*.ts`, `useMessage*.ts`, `useIncomingMessageToast.ts`, `useScheduledMessages.ts`
- `src/hooks/useDeadSessions.ts`, `useHistorySyncJobs.ts`
- `src/hooks/useMetaConnection.ts`
- `src/hooks/useLeadWriteInstance.ts`, `usePreferredInstance.ts`, `useUserWriteInstanceFlag.ts`
- `src/lib/whatsappApi.ts`, `whatsapp.ts`
- `src/pages/ChatWhatsApp.tsx`, `AtendimentoMeta.tsx`, `MockupChat*.tsx`
- `src/components/whatsapp/`, `whatsapp-migration/`

Backend:
- `supabase/functions/whatsapp-*` (7 functions: api-proxy, dlq-replay, health-monitor, media-retry, rebind-webhook, session-watchdog, webhook)
- `supabase/functions/meta-webhook/`, `send-meta-message/`, `meta-conversation-profile/`, `process-meta-messages/`
- `supabase/functions/sz-chat-send/`, `sz-chat-webhook/`
- `supabase/functions/history-sync-worker/`
- `supabase/functions/stream-media/`, `summarize-conversation/`
- `supabase/functions/_shared/whatsapp-client.ts`, `whatsapp-dispatch.ts`, `whatsapp-media.ts`, `whatsapp-providers/`, `uazapi-client.ts`, `uazapi-types.ts`
- `supabase/functions/_shared/message-gateway.ts`, `outbound-sender.ts`, `followup-sender.ts`, `audio-sender.ts`, `dispatch-router.ts`, `natural-messaging.ts`, `greeting-orchestrator.ts`, `message-humanizer.ts`, `message-sanitizer.ts`, `message-classifier.ts`, `send-dedup.ts`

## Slice de migração

**Slice 6** — `feat/modularizacao/05-communication` (7h + 1h dedup = 8h)

## Dedup pendente

- 3 hooks realtime → manter só `useRealtimeSubscription` (canonical)
- 12 módulos message-stack em `_shared/` → consolidar em `_shared/communication/{send,humanize,classify,dedup}/`
- Pages `MockupChat*` × 4 (incluindo file corrupto `MockupChatV3 2.tsx`) → decisão CTO

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- WhatsApp stability: `Obsidian/.../06 — Features/Chat/whatsapp-stability-plan.md`
- Chat bubble: `Obsidian/.../06 — Features/Chat/chat-bubble.md`
- Meta chat: `Obsidian/.../02 — Arquitetura/Modulos/atendimento-meta.md`
- Sub-CLAUDE.md raiz: `supabase/functions/whatsapp-webhook/CLAUDE.md`
