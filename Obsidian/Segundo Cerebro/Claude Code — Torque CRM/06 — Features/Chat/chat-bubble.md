---
type: feature
title: Chat Bubble Kanban
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# Chat Bubble Kanban

## O que é

Widget flutuante (FAB pílula gold + painel popover/sheet) renderizado nas Pipe pages do Torque CRM (`/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas`, `/follow-ups`, `/pipe/custom/*`). Permite ao SDR/Closer conversar com leads via WhatsApp/Uazapi sem sair do contexto do Kanban — substitui o CTA temporário do drawer Lead que navegava para `/chat`.

Diferenciação visual do `OraculoFloatingButton` (Dashboard, gradient roxo, pulse contínuo): aqui é gradient gold + pílula horizontal "Conversas" + sem pulse — coexistem sem confusão.

Lazy-loaded — chunk só desce no primeiro open (~7.8 KB gz).

## Como funciona

### Mount
- Provider `ChatBubbleProvider` montado em `src/components/layout/MainLayout.tsx` quando `featureFlags.chatBubble` ON.
- Componente `<ChatBubble />` renderiza FAB + lazy `ChatBubblePanel`.
- Pathname guard interno: só renderiza em rotas Pipe canônicas (regex em `src/components/chat/bubble/ChatBubble.tsx`).
- Auto-hide em `/chat` e `/chat-whatsapp/*` — previne dual-render com `ChatShellWithContext`.

### Estado
- Context: `ChatBubbleContext` (`src/contexts/ChatBubbleContext.tsx`). Expõe `isOpen`, `isMinimized`, `selectedPhone`, `selectedInstanceId`, `unreadTotal`, `instances`, `isReconnecting`, `needsPhoneHint`.
- Persist localStorage por userId: chave `chat-bubble:${userId}` armazena apenas `{ isOpen, isMinimized }`. Selecionados NUNCA persistidos (evita conv obsoleta após reload).
- Auto-minimize: `MutationObserver` em `[role="dialog"][data-state="open"]` — quando drawer Lead (ou outro Radix Dialog) abre, painel auto-minimiza preservando estado.

### Realtime
- 1 subscription thread aberta via `useWhatsAppMessagesRealtime(selectedPhone, selectedInstanceId)` (canônico do `/chat`).
- 1 subscription cross-instâncias dedicada via `useChatBubbleContactsRealtime(instanceIds, activePhone)` em canal próprio `chat-bubble-contacts-${orgId}` (separado do `whatsapp-messages-patched-${orgId}` do `/chat`). Patcheia `chatQueryKeys.contacts(orgId, instance_id)` para cada instância permitida.
- Status do channel exposto via `isReconnecting` no Provider — mostra `<ChatBubbleRealtimePill>` quando `CHANNEL_ERROR` ou `TIMED_OUT`.

### Lista de conversas
- `ChatBubbleConversationList.tsx` agrega contacts via `useQueries` × N instâncias permitidas (`useWhatsAppInstancesForUser`).
- Compartilha queryKey com `useWhatsAppContacts` canônico — cache reusado quando `/chat` já populou.
- Density compact (item 56px, avatar 32px). Color-dot 6px hash-derived à esquerda do nome quando >1 instância.
- Search debounce 200ms. Virtualização >50 items via `@tanstack/react-virtual`.
- Filtra arquivadas + deletadas (Bubble mostra apenas active).

### Thread
- Reusa `MessageList` canônico de `src/components/chat/view/MessageList.tsx` com `density="compact"`. Bubbles bit-identical ao `/chat`.
- Composer compact próprio (`ChatBubbleComposer.tsx`): mic↔send contextual estilo WhatsApp Web. Reusa hooks `useSendWhatsAppMessage`, `useSendWhatsAppMedia`, e componente `AudioRecorder`.
- Permissão: `useCanReplyOnInstanceByName` antes de habilitar composer. Read-only com `<ChatBubblePermissionBanner>` quando false.
- Auto-mark-as-read ao montar thread: grava `whatsapp_last_seen_*` no localStorage + zera `unread_count` no cache.

### CTA do drawer Lead
- `ConversationHistoryTab.tsx` chama `useChatBubbleOptional().open({ phone, leadName })`.
- Lead sem phone: open() ativa `needsPhoneHint` → toast "Adicione um telefone do lead pra abrir a conversa.".
- Fallback `window.location.href = '/chat?phone=...'` quando Provider ausente (drawer fora de rota Pipe).

### Feature flag
- `chatBubble` em `src/lib/feature-flags.ts`. Ativada via `VITE_CHAT_BUBBLE=true` (env Vite).
- Default: dev=on, prod=off.

## Como manter

| Tarefa | Onde editar |
|--------|-------------|
| Visual do FAB ou painel | `src/components/chat/bubble/ChatBubbleFab.tsx`, `ChatBubblePanel.tsx`, `ChatBubbleHeader.tsx` |
| Tokens HSL | `src/index.css` (token novo `chat-bubble-panel-shadow`) |
| Lógica de estado | `src/contexts/ChatBubbleContext.tsx` |
| Persist localStorage | `src/hooks/useChatBubbleState.ts` |
| Realtime cross-instâncias | `src/hooks/chat/useChatBubbleContactsRealtime.ts` |
| Lista de conversas (agregação) | `src/components/chat/bubble/ChatBubbleConversationList.tsx` |
| Composer (envio) | `src/components/chat/bubble/ChatBubbleComposer.tsx` |
| Pathname guard | `src/components/chat/bubble/ChatBubble.tsx` (constante `PIPE_PATH_PATTERNS`) |
| Spec visual | `.specs/features/chat-bubble/design-spec.md` |

### Como adicionar uma instância

Bubble lê automaticamente de `useWhatsAppInstancesForUser()`. Adicionar via UI normal de configuração (`/configuracoes/whatsapp`); Bubble pega na próxima query.

### Como debugar realtime

1. Abrir DevTools Network → tab WS → procurar `realtime/v1/websocket`.
2. Channel name esperado: `chat-bubble-contacts-${orgId}` (cross-instâncias) e `whatsapp-messages-patched-${orgId}` (thread aberta).
3. Eventos `postgres_changes` em `whatsapp_messages` com filtro `organization_id=eq.${orgId}`.
4. Status pill aparece automático quando channel cai em `CHANNEL_ERROR`/`TIMED_OUT`.
5. TanStack Query DevTools mostra cache patcheado em `["whatsapp_contacts", orgId, instanceId]`.

### Como rodar testes

- Unit: `npm run test:unit` — cobre `chat-query-keys`, `chat-bubble-state`, `instance-color`, `use-chat-bubble-contacts-realtime`, `chat-bubble-context`.
- Integration: `RUN_BUBBLE_INTEGRATION=true SUPABASE_URL=http://localhost:54321 npm run test:integration` — cobre RLS cross-org de `whatsapp_messages`. Skipped por default (depende de seed.sql aplicado).
- E2E: `npm run test:e2e -- 13-chat-bubble.spec.ts` — smoke test FAB visível + auto-hide + persist. Requer dev server na 8080 + auth fixture.

## Regras de negócio

- Apenas instâncias presentes em `useWhatsAppInstancesForUser()` aparecem na lista.
- Composer disponível apenas quando `useCanReplyOnInstanceByName` retorna `true`.
- Multi-org: cache TanStack invalida ao trocar de org (queryKey inclui `organization_id`).
- Persist é por **userId**, não por org. Usuário multi-org carrega o mesmo `{isOpen, isMinimized}` ao trocar.

## Edge cases

- **Lead sem phone**: CTA abre Bubble mostrando lista global + toast "Adicione um telefone".
- **Sem instância conectada**: empty state com CTA `Conectar WhatsApp` → `/configuracoes/whatsapp`.
- **Sem permissão na instância**: thread renderiza, banner inline substitui composer.
- **Drawer Lead aberto + Bubble aberto**: auto-minimize via MutationObserver. Drawer fecha → painel volta automático.
- **Multi-tab**: cada tab lê seu próprio localStorage independente. Aceito (UX comum).
- **Realtime offline**: pill "Reconectando…" aparece. Cache preserva últimos contacts.

## Áreas frágeis

| Área | Por quê |
|------|---------|
| **WhatsApp/Uazapi** — instâncias permitidas | Lista cross-instâncias respeita `useWhatsAppInstancesForUser`. RLS de `whatsapp_messages` cobre defesa em profundidade |
| **Permissões** — `useCanReplyOnInstanceByName` | UI guard + backend `assertCanReplyOnInstance` no envio (defesa dupla) |
| **Multi-tenant** | Toda query carrega `organization_id`. Channel realtime filtra postgres-side. Hook `useChatBubbleContactsRealtime` adicionalmente verifica `instance_id ∈ instanceIds` antes de patchar |
| **Realtime channel naming** | `chat-bubble-contacts-${orgId}` é DIFERENTE de `whatsapp-messages-patched-${orgId}` do `/chat`. Não modificar o canônico — bubble usa canal próprio para zero risco de regressão |
| **localStorage** | Chave `chat-bubble:${userId}` apenas armazena `{isOpen, isMinimized}`. NUNCA `selectedPhone`/`selectedInstanceId` — preveniria tela presa em conv obsoleta |

## Fora de escopo (PR3+PR4)

- Indicador "digitando" / presence (Uazapi não envia confiável)
- Notificações push browser
- Reactions inline em thread
- Drag-and-drop de imagem (apenas picker via Paperclip)
- Múltiplas conversas em tabs dentro do painel
- Histórico de chats arquivados (apenas active)
- Mensagens agendadas
- Slash commands
- Indicador de "offline" do contato

Esses ficam pra iterações futuras (PR5+).

## Histórico

- **2026-05-08** — PR3 (`f12b045`): implementação Chat Bubble Kanban. FAB pílula esticada gold, painel popover/sheet, lista cross-instâncias, thread com composer compact próprio (mic↔send), realtime cross-instâncias via canal próprio, auto-minimize via MutationObserver, lazy-load do painel.
- **2026-05-08** — PR4: testes (5 unit suites = 56 tests, 1 integration suite skipped por default, 1 E2E smoke), realtime status pill conectado, FAB com `React.memo`, pathname patterns corrigidos pra rotas reais (`/pipe-whatsapp` em vez de `/pipe/whatsapp`), auditoria de segurança documentada, doc movida para `06 — Features/Chat/`.
