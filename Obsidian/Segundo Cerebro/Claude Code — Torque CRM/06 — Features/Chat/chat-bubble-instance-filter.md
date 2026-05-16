---
type: feature
title: Chat Bubble — Filtro de Instancia
status: active
created: 2026-05-12
updated: 2026-05-12
tags: [chat, whatsapp, chat-bubble, feature]
related: []
owner: gabriel
last_updated: 2026-05-12
---

# Chat Bubble — Filtro de Instancia

## O que e

Switcher compacto no header da lista do Chat Bubble (FAB flutuante das Pipe pages) que permite filtrar conversas por instancia WhatsApp. Usuarios com multi-line (>=2 instancias permitidas) costumavam ver uma lista agregada com todas as conversas; agora podem isolar visualmente uma instancia, mantendo o cache compartilhado e o badge global de nao-lidas inalterados.

Filtro e puramente visual e client-side. Nao altera queries cross-instance, nao filtra realtime e nao afeta unread badge.

## Como funciona

Estado vive em `ChatBubbleContext` (`src/contexts/ChatBubbleContext.tsx`) como `listInstanceFilter: string | "all"`. Persiste em `localStorage` na chave `chat-bubble:list-filter:${userId}`. O componente novo `ChatBubbleInstanceSwitcher` (`src/components/chat/bubble/ChatBubbleInstanceSwitcher.tsx`) renderiza um trigger 28px com dot+nome+chevron e abre Popover Radix 260px listando "Todas as conversas" + instancias em ordem alfabetica, com `Check` no item selecionado e status muted (ex: "• desconectada") quando `status !== "connected"`.

`ChatBubblePanel` (modo `list`):
- Quando `instances.length >= 2`: renderiza switcher via prop `titleSlot` do `ChatBubbleHeader`.
- Quando `instances.length === 1`: passa `singleInstanceName` pro header (mostra "Conversas" + nome muted 10px abaixo).
- Quando `instances.length === 0`: comportamento atual (`no-instance` empty state).

`ChatBubbleConversationList` (`src/components/chat/bubble/ChatBubbleConversationList.tsx`):
- Recebe nova prop `filterInstanceId: string | "all"` + callback `onResetFilter`.
- `useQueries` continua iterando sobre array `instances` COMPLETO (cache compartilhado intacto, regras de hooks respeitadas).
- Filtro client-side aplicado entre `allEntries` e `searchQuery` filter.
- Empty state filtrado: variant nova `filtered-empty` no `ChatBubbleEmptyState` (`src/components/chat/bubble/ChatBubbleEmptyState.tsx`) com CTA "Ver todas as conversas".

## Regras de negocio

- Filtro **nao** muda `unreadTotal` (badge FAB sempre soma TODAS instancias permitidas).
- Realtime cross-instance (`useChatBubbleContactsRealtime`) continua subscribindo a TODOS `instanceIds` — invariante critica.
- `open({ instanceId })` (deep-link com instancia conhecida): filtro auto-muda pra esse `instanceId`, garantindo coerencia ao voltar pra lista via `backToList()`.
- Filtro persiste por user, sobrevive reload, minimize, close, navegacao.
- Search opera **dentro** do escopo filtrado (filter > search).
- Cor do dot reusa `instanceColor(instanceId)` (hash deterministico) ja existente.

## Edge cases

| Cenario | Comportamento |
|---------|---------------|
| 0 instancias permitidas | Switcher nao renderiza (`no-instance` state) |
| 1 instancia permitida | Switcher nao renderiza, nome aparece como subtitulo discreto |
| Instancia filtrada removida da lista | Auto-reset pra `"all"` via `useEffect` |
| Filtro persistido + instancia some | Auto-reset no mount (cleanup do estado obsoleto) |
| Filtro + 0 resultados | Empty `filtered-empty` com CTA "Ver todas as conversas" |
| Filtro + search query | Search aplicado apos filter (escopo restrito) |
| Reload com filtro setado | Estado restaurado do localStorage; Provider lazy-init |
| Deep-link `open({phone, instanceId})` | Filtro auto-sincroniza com `instanceId` |

## Decisoes de design

- **Filtro client-side, nao server**: re-fetch por instancia foi descartado. Cache `useQueries` (queryKey: `chatQueryKeys.contacts(orgId, instanceId)`) e compartilhado com `/chat`; refazer queries violaria reuso. Volume tipico (<200 conversas/instancia) torna filter em memoria trivial.
- **Badge nao filtra**: badge FAB e atalho de "tem coisa pra olhar" — esconder uma instancia da lista nao deve esconder o sinal de novas mensagens dessa instancia.
- **Auto-reset em removal**: usuario que perde acesso a uma instancia nao deveria ver lista vazia confusa; volta pra "Todas" automaticamente.
- **Auto-sync no `open({instanceId})`**: deep-link de uma conversa especifica implica intent de focar nessa instancia ao voltar pra lista.
- **Hooks rules respeitadas**: `useQueries` continua iterando sobre `instances.length` total — filtrar `instances` antes mudaria o numero de hooks entre renders e quebraria React.

## Fluxos

### Minimize
- Filtro preservado em memoria + localStorage.
- Restaurar (toggle FAB) volta no mesmo estado.

### Deep-link (drawer Lead → `open({phone, instanceId})`)
1. Provider seta `selectedPhone`/`selectedInstanceId` direto.
2. `setListInstanceFilterState(instanceId)` no mesmo callback.
3. Persistido pelo useEffect na chave `chat-bubble:list-filter:${userId}`.
4. Se usuario clicar back, lista mostra apenas a instancia da conversa anterior.

### Instance removed (admin revoga acesso ou instancia desconectada → status "error")
1. `useWhatsAppInstancesForUser` retorna lista sem a instancia.
2. `useEffect` no Provider detecta `!instances.find(i => i.id === listInstanceFilter)`.
3. `setListInstanceFilterState("all")`.
4. Persiste no localStorage como `"all"`.

## Arquivos chave

- `src/components/chat/bubble/ChatBubbleInstanceSwitcher.tsx` (novo)
- `src/components/chat/bubble/ChatBubblePanel.tsx`
- `src/components/chat/bubble/ChatBubbleHeader.tsx`
- `src/components/chat/bubble/ChatBubbleConversationList.tsx`
- `src/components/chat/bubble/ChatBubbleEmptyState.tsx`
- `src/components/chat/bubble/utils/instanceColor.ts`
- `src/contexts/ChatBubbleContext.tsx`
- `src/hooks/useChatBubble.ts` (re-export via context value)

## Testes

- `tests/unit/chat-bubble-instance-filter.test.tsx` (novo) — filter state, persist, auto-reset, empty filtered, switcher UI
- `tests/unit/chat-bubble-context.test.tsx` (estendido) — listInstanceFilter init/set/reset, unreadTotal nao filtrado
- `tests/e2e/13-chat-bubble.spec.ts` (estendido) — selecao persiste em reload, badge FAB inalterado

## Areas frageis tocadas

- **WhatsApp/Uazapi**: nenhum impacto. Realtime cross-instance segue intocado.
- **Multi-tenancy**: nenhuma query nova. Filtro client-side sobre dados ja RLS-scoped.
- **Permissoes**: reuso de `useWhatsAppInstancesForUser` — instancias filtradas ja estao limitadas por allowed_members.

## Historico

- 2026-05-12 — Criada. Feature frontend-only, sem migration nem edge function.
