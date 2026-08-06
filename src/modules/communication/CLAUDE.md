# Module — communication

**Status:** 🟢 Active (slice 6 + cleanup longtail slice 16 — 2026-05-28)
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
- Mass send via Uazapi `/sender/*` (frontend — backend continua em `supabase/functions/`)
- History sync (importar histórico Uazapi)
- Scheduled messages
- Chat bubble (kanban floating chat)

## Não-escopo

- Copilot/agente IA que responde → `copilot`
- Workflows que enviam mensagem como action → `workflows` (delega pra `MessageSender` deste módulo)
- Templates de mensagem (`useMessageTemplates`) — vivem aqui mas são reusados cross-module (workflows, campaigns); a entidade `message_templates` está no domínio communication
- Backend (edge functions + `_shared/`) → slice 15 (`whatsapp-*`, `meta-*`, `sz-chat-*`, `history-sync-worker`) e slice 16 (`_shared/whatsapp-client.ts`, `_shared/message-*`, `_shared/whatsapp-providers/`)

## Estrutura

```
src/modules/communication/
├── components/
│   ├── chat/                      # WhatsApp UI (actions, admin, bubble, composer, context-panel, history-sync, layout, list, media, search, takeover, view + barrel index.ts)
│   ├── chat-meta/                 # Meta Messenger/Instagram UI
│   ├── whatsapp/                  # SessionDeadBanner (lifecycle alerts)
│   └── whatsapp-migration/        # Evolution→Uazapi RepairingWizard (banner órfão deletado 2026-07-02)
├── hooks/
│   ├── chat/                      # WhatsApp-specific hooks (instances, contacts, messages, send, realtime, sz-chat) + shared/queryKeys
│   ├── chat-meta/                 # Meta hooks (pages, conversations, messages, send, realtime, link-lead)
│   ├── useWhatsAppChat.ts         # Barrel + Uazapi message actions + history-sync + mass-send re-exports
│   ├── useWhatsAppConversations.ts
│   ├── useWhatsAppFunnel.ts
│   ├── useWhatsAppInstanceAllowedMembers.ts
│   ├── useWhatsAppInstances.ts
│   ├── useWhatsAppLeadIntegration.ts
│   ├── useOrgWhatsAppMigration.ts
│   ├── useConversationDraft.ts
│   ├── useConversationHistory.ts
│   ├── useConversationNotes.ts
│   ├── useChatBubble.ts / useChatBubbleState.ts
│   ├── useMessageActions.ts       # react/edit/pin/delete/markRead/downloadMedia (Uazapi)
│   ├── useMessageLimits.ts
│   ├── useMessageTemplates.ts
│   ├── useMetaConnection.ts
│   ├── useScheduledMessages.ts
│   ├── useHistorySyncJobs.ts
│   ├── useDeadSessions.ts
│   ├── useIncomingMessageToast.ts
│   ├── usePreferredInstance.ts
│   └── useUserWriteInstanceFlag.ts
├── lib/
│   ├── whatsappApi.ts             # Low-level HTTP client (Uazapi REST)
│   ├── whatsapp.ts                # High-level send helpers
│   ├── chat-types.ts              # Shared chat types
│   ├── primaryInstanceFor.ts      # Instance selection logic
│   ├── computeNeedsDeepLinkResolve.ts
│   ├── audioToMp3.ts              # Media transcode (browser-side)
│   └── chatPrefetch.ts            # Route prefetch helpers
├── pages/
│   ├── ChatWhatsApp.tsx
│   ├── AtendimentoMeta.tsx
│   └── MessageTemplates.tsx       # (slice 16)
├── index.ts                       # API pública
└── CLAUDE.md                      # este arquivo
```

## API pública (`index.ts`)

Superfície completa em `./index.ts`. Resumo:

**Hooks WhatsApp (chat):** `useWhatsAppInstancesForUser`, `useActiveWhatsAppInstance`, `useWhatsAppContacts`, `useWhatsAppMessages`, `useSendWhatsAppMessage`, `useSendWhatsAppMedia`, `useFailedMessages`, `useRetryMessage`, `useWhatsAppMessagesRealtime`, `useTransferToSzChatDepartment`, `useActiveSzChatSession`, `useReactMessage`, `useEditMessage`, `usePinMessage`, `useDeleteMessage`, `useMarkMessageRead`, `useDownloadMedia`, `useHistorySyncJobs`, `useCreateHistorySyncJob`, `useControlHistorySyncJob`, `useMassSend*`, `useWhatsAppConversationsMeta`, `useArchive/Unarchive/DeleteConversation`, `useAdd/RemoveConversationTag`, `useWhatsAppFunnel`, `useWhatsAppLeadIntegration`.

**Hooks WhatsApp (instance):** `useWhatsAppInstances`, `useWhatsAppInstancesWithAgent`, `useCreate/Update/Delete/LogoutWhatsAppInstance`, `useRefreshQRCode`, `useCheckConnectionStatus`, `useWhatsAppInstanceAllowedMembers`, `usePreferredInstance`, `useUserWriteInstanceFlag`, `useOrgWhatsAppMigration`.

**Hooks composer / drafts / bubble:** `useConversationDraft`, `useConversationNotes`, `useConversationHistory`, `useChatBubble`, `useChatBubbleState`.

**Hooks messaging utilities:** `useScheduled*Messages*`, `useMessageLimits`, `useMessageTemplates`, `useCreate/Update/DeleteMessageTemplate`, `useIncomingMessageToast`, `useDeadSessions`.

**Hooks Meta:** `useMetaConnection`, `useMetaPages`, `useMetaConversations`, `useMetaConversationProfile`, `useMetaMessages`, `useMetaSend`, `useMetaMarkAsRead`, `useMetaLinkLead`, `useMetaRealtime`.

**E-mail / SMS / AI email writer — REMOVIDOS em 2026-08-06.** Eram 9 arquivos (~1.330 linhas) chamando as edge functions `send-email`, `send-sms` e `generate-ai-email-draft`, que **nunca existiram** — nem no repo, nem deployadas no PROD (conferido contra as 150 funções vivas). As 7 tabelas (`emails`, `email_accounts`, `email_templates`, `ai_email_drafts`, `sms_messages`, `sms_templates`, `sms_provider_config`) seguem com 0 linhas e **não foram dropadas**: `emails.deal_id`/`contact_id` são da mesma onda de roadmap que `deals`/`contacts` (épico SCRUM-43).

**Components:** `ChatShellWithContext`, `ChatSkeleton`, `MessageBubble`, `MessagesAreaErrorBoundary`, `AudioPlayer`, `AudioRecorder`, `ImagePreviewModal`, `MessageImage/Video/Document`, `ChatEmptyState`, `ScrollToBottomFab`, `UnreadDivider`, `ScheduledMessagesBanner`, `ScheduleMessageModal`, `ConversationNotes`, `LeadContactModal`, `HumanPauseBadge`, `ChannelBadge`, `RealtimeStatusBadge`; Meta: `MetaChatShell`, `MetaChatHeader`, `MetaConversationList(Item)`, `MetaMessage{List,Bubble}`, `MetaComposer`, `MetaWindowWarning`, `LinkLeadDialog`, `ChatMetaSkeleton`; WhatsApp lifecycle: `SessionDeadBanner`, `RepairingWizard`.

**Lib:** `whatsappApi` (namespace export), `primaryInstanceFor`, `computeNeedsDeepLinkResolve`, `prefetchChatRoute`, `prefetchChatData`.

**Types:** `WhatsAppInstance`, `WhatsAppMessage`, `FailedMessage`, `ChatContact`, `MessageTemplate`, `ScheduledMessage`, `HistorySyncJob`, `MetaConversation`, `MetaPage`, `MetaChannel`, etc.

## Áreas frágeis

🔴 **Área frágil declarada em CLAUDE.md raiz.**

- Provider-agnostic via adapter (`_shared/whatsapp-client.ts` + `whatsapp-providers/`) — **continua em `_shared/` até slice 16**
- Features Uazapi-only: sendMenu, sendPixButton, react/edit/pin/deleteForAll/markRead, historySync, `/sender/*`
- Kill-switch: `organizations.whatsapp_provider_override`
- Janela 24h Meta: composer disable se `now - last_inbound_at > 24h`
- RLS strict em `whatsapp_instance_secrets` (deny-all)
- Realtime onUpdate: só campos alterados, sem joins
- Hooks realtime específicos (`useWhatsAppMessagesRealtime`, `useChatBubbleContactsRealtime`) usam `useRealtimeChannel` cross-cutting de `@/shared/realtime/useRealtimeChannel` (movido em slice 16 — antes `@/hooks/`)

## Dependências cross-module

- `@/modules/identity` — `useOrganization`, `useAuth`, `useCurrentTeamMember`, contexts
- `@/modules/leads` — `useLeadWriteInstance` (write-instance resolution para lead com phone)
- `@/shared/realtime/useRealtimeChannel`, `useRealtimeChannelStatus`, `useRealtimeSubscription` — transport infra (movido em slice 16 para `@/shared/realtime/`)
- `@/modules/campaigns` — `useMassSendJobs` re-exportado pelo barrel `useWhatsAppChat`
- `@/modules/copilot` — `useCopilotPause`, `useCopilotToggle`
- `@/lib/realtimeStatusStore` — store cross-cutting (não migrado)
- `@/integrations/supabase/client`, `@/integrations/supabase/types`
- `@/modules/leads` — `useTags`, `useLeadWriteInstance` (slice 16)

## Dedup pendente / follow-ups

- **3 hooks realtime** (`useRealtimeChannel` + `useRealtimeChannelStatus` + `useRealtimeSubscription`) → meta declarada do CLAUDE.md raiz é "manter só `useRealtimeSubscription` canonical, outros 2 viram `core/realtime/` interno". **Não consolidado no slice 6** porque esses hooks são cross-cutting (usados por 50+ hooks em todos os BCs — leads, pipelines, copilot, etc.). Movê-los para `communication` seria errado. Decisão: ficam em `src/hooks/` e serão movidos para `core/realtime/` no slice 14 (platform) ou slice 17 (boundaries enforce).
- **Hooks realtime específicos** do chat (`useWhatsAppMessagesRealtime`, `useChatBubbleContactsRealtime`, `useMetaRealtime`, `usePatchedRealtime`, `useRealtimeFallback`) — **migrados** neste slice. Usam `useRealtimeChannel` cross-cutting.
- `useMessageTemplates` está em `communication` (entidade `message_templates`). Workflows/campaigns reúsam — ok, cross-module via API pública.
- `useConversationHistory` cobre `conversation_messages` (copilot) + `whatsapp_messages` (chat) — overlap suave com `copilot` (slice 7), mas a primary entity é "histórico de mensagens" que pertence a `communication`.
- 12 módulos message-stack em `_shared/` (`message-gateway`, `outbound-sender`, etc.) → consolidação em `_shared/communication/{send,humanize,classify,dedup}/` planejada para slice 16.
- `src/components/whatsapp/` tinha apenas `SessionDeadBanner.tsx`. `whatsapp-migration/` ficou separado por contexto (lifecycle alert vs migration flow) — mantido split.

## Backend (NÃO migrado neste slice)

Edge functions e `_shared/` ficam para **slice 15** (edge fns) e **slice 16** (`_shared/`). Lista de o que **continua fora** do módulo até lá:

Edge functions:
- `whatsapp-{api-proxy,dlq-replay,health-monitor,media-retry,rebind-webhook,session-watchdog,webhook}` (7)
- `meta-webhook`, `send-meta-message`, `meta-conversation-profile`, `process-meta-messages`
- `sz-chat-send`, `sz-chat-webhook`
- `history-sync-worker`
- `stream-media`, `summarize-conversation`

`supabase/functions/_shared/`:
- `whatsapp-client.ts`, `whatsapp-dispatch.ts`, `whatsapp-media.ts`, `whatsapp-providers/`, `uazapi-client.ts`, `uazapi-types.ts`
- `message-gateway.ts`, `outbound-sender.ts`, `followup-sender.ts`, `audio-sender.ts`, `dispatch-router.ts`, `natural-messaging.ts`, `greeting-orchestrator.ts`, `message-humanizer.ts`, `message-sanitizer.ts`, `message-classifier.ts`, `send-dedup.ts`

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- WhatsApp stability: `Obsidian/.../06 — Features/Chat/whatsapp-stability-plan.md`
- Chat bubble: `Obsidian/.../06 — Features/Chat/chat-bubble.md`
- Meta chat: `Obsidian/.../02 — Arquitetura/Modulos/atendimento-meta.md`
- Sub-CLAUDE.md raiz: `supabase/functions/whatsapp-webhook/CLAUDE.md` (para slice 15)
- Histórico da migração: `Obsidian/.../10 — Remodelagem/04-execucao/slices.md`
