# 2026-05-18 — Kanban → Chat: prefetch + skeleton

## Mudanças

- **Performance/Chat**: transição do botão WhatsApp do card Kanban para a tela
  de chat agora usa **prefetch em camadas** + **skeleton estrutural** dedicado
  no lugar do loader genérico do Suspense.

## Por quê

Vendedor abre o chat dezenas de vezes ao dia. Antes:

1. `onClick` no botão WhatsApp do `LeadCard` chamava `navigate("/chat-whatsapp?phone=…")`.
2. `React.lazy` ia buscar o chunk `ChatWhatsApp` (+ `MessageList` ~187 KB).
3. Suspense global pintava o `TorqueLoader` (loader de marca, animado).
4. Página montava → disparava `useWhatsAppInstancesForUser` + `useWhatsAppContacts` + `useWhatsAppMessages`.
5. Primeira pintura útil acontecia depois de 3 round-trips serializados.

Sintoma percebido: ~800 ms–1.6 s de "tela branca" antes da conversa aparecer.

## Como funciona agora

### 1. Prefetch de rota (chunk JS)
`onMouseEnter` + `onFocus` no botão WhatsApp disparam `prefetchChatRoute()`,
que executa um `import("@/pages/ChatWhatsApp")` idempotente. O chunk começa a
baixar enquanto o usuário ainda não clicou.

### 2. Prefetch de dados (TanStack Query)
`onMouseDown` chama `prefetchChatData(queryClient, { organizationId,
phoneNumber, instanceId? })`. Usa **a mesma chave canônica** que
`useWhatsAppMessages` (via `chatQueryKeys.messages(orgId, phone, instanceId)`)
— se `instanceId` ainda é desconhecido, o prefetch sai cedo para evitar
populá-lo numa chave morta.

### 3. Skeleton dedicado
Suspense interno na rota `/chat` e `/chat-whatsapp` usa
`<ChatSkeleton />` (layout 2-painéis com shimmer) em vez do `<TorqueLoader />`
global. Mantém ancoragem visual e elimina o flash do logo da marca.

### 4. Bundle
`date-fns` virou chunk dedicado em `vite.config.ts`. Compartilhado por chat,
kanban, agenda e follow-ups — agora cacheado cross-rota.

## Arquivos tocados

- `src/lib/prefetch/chatPrefetch.ts` — **novo**. Helpers `prefetchChatRoute()`
  e `prefetchChatData()`. Chave de cache espelha `chatQueryKeys.messages`.
- `src/lib/whatsapp.ts` — `useOpenWhatsAppChat()` agora retorna objeto
  callable com `.prefetchRoute()` e `.prefetchData(phone, instanceId?)`.
  Backwards-compat com call-sites pré-existentes (campanhas, follow-ups,
  revisão, lead-detail, confirmação) — todos continuam tratando como função.
- `src/lib/whatsapp.ts` — adiciona `useChatPrefetch()` (variante "só
  prefetch" para hover em listas grandes).
- `src/components/chat/ChatSkeleton.tsx` — **novo**. Layout 2-painéis
  shimmer, sem dependência de framer-motion.
- `src/components/leads/LeadCard.tsx` — wire `onMouseEnter`/`onFocus`/`onMouseDown`
  nos dois botões WhatsApp do card (dropdown menu item + quick action row).
- `src/App.tsx` — Suspense interno com `<ChatSkeleton />` para as rotas
  `/chat` e `/chat-whatsapp`. Demais rotas continuam usando o `TorqueLoader`
  global.
- `vite.config.ts` — chunk `date-fns` isolado em `manualChunks`.
- `tailwind.config.ts` — keyframe `shimmer` para o skeleton.
- `tests/unit/chat-prefetch.test.ts` — **novo**. 5 testes garantindo
  idempotência da rota, no-op em params faltantes, e que a chave de cache
  bate exatamente com a do hook real.

## Multi-tenancy

`prefetchChatData` resolve `organizationId` via `useCurrentTeamMember`
dentro do `useOpenWhatsAppChat`. Sem org id, o prefetch é no-op — nunca
populamos cache em chave sem tenant, evitando vazamento cross-org.

## Backwards-compat

Call-sites existentes (`openWhatsApp(phone, e)`) continuam funcionando — o
retorno do hook é objeto callable. Não há impacto em `FollowUpCard`,
`ConfirmacaoCard`, `CampanhaKanban`, `RevisionItem`, `LeadDetailHeader`,
`LeadModalToolbar`, `WhatsAppContext`. Apenas o `LeadCard` (Kanban) consome
os novos métodos `.prefetchRoute()` / `.prefetchData()`.

## Critérios de aceite

- [x] Primeira pintura útil < 150 ms percebido (skeleton imediato no `mousedown`
  por estar no mesmo chunk principal).
- [x] Sem queries duplicadas — `prefetchChatData` usa a chave canônica
  `chatQueryKeys.messages(orgId, phone, instanceId)`.
- [x] Sem regressão em outros usos de `useOpenWhatsAppChat`.
- [x] Lint + typecheck OK. Unit tests dos arquivos tocados passam (revisão
  item já tinha 2 falhas pré-existentes não relacionadas).
- [x] Build OK. Chunk `ChatWhatsApp-*.js` separado (18 KB); transitivamente
  carrega `MessageList-*.js` (188 KB) que é o gargalo real e ganha mais com
  warmup.

## Follow-ups

- Estender prefetch a `ConfirmacaoCard`, `FollowUpCard`, `CampanhaKanban`,
  `RevisionItem` — todos usam `useOpenWhatsAppChat` e se beneficiariam
  igualmente. Wire de `onMouseEnter`/`onMouseDown` é trivial; deixei
  fora deste PR para manter o escopo do brief.
- Considerar dividir `MessageList` (188 KB) em sub-chunks (audio player,
  image preview, etc) — fora de escopo desta PR.
