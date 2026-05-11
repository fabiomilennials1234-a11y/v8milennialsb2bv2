---
status: backlog
domínio: Chat
prioridade: alta
estimativa: 2 sessões
depende_de: feat/chat-core-fixes-remove-lead-embed (PR1+PR2 já aplicados)
tags: [chat, kanban, bubble, whatsapp, ux, realtime, pr3, pr4]
data_criacao: 2026-05-08
---

# Chat Bubble no Kanban — PR3 + PR4

> Continuação da estratégia "Chat divergence + Bubble" iniciada em `feat/chat-core-fixes-remove-lead-embed`. PR1 (core fixes realtime/instância/queryKeys) e PR2 (remoção do chat embutido no Lead drawer) já foram entregues nessa branch. Esta nota cobre o escopo restante.

## Estado atual após PR1+PR2

- Realtime do drawer Lead corrigido (era bug de `instanceId` ausente em `useWhatsAppMessagesRealtime`).
- Resolução de instância unificada via `useResolveChatDeepLink` (canônico last8 + normalize).
- Camada compartilhada criada em `src/hooks/chat/shared/queryKeys.ts` (fábrica `chatQueryKeys`).
- `EmbeddedChatWindow.tsx` deletado.
- `ConversationHistoryTab.tsx` agora mostra timeline + notes + CTA "Abrir conversa" que navega pra `/chat?phone=...`.
- `/chat` moderno (`ChatShellWithContext`) NÃO foi tocado — regressão zero.

## PR3 — Chat Bubble no Kanban

### Objetivo
Widget flutuante (estilo Instagram Browser) nas Pipe pages do Kanban que permite conversar com leads sem sair do Kanban. Substitui o CTA temporário do drawer Lead (que hoje navega para `/chat`) por uma chamada imperativa que abre o Bubble.

### Arquitetura

#### Componentes (novos)

```
src/components/chat/bubble/
  ChatBubble.tsx                  # FAB fixo canto inferior + badge não-lidas
  ChatBubblePanel.tsx             # painel expansível (popover desktop / sheet mobile)
  ChatBubbleHeader.tsx            # back / minimize / close
  ChatBubbleConversationList.tsx  # lista de convs (compact); reusar ConversationList se viável
  ChatBubbleSearch.tsx            # busca por nome/telefone
  ChatBubbleThread.tsx            # thread + composer (texto + imagem + áudio)
  ChatBubbleEmptyState.tsx        # estado sem instância / sem conversas
  index.ts
```

#### Estado global

```
src/contexts/ChatBubbleContext.tsx
```

API:

```ts
interface ChatBubbleContextValue {
  isOpen: boolean
  isMinimized: boolean
  selectedPhone: string | null
  selectedInstanceId: string | null
  unreadTotal: number
  open: (args?: { phone?: string; instanceId?: string }) => void
  close: () => void
  toggleMinimized: () => void
  selectConversation: (phone: string, instanceId: string) => void
}
```

- Provider montado em `LayoutWrapper.tsx`.
- Persistência: `localStorage[chat-bubble:${userId}]` armazena `{ isOpen, isMinimized }`. NUNCA persistir mensagens nem `selectedPhone` (evita tela "presa" em conv obsoleta).

#### Hook

```
src/hooks/useChatBubbleState.ts
```

- Lê/grava localStorage.
- Expõe handlers idempotentes.

#### Mount point

- Render condicional dentro de `LayoutWrapper.tsx`:

```tsx
const showBubble =
  featureFlags.chatBubble &&
  pathname.startsWith('/pipe') &&
  pathname !== '/chat' &&
  pathname !== '/chat-whatsapp'
```

- **Auto-hide em /chat**: evita dual-render (Bubble + ChatShell na mesma rota). Pipe pages = whatsapp/confirmacao/propostas/follow-ups.

#### Feature flag

```ts
// src/lib/feature-flags.ts
chatBubble: import.meta.env.VITE_CHAT_BUBBLE === "true"
```

- Default: dev=on, prod=off até validação.
- `.env.development` → adicionar `VITE_CHAT_BUBBLE=true`.

### Reuso (não duplicar lógica)

- `useWhatsAppContacts(instanceId)` — lista de convs.
- `useWhatsAppMessages(phone, instanceId)` — thread.
- `useWhatsAppMessagesRealtime(phone, instanceId)` — realtime (corrigido em PR1).
- `useSendWhatsAppMessage`, `useSendWhatsAppMedia` — envio.
- `useCanReplyOnInstanceByName` — permissão.
- `useResolveChatDeepLink` — quando `open({ phone })` é chamado sem `instanceId`.
- `chatQueryKeys` — fábrica criada em PR1.

### CTA do Lead drawer (substituir nav)

Em `src/components/leads/ConversationHistoryTab.tsx`, trocar `navigate("/chat?phone=...")` por:

```tsx
const { open } = useChatBubble()
// ...
<Button onClick={() => open({ phone: leadPhone })}>
  Abrir conversa
</Button>
```

Remover `// TODO(chat-bubble)` deixado em PR2.

### Realtime — channel name

Para evitar conflito com /chat moderno em casos de testes ou pré-renderização:
- `/chat` usa channel `whatsapp-messages-patched-${orgId}` (já existe).
- Bubble pode reusar o MESMO channel — Supabase Realtime suporta múltiplos subscribers no mesmo channel name por org. Validar com teste de integração.
- Se houver duplicação de patch (cache atualizado 2x): adicionar guard único usando `useRef` ou ref-counting via context.

### UX / Visual (spec a expandir com /design)

- FAB 56×56, canto inferior direito (24px margem). Cor: `gradient-primary`. Badge superior-direito vermelho com count de não-lidas (`unread > 99 → "99+"`).
- Painel expandido: 380×560 desktop (popover ancorado ao FAB). Mobile: sheet bottom-up full-width 90vh.
- Header painel: avatar + nome lead | back (se em thread) | minimize | close.
- Lista convs: itens de 64px altura, avatar + nome + last_msg + timestamp + unread dot.
- Busca: input no topo da lista (debounce 200ms, busca em nome+phone).
- Thread: reusar `ChatComposer` em modo compacto, ou versão própria mais simples. Bubbles iguais ao /chat (`MessageBubble`).
- Estados vazios: "Sem conversas ainda" / "Sem instância conectada" (com link pra Configurações).
- Motion: FAB tem `motion.div` com spring on hover. Painel: slide-up + scale 95→100, 200ms ease-out. Badge: pulse on new unread.
- Responsivo: <768px → sheet bottom; >=768px → popover.
- Dark-first (já default do projeto).

**Antes de implementar**: invocar `/hm-designer` ou skill `design` pra spec visual completa em `.specs/features/chat-bubble/design-spec.md` com microcopy + estados + tokens exatos.

### Performance

- Lista convs: virtualização só se >100 itens. Checar `react-virtuoso` no projeto antes de adicionar dep.
- Thread: já usa virtualização? Confirmar em `MessageList.tsx` antes de duplicar.
- Lazy-load do Bubble: `lazy(() => import("@/components/chat/bubble"))` pra não inflar bundle inicial das Pipe pages.

### Critérios de aceite PR3

- [ ] FAB visível nas 4 Pipe pages (whatsapp/confirmacao/propostas/follow-ups)
- [ ] FAB oculto em `/chat` e `/chat-whatsapp`
- [ ] Badge de não-lidas atualiza em realtime (somatório de todas as convs do user)
- [ ] Click no FAB abre painel; click fora ou X fecha; minimize colapsa pro FAB
- [ ] Lista de convs carrega + busca funciona + click abre thread
- [ ] Thread: realtime <1s, send texto/imagem/áudio funcionando
- [ ] Estado persistente entre reloads (open/minimized via localStorage)
- [ ] CTA do drawer Lead abre Bubble com phone correto e instância resolvida
- [ ] Multi-instância: usuário com 2+ instâncias vê convs de todas, badge somado
- [ ] Lead sem phone: CTA mostra fallback "Adicione um telefone"
- [ ] Lint + typecheck verde

## PR4 — Testes + Hardening

### Unit tests

- `tests/unit/chat-query-keys.test.ts` — fábrica `chatQueryKeys`: idempotência, keys distintas para args distintos.
- `tests/unit/use-chat-instance-resolver.test.ts` (se hook standalone foi criado em PR1) — caminhos: phone com 55, sem 55, 10 dígitos, fallback sem msg prévia.
- `tests/unit/normalize-phone.test.ts` — confirmar consolidação (1 implementação só); casos brazileiros: SP/RJ (DDD 11/21 com 9), regiões 10 dígitos com 9 inserido, sem mudança em landline 8 dígitos.
- `tests/unit/chat-bubble-state.test.ts` — `useChatBubbleState`: persist, restore, reset.
- `tests/unit/chat-bubble-context.test.tsx` — `ChatBubbleContext`: open/close/select transições.

### Integration tests

- `tests/integration/chat-realtime-patch.test.ts` — INSERT/UPDATE/DELETE em `whatsapp_messages` aplicam patch no cache da queryKey correta para tanto /chat quanto Bubble. Multi-tenant: msg de outra org NÃO patcha.
- `tests/integration/chat-bubble-conversation-flow.test.ts` — abrir bubble → selecionar conv → enviar msg → aparece no cache → realtime patch chega.

### E2E (Playwright)

- `tests/e2e/chat-bubble.spec.ts`:
  - Login → navegar pra `/pipe/whatsapp` → FAB visível
  - Click FAB → painel abre, lista convs renderiza
  - Selecionar conv → thread abre
  - Enviar mensagem → bubble aparece imediatamente (optimistic ou refetch <2s)
  - Minimize → estado persiste em reload
  - Navegar pra `/chat` → FAB some (auto-hide)
  - Voltar pra Pipe → FAB volta com mesmo estado

### Hardening

- Verificar headers de segurança nas edge functions tocadas (provavelmente nenhuma — front-only). Se Bubble criar nova edge: aplicar pattern `Deno.serve(withSentry('nome', handler))` + `withSecurityHeaders(getCorsHeaders(req))`.
- Auditar permissões: Bubble não deve mostrar conv de instância fora de `useWhatsAppInstancesForUser`.
- RLS: queries do Bubble usam mesmas tabelas do /chat — RLS já cobre. Verificar.
- Performance: profilar render do FAB durante drag-and-drop do Kanban (não pode causar jank).
- Limpar `// TODO(chat-bubble)` deixado em PR2.
- Atualizar `00 — INDEX.md` do vault apontando pra esta feature em `06 — Features/Chat/`.
- Mover esta nota de `08 — Backlog/backlog/` para `08 — Backlog/em-progresso/` quando começar.
- No final, mover pra `06 — Features/Chat/chat-bubble.md` com seção "Como funciona" + "Como manter".

### Critérios de aceite PR4

- [ ] Todos os testes acima passando
- [ ] `npm run lint` + `npx tsc --noEmit` + `npm run test:unit` + `npm run test:integration` + `npm run test:e2e` verde
- [ ] Sem regressão em `/chat` (rodar testes existentes do chat moderno)
- [ ] Bundle não cresce >30KB gzipped (medir com `npm run build`)
- [ ] Doc movida para `06 — Features/Chat/chat-bubble.md` com lições aprendidas

## Riscos identificados

| Risco | Mitigação |
|-------|-----------|
| Conflito de realtime channel entre /chat e Bubble | Mesmo channel já é multi-subscriber por design Supabase. Testar antes de criar workaround. |
| Bubble + drawer Lead aberto simultaneamente → 2 fontes de CTA | Drawer Lead em `/chat`? Esconder Bubble. Em Pipe? Drawer fecha quando Bubble abre, ou coexistem? Decisão UX → /design no início do PR3 |
| Bundle inicial da Pipe page cresce | Lazy-load do Bubble |
| Mobile: FAB conflita com FAB de criar lead/oportunidade nas Pipe pages | Verificar Pipe pages têm FAB hoje. Se sim, redesign: stack vertical de FABs ou speed-dial |
| Multi-tab: estado localStorage diverge | Aceitar — UX comum. Não sincronizar entre tabs. |
| Lead sem instância permitida: CTA abre Bubble vazio | Mostrar empty state explicativo + link Configurações |

## Como retomar em outra sessão

1. Ler esta nota completa.
2. Ler `.specs/features/chat-bubble/design-spec.md` se já existir; senão invocar `/hm-designer` com brief desta nota pra gerar.
3. Criar branch `feat/chat-bubble-kanban` a partir de `main` (após PR1+PR2 mergeados).
4. Despachar via arquiteto: design (spec) + engenheiro (PR3).
5. Engenheiro PR3 → arquiteto commit/push.
6. Engenheiro PR4 → arquiteto commit/push.
7. Mover esta nota pra `em-progresso/` quando começar, pra `06 — Features/Chat/` ao terminar.

## Referências de código

- Diagnóstico inicial e arquitetura: ver mensagens da sessão de 2026-05-08 que originou `feat/chat-core-fixes-remove-lead-embed`.
- `src/hooks/chat/shared/queryKeys.ts` — fábrica criada em PR1.
- `src/hooks/chat/useResolveChatDeepLink.ts` — resolver canônico.
- `src/components/chat/ChatShellWithContext.tsx` — referência de implementação correta de chat.
- `src/components/chat/list/ConversationList.tsx` — possivelmente reusável no Bubble.
- `src/lib/feature-flags.ts` — adicionar `chatBubble`.
- `src/components/layout/LayoutWrapper.tsx` — mount point do Provider.
