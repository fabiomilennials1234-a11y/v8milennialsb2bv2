# Chat — Onda 2b — Architect Plan

**Author:** Architect (agent-architect)
**Date:** 2026-04-22
**Branch:** `feat/chat-ux-ui-redesign` (33 commits Onda 1+2a merged, HEAD `51238fd`)
**Status:** Proposed — no code yet.
**Sucessor de:** `.specs/features/chat-ux-ui-redesign/architect-plan.md` (Ondas 1 + 2a concluídas)

Este documento é **prescriptivo e operacional**. Prescreve ordem, contratos, SQL, pontos de extract, riscos e acceptance por commit. Não contém implementação — só contratos e decisões.

---

## 0. TL;DR Executivo

Onda 2b adiciona **6 capacidades** sem reescrever nada da Onda 1/2a:

| # | Capacidade | Forma | Impacto em produção |
|---|-----------|-------|---------------------|
| 1 | `⌘K` Command Palette | `cmdk` já instalado, provider global, context-aware | Zero regressão — montado em App.tsx lado de tudo |
| 2 | Virtualização lista + mensagens | `@tanstack/react-virtual` (novo) | Interno ao `MessageList` / `ConversationList`, fallback mobile |
| 3 | Realtime patched (cirúrgico) | Novo hook `usePatchedRealtime` + migração 3 sites | `setQueryData` substitui `invalidate/refetchQueries` — ganho p99 + ~80% bandwidth |
| 4 | FSM Takeover IA↔humano | Nova coluna `conversations.ai_state` + hook + UI | Fundamental pra diferenciar o produto. Migration idempotente. |
| 5 | Full-text search mensagens | `tsvector` generated column + GIN + RPC `search_messages` | Integra em `⌘K` (seção Mensagens) + rota `/chat/search` opcional |
| 6 | Split `LeadDetailContent` 1040→<300 | 7 componentes novos, shell <200 LOC | Consumidores (`WhatsAppChat`, `LeadContactModal`) seguem funcionando — API preservada |

**Feature flag:** `VITE_CHAT_ONDA_2B` controla se rota `/chat` usa `<ChatShell>` novo ou `WhatsAppChat` legado. Mockups `/_mockup/chat` e `/_mockup/chat-v2` preservados.

**Esforço total estimado:** ~200h engenharia (2b.1 = 80h / 2b.2 = 120h), 23 commits atômicos.

---

## 1. Inventário (leitura real — `feat/chat-ux-ui-redesign` HEAD `51238fd`)

### 1.1 Componentes de chat existentes

```
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/
├── ChannelBadge.tsx
├── ChatEmptyState.tsx              (Onda 1)
├── ConversationNotes.tsx
├── EmbeddedChatWindow.tsx
├── LeadContactModal.tsx            (consumidor de LeadDetailContent)
├── LeadDetailContent.tsx           (1040 LOC — split alvo de Onda 2b)
├── ScheduleMessageModal.tsx
├── ScheduledMessagesBanner.tsx
├── ScrollToBottomFab.tsx           (Onda 1)
├── SlashCommandPopover.tsx
├── UnreadDivider.tsx               (Onda 1)
├── WhatsAppChat.tsx                (1257 LOC — produção, intocado)
├── composer/ChatComposer.tsx       (Onda 2a C13)
├── context-panel/
│   ├── ContextPanel.tsx            (shell com Tabs: info/pipe/tags/history)
│   ├── ContextPanelHistory.tsx     (stub)
│   ├── ContextPanelInfo.tsx        (stub)
│   ├── ContextPanelPipe.tsx        (stub)
│   └── ContextPanelTags.tsx        (stub)
├── index.ts                        (barrel)
├── layout/ChatShell.tsx            (208 LOC — 3-col resizable, Onda 2a C10)
├── list/
│   ├── ConversationList.tsx        (275 LOC — Onda 2a C5)
│   └── ConversationListItem.tsx
├── media/
│   ├── AudioPlayer.tsx
│   ├── AudioRecorder.tsx
│   ├── ImagePreviewModal.tsx
│   └── MessageMedia.tsx
└── view/
    ├── ChatHeader.tsx
    └── MessageList.tsx             (290 LOC — Onda 2a C7, grouping/unread/motion preservados)
```

### 1.2 Hooks existentes

```
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/
├── types.ts
├── useChatDensity.ts               (Onda 2a C11 — FSM compact/comfortable/spacious)
├── useConversationReadState.ts     (Onda 2a C14 — DB-backed + fallback localStorage)
├── useWhatsAppContacts.ts          (lista conversas — refetch na subscrição hoje)
├── useWhatsAppInstances.ts
├── useWhatsAppMessages.ts          (mensagens chat ativo — refetchInterval 20s)
├── useWhatsAppRealtime.ts          (subscreve whatsapp_messages → refetch, alvo de migração)
├── useWhatsAppSend.ts
└── useWhatsAppSzChat.ts
```

### 1.3 Pontos de injeção para `⌘K` em `App.tsx`

`/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/App.tsx` (feat branch) estrutura:

```tsx
<QueryClientProvider>
  <ThemeProvider>
    <ThemeTransitionProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <GlobalErrorBoundary>
              <AppRoutes />   // ← CommandPaletteProvider aqui
            </GlobalErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeTransitionProvider>
  </ThemeProvider>
</QueryClientProvider>
```

**Decisão:** `<CommandPaletteProvider>` envolve `<AppRoutes />` — precisa de `useAuth`, `useQueryClient`, `react-router-dom` context. Dentro de `BrowserRouter` + `AuthProvider`. Fora de `ProtectedRoute` (provider renderiza sempre mas palette só abre com user logado — guard interno).

### 1.4 Consumidores externos de `LeadDetailContent` (grep)

```
src/components/chat/LeadContactModal.tsx:5    import { LeadDetailContent } from "./LeadDetailContent";
src/components/chat/LeadContactModal.tsx:24        <LeadDetailContent ... />
src/components/chat/WhatsAppChat.tsx:79        import { LeadDetailContent } from "./LeadDetailContent";
src/components/chat/WhatsAppChat.tsx:2431      <LeadDetailContent ... />
```

**Contrato da API (preservar):**
```ts
interface LeadDetailContentProps {
  phoneNumber: string;
  pushName?: string | null;
  onClose?: () => void;
  showHeader?: boolean;
}
```

**Regra dura:** split NÃO muda o contrato. `LeadDetailContent` vira shell que delega — consumidores continuam importando `./LeadDetailContent` (path re-exported via barrel ou arquivo de `src/components/lead/LeadDetailContent.tsx` exportado de volta).

### 1.5 Realtime — sites atuais a migrar

| Site | Arquivo | Comportamento hoje | Problema |
|------|---------|---------------------|----------|
| whatsapp_messages (chat ativo) | `src/hooks/chat/useWhatsAppRealtime.ts:36-64` | `refetchQueries(["whatsapp_messages", orgId, phone])` em cada evento | Refetch inteiro ~N msgs a cada nova msg |
| whatsapp_contacts (sidebar) | `src/hooks/chat/useWhatsAppRealtime.ts:43` | `refetchQueries(["whatsapp_contacts", orgId])` em cada evento | Refetch inteiro da lista a cada msg de qualquer conversa |
| Legacy whatsapp_chat (produção) | `src/hooks/useWhatsAppChat.ts:961` | idem (pré-Onda 2a) | NÃO migrar nessa onda — intocado |
| channel_messages (multi-canal) | `src/hooks/useChannelChat.ts:481` | fora de escopo |
| Genérico | `src/hooks/useRealtimeSubscription.ts:139` | wrapper já existe com `onUpdate/onDelete` | Reusar pattern |

`useRealtimeSubscription` já faz o que queremos para UPDATE/DELETE — o novo `usePatchedRealtime` é similar porém especializado em **INSERT-append / UPDATE-patch / DELETE-remove** com matcher identitário (id-based), sem debounce de 2s (chat precisa latência real-time).

### 1.6 Stack validado

```json
"cmdk": "^1.1.1",                // instalado
"framer-motion": "^12.24.7",     // instalado
"@tanstack/react-query": "^5.83.0",
// @tanstack/react-virtual — NÃO instalado, adicionar
```

### 1.7 Data model relevante

`/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/integrations/supabase/types.ts` (trechos):

**`conversations`:**
```ts
Row: {
  agent_id: string, assigned_to: string | null, context: Json | null,
  created_at: string | null, id: string, last_message_at: string | null,
  lead_id: string, long_term_memory: Json | null, organization_id: string,
  short_term_memory: Json | null, state: string,
  turn_count: number | null, updated_at: string | null
}
```
⚠️ Já existe `state` — coluna genérica usada pelo copilot (IDLE/ACTIVE/etc). NÃO reusar. `ai_state` é coluna **nova e distinta** — semântica de takeover humano↔IA.

**`conversation_messages`:**
```ts
Row: { content: string, conversation_id: string, created_at: string | null,
       id: string, metadata: Json | null, role: string }
```
⚠️ Colunas reais são `content` e `role` — **NÃO** `message_content` / `sender`. O prompt original usou nomes errados; plano usa os reais. Não tem `organization_id` direta — precisa JOIN via `conversations`. Isso afeta RLS e RPC de search.

**`lead_history`:**
```ts
Row: { action: string, created_at: string, created_by: string | null,
       description: string | null, entity_id: string | null, entity_type: string | null,
       id: string, lead_id: string, metadata: Json | null,
       organization_id: string | null, source: string }
```
`AITimeline` consome filtrado por `lead_id` + `action LIKE 'ai_%'` + `organization_id`.

### 1.8 Rotas existentes (branch feat)

| Rota | Componente | Uso |
|------|-----------|-----|
| `/chat`, `/chat-whatsapp` | `ChatWhatsApp` → `WhatsAppChat.tsx` | produção (legado, intocado) |
| `/_mockup/chat` | `MockupChat` | Onda 1 (validação visual) |
| `/_mockup/chat-v2` | `MockupChatV2` | Onda 2a (ChatShell completo) |

Onda 2b **não altera `/chat` em produção**. Flag `VITE_CHAT_ONDA_2B=true` em dev habilita `<ChatShell>` no `/chat`. Produção permanece em `WhatsAppChat` até aceitação final.

---

## 2. Estrutura de pastas nova

```
src/components/command/
├── CommandPalette.tsx               (dialog + cmdk root)
├── CommandPaletteProvider.tsx       (context: open, close, toggle, pushContext)
├── useCommandPalette.ts             (hook consumidor do context)
├── commandRegistry.ts               (API pra registrar comandos declarativos)
├── recentCommands.ts                (localStorage top-5 por userId)
└── groups/
    ├── CommandGroupNavigation.tsx   (rotas: Dashboard, Leads, Copilot, Analytics, Settings, etc.)
    ├── CommandGroupConversations.tsx (conversas ativas — context-aware /chat)
    ├── CommandGroupActions.tsx      (toggle dark, criar lead, toggle density no chat, marcar lido, arquivar)
    └── CommandGroupMessages.tsx     (resultados de full-text search em mensagens)

src/components/chat/takeover/
├── TakeoverControls.tsx             (pill colorido + dropdown pause/resume)
├── AITimeline.tsx                   (stream de eventos lead_history)
└── aiStateLabels.ts                 (mapping estado → label/cor)

src/components/lead/                  (NOVO — consumidor externo a chat/)
├── LeadDetailContent.tsx             (shell <200 LOC, re-exported p/ paths antigos)
├── header/
│   └── LeadHeader.tsx                (avatar + nome + ações)
├── tabs/
│   ├── LeadTabInfo.tsx               (~250 LOC)
│   ├── LeadTabPipe.tsx               (~250 LOC)
│   ├── LeadTabTags.tsx               (~120 LOC)
│   ├── LeadTabProducts.tsx           (~150 LOC)
│   └── LeadTabHistory.tsx            (~200 LOC)
└── notes/
    └── LeadNotes.tsx                 (~100 LOC)

src/components/chat/LeadDetailContent.tsx   (DELETAR — substituído por re-export)
ou manter como barrel:
   export { LeadDetailContent } from "@/components/lead/LeadDetailContent";

src/hooks/chat/
├── usePatchedRealtime.ts             (generic wrapper p/ setQueryData)
├── useTakeover.ts                    (FSM + mutations)
├── useMessageSearch.ts               (RPC + debounce 300ms)
├── useAITimeline.ts                  (lead_history filtered)
└── useVirtualList.ts                 (opcional — abstrai virtualizer + estimate size por density)

src/lib/chat-types.ts                 (novo — AiState enum + AiStateTransition)
supabase/migrations/
├── 20260501000000_add_ai_state_to_conversations.sql
├── 20260501000001_conversation_messages_search_tsv.sql
└── 20260501000002_rpc_search_messages.sql
```

---

## 3. Commits atômicos (23 commits)

Ordem prescrita. Cada commit **tem que** passar `npm run lint` + `npm run test:unit` + build. Smoke no mockup quando aplicável.

### Fase 2b.1 — Foundation (commits 1-10, ~80h)

#### C18 — `feat(chat): add @tanstack/react-virtual dependency + useVirtualList abstraction`

- **Files:** `package.json`, `package-lock.json`, `src/hooks/chat/useVirtualList.ts` (novo)
- **LOC:** +60
- **Props/API:**
  ```ts
  useVirtualList<T>({
    items: T[],
    getScrollElement: () => HTMLElement | null,
    estimateSize: (index: number) => number,
    overscan?: number,  // default 8
  }): { virtualizer, virtualItems, totalSize }
  ```
- **Dependências:** nenhuma (wrapper fino sobre `useVirtualizer`)
- **Smoke:** test unit `useVirtualList` com lista 200 items.

#### C19 — `feat(chat): usePatchedRealtime utility generico`

- **Files:** `src/hooks/chat/usePatchedRealtime.ts` (novo)
- **LOC:** ~130
- **API:**
  ```ts
  interface PatchedRealtimeConfig<TRow, TCache> {
    table: string;
    schema?: string;                             // default "public"
    filter?: string;                              // ex: `organization_id=eq.${orgId}`
    queryKey: QueryKey;
    matcher: (row: TRow, cacheItem: TCache) => boolean;
    mapInsert?: (row: TRow, cache: TCache[] | undefined) => TCache[];
    mapUpdate?: (row: TRow, cache: TCache[] | undefined) => TCache[];
    mapDelete?: (row: TRow, cache: TCache[] | undefined) => TCache[];
    enabled?: boolean;
  }
  function usePatchedRealtime<TRow, TCache>(config): void
  ```
  - Usa `queryClient.setQueryData(queryKey, fn)` — nunca `invalidate` nem `refetch`.
  - Se `mapX` não fornecido → fallback seguro = `invalidateQueries({ queryKey })`.
  - Channel name único: `${table}-${JSON.stringify(filter)}`.
  - Cleanup: `removeChannel` no unmount.
- **Ponto de extract:** novo — mas estudar `useRealtimeSubscription.ts` (debounce 2s não se aplica aqui).
- **Risco:** race condition entre fetch inicial e primeiros eventos realtime → mitigar com `matcher` id-based (dedupe por `id`).
- **Smoke:** test unit mockando supabase client, fire INSERT → cache tem item novo. UPDATE → item alterado. DELETE → item removido.

#### C20 — `refactor(chat): migrar useWhatsAppMessages para patched realtime`

- **Files:** `src/hooks/chat/useWhatsAppRealtime.ts` (modificado), `src/hooks/chat/useWhatsAppMessages.ts` (remove `refetchInterval: 20000`)
- **LOC:** -20 / +40
- **Ponto de extract:** dentro de `useWhatsAppMessagesRealtime`, substituir `refetchQueries` por `usePatchedRealtime({...})`:
  - `queryKey: ["whatsapp_messages", orgId, phone, instanceId]`
  - `matcher: (row, item) => row.id === item.id`
  - `mapInsert`: append + dedupe por `message_id` (idempotência já garantida server-side pelo commit `3066b5e`)
  - `mapUpdate`: replace in-place (status transitions: pending→sent→read)
- **Dependências:** C19.
- **Smoke:** envia mensagem no mockup v2, verifica que aparece sem fetch de rede (DevTools Network tab vazia após SUBSCRIBE).
- **Risco:** INSERTs duplicados (optimistic + realtime) — mitigação: dedupe por `message_id`.

#### C21 — `refactor(chat): migrar useWhatsAppContacts para patched realtime`

- **Files:** `src/hooks/chat/useWhatsAppRealtime.ts`
- **LOC:** +30 / -10
- **Ponto de extract:** substituir `refetchQueries(["whatsapp_contacts", orgId])` por `setQueryData` que atualiza `last_message`, `last_message_time`, `last_message_direction`, e incrementa `unread_count` quando `direction === 'incoming'` e chat não está aberto.
- **Dependências:** C19, C20.
- **Risco:** lógica de `unread_count` duplicada (hoje vive em `useConversationReadState`). Extrair para util compartilhada `src/hooks/chat/readState.util.ts` se necessário.
- **Smoke:** abre 2 abas, envia msg de outra conversa, verifica sidebar atualiza sem refetch.

#### C22 — `feat(chat): virtualização MessageList com @tanstack/react-virtual`

- **Files:** `src/components/chat/view/MessageList.tsx`
- **LOC:** +80 / -20
- **Ponto de extract:** substituir loop `{groupedMessages.map(...)}` por `virtualItems.map(...)`.
  - Threshold: `messages.length > 100` ativa virtualizer. `≤100` usa render normal (preservar grouping/unread/motion).
  - `estimateSize`: baseado em `density` (compact=64, comfortable=80, spacious=96).
  - **Preservar 100%** da lógica de grouping + unread divider + motion de Onda 1. Virtualizer opera sobre já-agrupado.
  - Fallback `window.innerWidth < 780` → render normal (mobile).
- **Dependências:** C18.
- **Risco alto:** scroll-to-bottom quebra com virtualizer → usar `scrollToIndex(items.length-1)`. `ScrollToBottomFab` continua funcional. Anchor de scroll em "ancoradoInBottom" muda — testar atentamente.
- **Smoke:** mockup v2 com 500 msgs mock. Scroll suave, grouping mantido, motion só em novas.

#### C23 — `feat(chat): virtualização ConversationList com @tanstack/react-virtual`

- **Files:** `src/components/chat/list/ConversationList.tsx`
- **LOC:** +60 / -15
- **Ponto de extract:** wrapper virtualizer em volta do `{contacts.map(...)}`. Threshold >50.
- **Dependências:** C18.
- **Risco baixo:** lista plana, sem grouping. Fixed height per item (density-aware).
- **Smoke:** mockup com 200 contatos.

#### C24 — `feat(command): CommandPalette base + provider + atalho ⌘K`

- **Files:**
  - `src/components/command/CommandPaletteProvider.tsx`
  - `src/components/command/CommandPalette.tsx`
  - `src/components/command/useCommandPalette.ts`
  - `src/components/command/commandRegistry.ts`
  - `src/App.tsx` (wrap `<AppRoutes>` com provider)
- **LOC:** +280
- **API provider:**
  ```ts
  interface CommandPaletteContext {
    isOpen: boolean;
    open: (initialQuery?: string) => void;
    close: () => void;
    toggle: () => void;
    /** Registrar comandos context-aware; retorna fn de unregister */
    register: (groupId: string, commands: Command[]) => () => void;
  }
  interface Command {
    id: string;
    label: string;
    description?: string;
    icon?: LucideIcon;
    keywords?: string[];
    section: "navigation" | "conversations" | "actions" | "messages" | "settings";
    onSelect: () => void | Promise<void>;
    shortcut?: string[];
  }
  ```
- **Atalho global:** `useEffect` listener no `Provider` — `e.key === "k" && (e.metaKey || e.ctrlKey)` → `toggle()`. `e.preventDefault()`.
- **Guard:** palette só abre se `user` logado (useAuth). Provider renderizado sempre (sem auth = noop).
- **Persistência recent:** localStorage `cmd-palette-recent-${userId}` top-5, scoped por user.
- **Dependências:** nenhuma (cmdk instalado).
- **Risco:** conflito com `⌘K` de browser (Chrome Search) — verificar se `preventDefault` suficiente.
- **Smoke:** abrir `⌘K` em qualquer rota, digitar, fechar com `Esc`.

#### C25 — `feat(command): grupos Navigation + Actions + context-aware Conversations`

- **Files:**
  - `src/components/command/groups/CommandGroupNavigation.tsx`
  - `src/components/command/groups/CommandGroupActions.tsx`
  - `src/components/command/groups/CommandGroupConversations.tsx`
- **LOC:** +350
- **Navigation (sempre ativo):**
  - Dashboard, Leads, Pipe WhatsApp, Pipe Confirmação, Pipe Propostas, Copilot, Analytics, Campanhas, Automações, Configurações, Produtos, Equipe, Agenda.
  - `onSelect: () => navigate(path)`
- **Actions (sempre ativo):**
  - "Criar lead" → abre modal global (ou navegar `/leads?new=true`)
  - "Toggle dark mode" → `setTheme(theme === 'dark' ? 'light' : 'dark')`
  - "Abrir Copilot" → `/copilot`
- **Conversations (só ativo quando `pathname.startsWith('/chat')`):**
  - Registrado dinamicamente via `useEffect` dentro de `WhatsAppChat` (ou novo `<ChatCommandRegistrar>`).
  - Lista `contacts` como comandos, `onSelect` = `setSelectedPhone(phone)`.
  - Ações chat-scoped: "Toggle density", "Marcar como lido", "Arquivar conversa", "Ver lead".
- **Dependências:** C24.
- **Smoke:** navegar via `⌘K → "Analytics"`. Em `/chat`, `⌘K → "Rodrigo"` seleciona contato.

#### C26 — `feat(command): recent commands localStorage top-5 por usuário`

- **Files:** `src/components/command/recentCommands.ts` + integração em `CommandPalette.tsx`
- **LOC:** +80
- **API:**
  ```ts
  function pushRecent(userId: string, commandId: string): void
  function getRecent(userId: string): string[]  // top 5, ordem mru
  function clearRecent(userId: string): void
  ```
- **Key:** `cmd-palette-recent-${userId}`, JSON array de ids.
- **UI:** quando query vazia, seção "Recentes" renderiza no topo.
- **Dependências:** C24, C25.
- **Smoke:** abrir, selecionar "Analytics", fechar, reabrir → "Analytics" no topo.

#### C27 — `feat(command): integração mockup v2 + keyboard navigation polish`

- **Files:** `src/pages/MockupChatV2.tsx` (botão demo "Abrir ⌘K" + seed comandos mock)
- **LOC:** +80
- **Smoke:** rota `/_mockup/chat-v2` demo ⌘K funciona sem auth (provider detecta ambiente mockup e injeta comandos fake).

#### C28 — `test(chat): unit tests usePatchedRealtime + useVirtualList + CommandPalette`

- **Files:** `src/hooks/chat/__tests__/usePatchedRealtime.test.ts`, `src/components/command/__tests__/CommandPalette.test.tsx`
- **LOC:** +300
- **Cobertura:**
  - `usePatchedRealtime`: mock supabase channel, dispara INSERT/UPDATE/DELETE, verifica `setQueryData`.
  - `CommandPalette`: abre com `⌘K`, filtra fuzzy, seleciona com Enter, persiste recent.
  - `useVirtualList`: estima size correto por density, overscan.
- **Dependências:** C19, C18, C24.

---

### Fase 2b.2 — Takeover + Search + Split (commits 11-23, ~120h)

#### C29 — `feat(chat,db): migration ai_state enum + column em conversations`

- **Files:** `supabase/migrations/20260501000000_add_ai_state_to_conversations.sql`
- **SQL:**
  ```sql
  -- Enum type
  DO $$ BEGIN
    CREATE TYPE public.ai_takeover_state AS ENUM (
      'AI_ACTIVE',
      'AI_PAUSED_MANUAL',
      'WAITING_HUMAN',
      'HUMAN_ACTIVE',
      'HANDOFF_BACK'
    );
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  -- Column
  ALTER TABLE public.conversations
    ADD COLUMN IF NOT EXISTS ai_state public.ai_takeover_state NOT NULL DEFAULT 'AI_ACTIVE';

  -- Backfill idempotente
  UPDATE public.conversations SET ai_state = 'AI_ACTIVE' WHERE ai_state IS NULL;

  -- Index p/ filtro de inbox "esperando humano"
  CREATE INDEX IF NOT EXISTS idx_conversations_ai_state_org
    ON public.conversations (organization_id, ai_state)
    WHERE ai_state IN ('WAITING_HUMAN', 'HUMAN_ACTIVE');

  -- Trigger updated_at já existe — não tocar
  ```
- **Ponto crítico:** coluna distinta de `state` (usado pelo copilot). Não fundir.
- **Dependências:** nenhuma.
- **Smoke:** `supabase db reset` local, `SELECT column_name FROM information_schema.columns WHERE table_name='conversations'` contém `ai_state`.
- **Regenerar types:** `supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts` (dev env primeiro).

#### C30 — `feat(chat): useTakeover hook + chat-types`

- **Files:** `src/lib/chat-types.ts` (novo), `src/hooks/chat/useTakeover.ts` (novo)
- **LOC:** +180
- **API:**
  ```ts
  // chat-types.ts
  export type AiState = "AI_ACTIVE" | "AI_PAUSED_MANUAL" | "WAITING_HUMAN" | "HUMAN_ACTIVE" | "HANDOFF_BACK";
  export type PauseMode = "immediate" | "after_response" | "dont_resume";

  // useTakeover.ts
  function useTakeover(conversationId: string | null): {
    state: AiState | undefined;
    isLoading: boolean;
    pauseAi: (mode: PauseMode) => Promise<void>;
    resumeAi: () => Promise<void>;
    markWaitingHuman: () => Promise<void>;
    markHandoffBack: () => Promise<void>;
  }
  ```
- **Query:** `useQuery(["conversation_ai_state", conversationId])` lendo `conversations.ai_state`.
- **Mutations:** `UPDATE conversations SET ai_state = $1 WHERE id = $2 AND organization_id = $3`. Guards no hook (ver §4).
- **Dependências:** C29.
- **Risco:** transições inválidas devem ser bloqueadas client-side **e** server-side (ver C31 — guard SQL).

#### C31 — `feat(chat,db): guard SQL pra transições de ai_state`

- **Files:** `supabase/migrations/20260501000003_ai_state_transition_guard.sql`
- **SQL:**
  ```sql
  CREATE OR REPLACE FUNCTION public.enforce_ai_state_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
  DECLARE
    allowed boolean := FALSE;
  BEGIN
    IF NEW.ai_state = OLD.ai_state THEN RETURN NEW; END IF;

    -- Tabela de transições permitidas
    allowed := (OLD.ai_state, NEW.ai_state) IN (
      ('AI_ACTIVE', 'AI_PAUSED_MANUAL'),
      ('AI_ACTIVE', 'WAITING_HUMAN'),
      ('AI_PAUSED_MANUAL', 'AI_ACTIVE'),
      ('AI_PAUSED_MANUAL', 'HUMAN_ACTIVE'),
      ('WAITING_HUMAN', 'HUMAN_ACTIVE'),
      ('WAITING_HUMAN', 'AI_ACTIVE'),
      ('HUMAN_ACTIVE', 'HANDOFF_BACK'),
      ('HUMAN_ACTIVE', 'AI_PAUSED_MANUAL'),
      ('HANDOFF_BACK', 'AI_ACTIVE')
    );

    IF NOT allowed THEN
      RAISE EXCEPTION 'Invalid ai_state transition: % -> %', OLD.ai_state, NEW.ai_state;
    END IF;

    RETURN NEW;
  END $$;

  DROP TRIGGER IF EXISTS trg_enforce_ai_state_transition ON public.conversations;
  CREATE TRIGGER trg_enforce_ai_state_transition
    BEFORE UPDATE OF ai_state ON public.conversations
    FOR EACH ROW
    WHEN (OLD.ai_state IS DISTINCT FROM NEW.ai_state)
    EXECUTE FUNCTION public.enforce_ai_state_transition();
  ```
- **Dependências:** C29.
- **Smoke:** tentar `UPDATE conversations SET ai_state = 'HUMAN_ACTIVE' WHERE ai_state = 'AI_ACTIVE'` → deve falhar. Aplicar sequência correta → OK.

#### C32 — `feat(chat): TakeoverControls (pill + dropdown)`

- **Files:** `src/components/chat/takeover/TakeoverControls.tsx`, `src/components/chat/takeover/aiStateLabels.ts`
- **LOC:** +180
- **Props:**
  ```ts
  interface TakeoverControlsProps {
    conversationId: string | null;
    compact?: boolean;  // pill-only se true
  }
  ```
- **UI:**
  - Pill com cor + label do estado:
    - `AI_ACTIVE` → verde, "IA ativa"
    - `AI_PAUSED_MANUAL` → amarelo, "IA pausada"
    - `WAITING_HUMAN` → laranja, "Esperando você"
    - `HUMAN_ACTIVE` → azul, "Você assumiu"
    - `HANDOFF_BACK` → roxo, "Retornando à IA"
  - DropdownMenu com ações condicionadas ao estado (ver §4 guards):
    - "Pausar IA — agora" (só em `AI_ACTIVE`)
    - "Pausar IA — após resposta"
    - "Não retomar automaticamente"
    - "Retomar IA" (só em `HUMAN_ACTIVE` ou `AI_PAUSED_MANUAL`)
    - "Assumir conversa" (em `WAITING_HUMAN`)
- **Integração:** `ChatHeader` recebe `conversationId` e renderiza `<TakeoverControls>` se fornecido.
- **Dependências:** C30.
- **Smoke:** mockup v2 com conversationId mock, todas transições testadas.

#### C33 — `feat(chat): useAITimeline + AITimeline component`

- **Files:** `src/hooks/chat/useAITimeline.ts`, `src/components/chat/takeover/AITimeline.tsx`
- **LOC:** +240
- **Query:**
  ```ts
  supabase.from("lead_history")
    .select("id, action, description, metadata, created_at, entity_type, entity_id")
    .eq("lead_id", leadId)
    .eq("organization_id", orgId)
    .like("action", "ai_%")
    .order("created_at", { ascending: false })
    .limit(50);
  ```
- **Tipos de evento:**
  - `ai_message_sent` — IA enviou msg (icon MessageSquare, label azul)
  - `ai_action_executed` — ação executada (icon Zap, label roxo, show metadata.action_type)
  - `ai_handoff_to_human` — transferiu (icon UserPlus, label laranja)
  - `ai_silence_timeout` — não respondeu em X min (icon Clock, label cinza)
  - `ai_paused` / `ai_resumed` — mudanças de takeover (label verde/amarelo)
- **UI:** cards compactos com timestamp relativo (date-fns formatDistanceToNow), expand para detalhes (metadata JSON formatado).
- **Integração:** `ContextPanelInfo` inclui `<AITimeline leadId={lead.id}>` como seção.
- **Dependências:** C30 (não bloqueante na prática — pode vir antes).
- **Risco:** `lead_history` pode ter muito volume → `limit 50` + "Ver mais" paginado. Considerar `stale_time: 30_000`.

#### C34 — `feat(chat,db): migration full-text search em conversation_messages`

- **Files:** `supabase/migrations/20260501000001_conversation_messages_search_tsv.sql`
- **SQL:**
  ```sql
  -- Generated column tsvector
  ALTER TABLE public.conversation_messages
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(content, ''))) STORED;

  -- GIN index
  CREATE INDEX IF NOT EXISTS idx_conversation_messages_search_tsv
    ON public.conversation_messages USING GIN (search_tsv);

  -- Também indexar por conversation_id + created_at pra paginar results
  CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_created
    ON public.conversation_messages (conversation_id, created_at DESC);
  ```
- **Por quê `conversation_messages` e não `whatsapp_messages`?**
  Produto futuro multi-canal. `conversation_messages` é a fonte canônica (copilot). Em paralelo, Onda 2c pode replicar no `whatsapp_messages` se performance exigir. Hoje o chat principal usa `whatsapp_messages` — ver §5 para nota de execução.
- **Decisão explícita:** **fazer search em `whatsapp_messages` também** porque é a tabela que WhatsAppChat consome. Ajuste abaixo.

- **SQL revisado (C34 real):**
  ```sql
  -- Em whatsapp_messages (conteúdo real do chat WhatsApp)
  ALTER TABLE public.whatsapp_messages
    ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(content, ''))) STORED;

  CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_search_tsv
    ON public.whatsapp_messages USING GIN (search_tsv);
  ```
- **Dependências:** nenhuma.
- **Risco:** STORED → aumenta disk footprint ~30% da coluna `content`. ~30 orgs, volume baixo hoje. OK.
- **Smoke:** `EXPLAIN ANALYZE SELECT ... WHERE search_tsv @@ websearch_to_tsquery('portuguese', 'proposta')` — deve usar `idx_...`.

#### C35 — `feat(chat,db): RPC search_messages com RLS enforcement`

- **Files:** `supabase/migrations/20260501000002_rpc_search_messages.sql`
- **SQL:**
  ```sql
  CREATE OR REPLACE FUNCTION public.search_messages(
    p_org_id uuid,
    p_query text,
    p_limit int DEFAULT 20,
    p_offset int DEFAULT 0
  )
  RETURNS TABLE (
    id uuid,
    phone_number text,
    content text,
    direction text,
    "timestamp" timestamptz,
    instance_id uuid,
    lead_id uuid,
    headline text,
    rank real
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  BEGIN
    -- Guard: usuário pertence à org
    IF NOT EXISTS (
      SELECT 1 FROM public.team_members
      WHERE user_id = auth.uid()
        AND organization_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'access_denied';
    END IF;

    -- Guard: query mínima
    IF length(trim(coalesce(p_query, ''))) < 3 THEN
      RAISE EXCEPTION 'query_too_short';
    END IF;

    RETURN QUERY
    SELECT
      m.id,
      m.phone_number,
      m.content,
      m.direction,
      m."timestamp",
      m.instance_id,
      m.lead_id,
      ts_headline(
        'portuguese',
        m.content,
        websearch_to_tsquery('portuguese', p_query),
        'StartSel=<mark>,StopSel=</mark>,MaxWords=20,MinWords=5'
      ) AS headline,
      ts_rank(m.search_tsv, websearch_to_tsquery('portuguese', p_query)) AS rank
    FROM public.whatsapp_messages m
    WHERE m.organization_id = p_org_id
      AND m.search_tsv @@ websearch_to_tsquery('portuguese', p_query)
    ORDER BY rank DESC, m."timestamp" DESC
    LIMIT p_limit
    OFFSET p_offset;
  END;
  $$;

  GRANT EXECUTE ON FUNCTION public.search_messages(uuid, text, int, int) TO authenticated;
  REVOKE EXECUTE ON FUNCTION public.search_messages(uuid, text, int, int) FROM anon, public;
  ```
- **Rate limit:** considerar via `rate_limits` table (já existe em migration `20260909200000_create_rate_limits.sql`) — 30 req/min por user. Aplicar no client-side com debounce + server-side idealmente. **Backlog Onda 2c** se for crítico.
- **Dependências:** C34.
- **Smoke:** user em org A busca, verifica RLS bloqueia acesso a msgs da org B.

#### C36 — `feat(chat): useMessageSearch hook com debounce 300ms`

- **Files:** `src/hooks/chat/useMessageSearch.ts`
- **LOC:** +80
- **API:**
  ```ts
  function useMessageSearch(query: string, opts?: { limit?: number }): {
    results: SearchResult[];
    isSearching: boolean;
    error: Error | null;
  }
  ```
- **Debounce:** 300ms via `useDebouncedValue(query, 300)`.
- **Query:** `useQuery({ queryKey: ["search_messages", orgId, debouncedQuery], enabled: debouncedQuery.length >= 3, queryFn: () => supabase.rpc("search_messages", ...) })`.
- **Dependências:** C35.

#### C37 — `feat(command): grupo Messages full-text search no ⌘K`

- **Files:** `src/components/command/groups/CommandGroupMessages.tsx`
- **LOC:** +150
- **Integração:** quando `query.length > 3`, seção "Mensagens" renderiza top-10 resultados com `headline` (HTML seguro via `dangerouslySetInnerHTML` com sanitização — já vem sanitizado do `ts_headline` porque só contém `<mark>`).
- **onSelect:** navega para `/chat?phone=${phone_number}&highlight=${msg_id}`.
- **Dependências:** C36, C24.
- **Smoke:** no `⌘K` digitar "proposta" — lista mensagens.

#### C38 — `feat(chat): rota /chat/search opcional com resultado paginado`

- **Files:** `src/pages/ChatSearch.tsx`, `src/App.tsx` (rota protegida)
- **LOC:** +180
- **Escopo:** página dedicada quando resultados > 10, com infinite scroll. Opcional — pode ficar pra backlog se scope apertar.

#### C39 — `refactor(lead): split LeadDetailContent em header + tabs + notes`

- **Files (novos):**
  - `src/components/lead/LeadDetailContent.tsx` (shell ~200 LOC — tabs + composition)
  - `src/components/lead/header/LeadHeader.tsx`
  - `src/components/lead/tabs/LeadTabInfo.tsx`
  - `src/components/lead/tabs/LeadTabPipe.tsx`
  - `src/components/lead/tabs/LeadTabTags.tsx`
  - `src/components/lead/tabs/LeadTabProducts.tsx`
  - `src/components/lead/tabs/LeadTabHistory.tsx`
  - `src/components/lead/notes/LeadNotes.tsx`
- **Files (modificados):**
  - `src/components/chat/LeadDetailContent.tsx` → vira 1-liner re-export: `export { LeadDetailContent } from "@/components/lead/LeadDetailContent"` (zero mudança nos consumidores `WhatsAppChat.tsx:79` e `LeadContactModal.tsx:5`)
  - `src/components/chat/index.ts` → re-export ajustado
- **Mapping atual → novo:**

  | Seção atual (linhas) | Novo componente | Linhas alvo |
  |-----------------------|-----------------|-------------|
  | Estados + hooks (84-200) | `LeadDetailContent.tsx` | 80 |
  | Header (showHeader) (210-250 aprox) | `LeadHeader.tsx` | 100 |
  | Tab Info (699-794) | `LeadTabInfo.tsx` | 250 |
  | Tab Pipeline (797-954) | `LeadTabPipe.tsx` | 250 |
  | Tab Campanha (957-1005) | `LeadTabPipe.tsx` seção campanhas OR `LeadTabCampanhas.tsx` (separado) | 120 |
  | Tab History (1008-1034) | `LeadTabHistory.tsx` | 200 |
  | Tags (dentro de Info) | `LeadTabTags.tsx` | 120 |
  | Products | `LeadTabProducts.tsx` (nova aba — não existe hoje, escopo Onda 2b ou 3) | 150 |
  | Notes (dentro de Info?) | `LeadNotes.tsx` | 100 |

- **Regras duras:**
  - Props do shell **idênticas** às atuais (`phoneNumber`, `pushName`, `onClose`, `showHeader`).
  - Cada tab é autônoma — consome hooks próprios (não passar `lead` por prop caindo). Usa `useLeadByPhone(phoneNumber)` ou `useLead(leadId)` internamente.
  - Estado local (activeTab) permanece no shell.
  - Zero mudança de UX nesta commit — refactor puro.
- **LOC:** redistribuição, delta ~0 líquido (pode +100 por boilerplate de imports).
- **Dependências:** nenhuma — independente de resto da 2b.
- **Risco alto:** shared state entre tabs hoje (edit mode + formData). Duas opções:
  1. **Manter no shell** (passa `formData` + `setFormData` por props para a tab Info). Simples mas menos decoupled.
  2. **Context local** `<LeadDetailProvider>` envolve as tabs. Mais limpo.
  **Decisão:** opção 1. Menos invasivo. Context fica para Onda 2c se dor aparecer.
- **Smoke:** abrir `LeadContactModal` e `WhatsAppChat` em produção-like, todas tabs renderizam iguais. Comparar screenshots antes/depois.

#### C40 — `feat(chat): ContextPanelInfo integra LeadTabInfo + AITimeline`

- **Files:** `src/components/chat/context-panel/ContextPanelInfo.tsx` (era stub) → renderiza `<LeadHeader>` + seções resumidas + `<AITimeline>`.
- **LOC:** +100 / -30
- **Dependências:** C33, C39.

#### C41 — `feat(chat): ContextPanelPipe/Tags/History consomem componentes reais`

- **Files:**
  - `src/components/chat/context-panel/ContextPanelPipe.tsx` → `<LeadTabPipe leadId={...} />`
  - `src/components/chat/context-panel/ContextPanelTags.tsx` → `<LeadTabTags leadId={...} />`
  - `src/components/chat/context-panel/ContextPanelHistory.tsx` → `<LeadTabHistory leadId={...} />`
- **LOC:** +40 cada (+120 total)
- **Dependências:** C39.

#### C42 — `feat(chat): MockupChatV2 atualizado com TakeoverControls + AITimeline + search demo`

- **Files:** `src/pages/MockupChatV2.tsx`
- **LOC:** +150 / -20
- **Mudanças:**
  - Botão "Abrir ⌘K" demo (C27 já adicionou — refinar)
  - `<TakeoverControls>` com state mock controlado por toggle no topo
  - `<AITimeline>` com 5 events mock (ai_message_sent, ai_action_executed, ai_silence_timeout, ai_paused, ai_resumed)
  - Input de busca no topo que abre `⌘K` com query pré-preenchida "proposta" → mostra highlights
- **Dependências:** C24, C32, C33, C37.

#### C43 — `feat(chat): feature flag VITE_CHAT_ONDA_2B + ativação em /chat`

- **Files:** `.env.example`, `src/pages/ChatWhatsApp.tsx` (condicional), `src/components/chat/WhatsAppChatV2Shell.tsx` (novo — wrapper que usa `<ChatShell>` com hooks reais)
- **LOC:** +200
- **Lógica:**
  ```tsx
  const useV2 = import.meta.env.VITE_CHAT_ONDA_2B === "true";
  return useV2 ? <WhatsAppChatV2Shell /> : <WhatsAppChat />;
  ```
- **Escopo v2 shell:** liga `ChatShell` aos hooks reais (`useWhatsAppMessages`, `useWhatsAppContacts`, `useTakeover`, `usePatchedRealtime`). Substitui as colunas do mockup por componentes reais.
- **Dependências:** todo commits anteriores.
- **Smoke:** com flag off → produção 100% igual. Com flag on em dev → nova UI.

#### C44 — `test(chat): integration tests takeover + search + palette`

- **Files:**
  - `tests/integration/chat-takeover.test.ts` — transições FSM, guard SQL bloqueia inválidas
  - `tests/integration/chat-search.test.ts` — RPC search retorna, cross-org bloqueia
  - `src/components/command/__tests__/CommandPalette.integration.test.tsx`
- **LOC:** +400
- **Smoke:** CI passa.

#### C45 — `docs(chat): Obsidian + STATE.md + ADR 2b`

- **Files:**
  - `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/chat/onda-2b.md`
  - `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisoes/ADR-XXX-fsm-ai-takeover.md`
  - `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisoes/ADR-XXX-patched-realtime.md`
  - `.specs/project/STATE.md`

---

## 4. FSM Takeover — transições + guards

### Diagrama ASCII

```
                   ┌───────────────────────────┐
                   │        AI_ACTIVE           │ ← default
                   │  (IA respondendo sozinha)  │
                   └──┬──────────┬──────────────┘
      pauseAi(manual) │          │ markWaitingHuman()
                      ▼          ▼
        ┌──────────────────────┐ ┌─────────────────────────┐
        │  AI_PAUSED_MANUAL    │ │    WAITING_HUMAN        │
        │   (humano pausou     │ │  (IA pediu handoff,     │
        │     manualmente)     │ │   aguardando humano)    │
        └──┬─────────┬─────────┘ └──┬───────────┬──────────┘
           │         │ humano       │           │
  resume() │         │ toma ação    │ humano    │ timeout
           │         ▼              │ toma      │ / revert
           │   ┌──────────────────────┐         │
           │   │    HUMAN_ACTIVE       │ ◄──────┘
           │   │  (humano operando     │
           │   │   conversa)           │
           │   └──┬───────┬────────────┘
           │      │       │ markHandoffBack()
           │      │       ▼
           │      │   ┌─────────────────────┐
           │      │   │   HANDOFF_BACK      │
           │      │   │  (retornando pra IA) │
           │      │   └──────┬──────────────┘
           │      │          │ auto ou confirm
           │      │          ▼
           └──────┴──────► AI_ACTIVE
```

### Tabela de transições permitidas

| De | Para | Trigger (hook) | Quem pode |
|----|------|---------------|-----------|
| `AI_ACTIVE` | `AI_PAUSED_MANUAL` | `pauseAi('immediate'\|'after_response'\|'dont_resume')` | admin, member |
| `AI_ACTIVE` | `WAITING_HUMAN` | server-side (edge function `agent-message` detecta objeção/pergunta fora de escopo) | service_role |
| `AI_PAUSED_MANUAL` | `AI_ACTIVE` | `resumeAi()` | admin, member |
| `AI_PAUSED_MANUAL` | `HUMAN_ACTIVE` | humano envia mensagem manual (auto via `useWhatsAppSend`) | admin, member |
| `WAITING_HUMAN` | `HUMAN_ACTIVE` | humano assume (`markHumanActive()` OR envia msg) | admin, member |
| `WAITING_HUMAN` | `AI_ACTIVE` | admin revert ("descartar handoff") | admin |
| `HUMAN_ACTIVE` | `HANDOFF_BACK` | `markHandoffBack()` | admin, member |
| `HUMAN_ACTIVE` | `AI_PAUSED_MANUAL` | `pauseAi('dont_resume')` — humano quer sair sem handoff | admin, member |
| `HANDOFF_BACK` | `AI_ACTIVE` | auto após IA confirmar sync (edge function) ou manual após N segundos | service_role, admin |

### Guards

- **Client-side** (hook `useTakeover`): função `canTransition(current, target): boolean` consulta matriz. UI desabilita ações inválidas.
- **Server-side**: trigger SQL `enforce_ai_state_transition` (C31) rejeita `UPDATE` de transição inválida.
- **RLS**: `UPDATE` em `conversations.ai_state` já é org-scoped. Role-scoping (admin vs member) — se necessário — vai via `feature_permissions.can_takeover_conversation` (Onda 2c).

### Side effects por transição

| Transição | Side effect |
|-----------|-------------|
| `* → HUMAN_ACTIVE` | Cancelar scheduled messages da IA p/ esse lead (`scheduled_user_messages.assigned_to = ai`) |
| `AI_PAUSED_MANUAL → *` (qualquer) | Retomar scheduled messages |
| `* → WAITING_HUMAN` | Notificar inbox ("esperando você") — `assigned_to` → user que tem permissão |
| `HANDOFF_BACK → AI_ACTIVE` | Injetar no contexto da IA resumo do que humano fez (via `conversations.short_term_memory`) |

Side effects implementados em **edge function** `conversation-ai-state-changed` (novo, fora do escopo Onda 2b.1 — executado por trigger pg_net após UPDATE — backlog Onda 2c). Nesta onda, só a coluna + hook + UI + guard.

---

## 5. Estratégia full-text search — execução

### SQL completo

Ver C34 + C35 acima.

### Exemplo de query client

```ts
const { data, error } = await supabase.rpc("search_messages", {
  p_org_id: organizationId,
  p_query: "proposta comercial",
  p_limit: 20,
  p_offset: 0
});
// data: SearchResult[] com headline contendo <mark>...</mark>
```

### Considerações

- **`websearch_to_tsquery`** suporta sintaxe Google-like: `"proposta" OR contrato`, `-cancelada`, etc.
- **Idioma português**: requer `CREATE EXTENSION IF NOT EXISTS unaccent;` se quisermos search acento-insensível. Decisão: **não nesta onda** — stemming `portuguese` já lida com plurais/conjugação. Acentos tratados pelo stemmer. Escopo evolução.
- **Rate limit server-side:** por user, 30 req/min. Implementação via `rate_limits` table + `CREATE OR REPLACE FUNCTION check_rate_limit(...)`. **Backlog Onda 2c** — em 2b confiar no debounce client-side 300ms (já mitiga abuso casual).
- **Indexing custo**: GIN em `whatsapp_messages` com 30 orgs, volume médio ~1M msgs = ~200 MB index. Aceitável. Growth 10x → 2 GB, ainda OK. 100x → shard por org (hot vs cold).

### RLS e security

- RPC é `SECURITY DEFINER` (runs as owner, bypassa RLS da tabela) + guard explícito `EXISTS (SELECT 1 FROM team_members WHERE user_id = auth.uid())`.
- `GRANT EXECUTE ... TO authenticated` apenas.
- `REVOKE` `anon` e `public`.

---

## 6. Risco + mitigação por commit

| Commit | Risco | Severidade | Mitigação |
|--------|-------|------------|-----------|
| C18 | Bundle size aumenta | Baixa | `@tanstack/react-virtual` ~15KB gzipped. Aceitável. |
| C19 | Dead-letter de eventos se matcher falhar | Média | Fallback `invalidateQueries` quando `matcher` indefinido. Log warn em dev. |
| C20 | Duplicação optimistic+realtime | Alta | Dedupe por `message_id` em `mapInsert`. Test unit cobre. |
| C21 | `unread_count` desyncronizado | Média | Extrair util compartilhada com `useConversationReadState`. Test. |
| C22 | Scroll-to-bottom quebra virtualizer | Alta | Usar `scrollToIndex(last, { align: 'end' })` do API virtual. Smoke manual. |
| C22 | Motion não reaparece pra msgs novas | Média | Preservar `mountTime` check no render, virtualizer não interfere. |
| C23 | Item height dinâmico | Baixa | Fixed height per density, consistent. |
| C24 | `⌘K` browser conflict | Baixa | `preventDefault()`. Testar Chrome/Firefox/Safari. |
| C24 | Provider fora de router | Alta | Colocar dentro `<BrowserRouter>`, fora `<ProtectedRoute>`. Guard interno checa `user`. |
| C25 | Commands duplicados ao re-registrar | Média | `register` retorna `unregister`. `useEffect` cleanup. Set interno por id. |
| C26 | localStorage quota exceeded | Baixa | Max 5 items * ~50 bytes = 250 bytes. Desprezível. |
| C29 | `state` vs `ai_state` confusão | Alta | Naming disciplinado, doc explícita, code review obriga. |
| C29 | Migration em prod com ~1M rows | Baixa | Backfill com DEFAULT já aplicado via ALTER. Rápido. |
| C31 | Trigger bloqueia transição legítima | Alta | Tabela de transições documentada + test exaustivo (C44). |
| C32 | Pill estado desincronizado c/ server | Média | Subscrever realtime na conversa via `usePatchedRealtime`. Optimistic update no mutation. |
| C33 | `lead_history` muito volume | Média | `limit 50` + "Ver mais" paginado. `stale_time: 30_000`. |
| C34 | STORED column aumenta disk | Baixa | ~30% overhead da col content. OK em 30 orgs. |
| C34 | GIN rebuild em prod lento | Média | `CREATE INDEX CONCURRENTLY` no Supabase se migration for em tabela grande. (Supabase permite via SQL editor — migration CLI roda em transação, precisa separar CONCURRENTLY.) |
| C35 | RPC cross-org leak | Crítica | Guard explícito `EXISTS (team_members WHERE user_id = auth.uid() AND organization_id = p_org_id)`. Test integration. |
| C35 | DoS via query pesada | Média | Rate limit backlog 2c. Client debounce 300ms. `LIMIT 20` default. |
| C36 | Debounce não cancela request em flight | Baixa | `useQuery` com `keepPreviousData: false`. |
| C37 | XSS via headline | Alta | `ts_headline` retorna só `<mark>...</mark>` + conteúdo ORIGINAL (não escapado). Sanitizar via DOMPurify ou renderizar `<mark>` manualmente com escape do resto. **Decisão: escape manual** — parse `<mark>...</mark>` e renderizar só esses tags. |
| C39 | Regressão em `LeadDetailContent` | Alta | API preserved, re-export, screenshot test, manual smoke em `/chat` e `LeadContactModal`. |
| C39 | Lazy-load aumenta FCP chat | Baixa | Não lazy aqui (tabs render juntos no tabs component). |
| C43 | Flag off → feature latente em bundle | Baixa | Tree-shaking remove código não-importado se dynamic import. Aceitar 50KB extra. |

---

## 7. Ordem de execução — grafo de dependência

```
                     C18 (virtual dep)
                    /              \
                  C22              C23
                   │                │
                   └──── (indep) ───┘

                     C19 (patched)
                      │
              ┌───────┴───────┐
             C20             C21
              │               │
              └──── (indep) ──┘

                     C24 (⌘K core)
                      │
                      ├─ C25 (groups base)
                      │       │
                      │      C26 (recent)
                      │       │
                      │      C27 (mockup demo)
                      │
                      └─ C37 (messages group) ← precisa C36

                     C29 (ai_state column)
                      │
                      ├─ C30 (hook)
                      │     │
                      │    C32 (controls UI)
                      │
                      └─ C31 (SQL guard)

                     C33 (AITimeline)   ← opcional após C30

                     C34 (tsvector)
                      │
                     C35 (RPC)
                      │
                     C36 (hook)
                      │
                    ┌─┴──┐
                   C37   C38(opt)

                     C39 (LeadDetailContent split)
                      │
                      ├─ C40 (ContextPanelInfo + AITimeline)   ← precisa C33
                      └─ C41 (ContextPanelPipe/Tags/History)

                     C42 (mockup v2 update)    ← precisa C32, C33, C37
                     C43 (flag + /chat v2)     ← precisa todos
                     C44 (tests)                ← paralelo com C43
                     C45 (docs)                 ← último
```

### Linha do tempo sugerida

- **Sprint 1 (40h) — Onda 2b.1 parte A:** C18, C19, C20, C21, C22, C23.
  - Entrega: patched realtime + virtualização em produção flag-off. Ganho interno.
- **Sprint 2 (40h) — Onda 2b.1 parte B:** C24, C25, C26, C27, C28.
  - Entrega: `⌘K` disponível globalmente. Ship seguro — sem dependência de backend.
- **Sprint 3 (40h) — Onda 2b.2 parte A:** C29, C30, C31, C32, C33.
  - Entrega: takeover FSM + UI funcional em mockup.
- **Sprint 4 (40h) — Onda 2b.2 parte B:** C34, C35, C36, C37, C38.
  - Entrega: search full-text via `⌘K`.
- **Sprint 5 (40h) — Onda 2b.2 parte C:** C39, C40, C41, C42, C43, C44, C45.
  - Entrega: refactor + flag-on `/chat`.

**Total: 200h ± 20%.**

---

## 8. Backwards compatibility

### Regras duras

1. **`WhatsAppChat.tsx` em produção continua funcional** — flag off default.
2. **`LeadDetailContent` API preservada** — consumidores `WhatsAppChat:79` e `LeadContactModal:5` não mudam. Re-export em `src/components/chat/LeadDetailContent.tsx`.
3. **Mockups `/_mockup/chat` e `/_mockup/chat-v2` preservados** — zero breaking em rotas demo.
4. **Hooks `useWhatsAppMessages` / `useWhatsAppContacts`** — assinatura pública idêntica. Mudança interna (patched realtime substitui refetch).
5. **Migrations idempotentes** — `IF NOT EXISTS` em tudo. `DO $$ ... EXCEPTION WHEN duplicate ...$$` em enums.
6. **`conversations.ai_state` default `AI_ACTIVE`** — conversas antigas imediatamente válidas pós-migration.

### Feature flag

`.env.example`:
```bash
# Chat Onda 2b — ativa ChatShell novo em /chat (dev/staging)
# Valores: "true" | "false" (default: "false")
VITE_CHAT_ONDA_2B=false
```

Consumo:
```ts
const CHAT_ONDA_2B = import.meta.env.VITE_CHAT_ONDA_2B === "true";
```

**Produção segura por default.** Habilitada em dev e staging. Flip em prod apenas após QA full + soak period.

### Migração gradual

- Fase α: flag `false` global — todos os módulos novos carregam mas só mockup/rota v2 usam.
- Fase β (staging): flag `true` em `bcfadphgsibjzivtbjvc`, testar 2 semanas.
- Fase γ (prod 1 org): Milennials (`6030520a-...`) com override via user metadata.
- Fase δ (prod all): flip global.

---

## 9. Coisas fora de escopo desta onda (backlog Onda 2c)

- Rate limit server-side em `search_messages`
- Edge function `conversation-ai-state-changed` (side effects de transição: cancelar scheduled, notify inbox)
- Role-based guard em takeover (`feature_permissions.can_takeover_conversation`)
- Search em `conversation_messages` (quando copilot for fonte primária)
- Virtualização mobile (<780px) — hoje fallback render normal
- Analytics de `⌘K` usage (track comandos mais usados → otimizar top-5)
- Múltiplos pin de conversas ("fixar")
- Split avançado `LeadTabInfo` em subseções quando crescer >300 LOC
- `ts_headline` com snippet multi-resultado por mensagem longa

---

## 10. Appendix — referências cruzadas

### Arquivos tocados por Onda 2b (22 novos, 11 modificados)

**Novos (22):**
```
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/usePatchedRealtime.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/useTakeover.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/useMessageSearch.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/useAITimeline.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/useVirtualList.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/lib/chat-types.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/CommandPalette.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/CommandPaletteProvider.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/useCommandPalette.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/commandRegistry.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/recentCommands.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/groups/CommandGroupNavigation.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/groups/CommandGroupConversations.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/groups/CommandGroupActions.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/command/groups/CommandGroupMessages.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/takeover/TakeoverControls.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/takeover/AITimeline.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/takeover/aiStateLabels.ts
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/LeadDetailContent.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/header/LeadHeader.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/tabs/LeadTabInfo.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/tabs/LeadTabPipe.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/tabs/LeadTabTags.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/tabs/LeadTabProducts.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/tabs/LeadTabHistory.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/lead/notes/LeadNotes.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/WhatsAppChatV2Shell.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/pages/ChatSearch.tsx  (opcional)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/supabase/migrations/20260501000000_add_ai_state_to_conversations.sql
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/supabase/migrations/20260501000001_conversation_messages_search_tsv.sql
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/supabase/migrations/20260501000002_rpc_search_messages.sql
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/supabase/migrations/20260501000003_ai_state_transition_guard.sql
```

**Modificados (11):**
```
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/package.json                              (+@tanstack/react-virtual)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/.env.example                              (+VITE_CHAT_ONDA_2B)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/App.tsx                               (+CommandPaletteProvider wrap)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/useWhatsAppRealtime.ts     (patched migration)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/hooks/chat/useWhatsAppMessages.ts     (remove refetchInterval)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/view/MessageList.tsx  (virtualização)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/list/ConversationList.tsx (virtualização)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/context-panel/ContextPanelInfo.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/context-panel/ContextPanelPipe.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/context-panel/ContextPanelTags.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/context-panel/ContextPanelHistory.tsx
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/LeadDetailContent.tsx (→ re-export)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/index.ts              (barrel ajustado)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/pages/ChatWhatsApp.tsx                (flag switch)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/pages/MockupChatV2.tsx                (demos novas)
/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/integrations/supabase/types.ts        (regenerar)
```

### Principais hooks novos — quick reference

| Hook | Tabelas | Propósito |
|------|---------|-----------|
| `usePatchedRealtime` | qualquer | Wrapper realtime com `setQueryData` (cirúrgico) |
| `useTakeover` | `conversations` (ai_state) | FSM takeover hooks |
| `useMessageSearch` | RPC `search_messages` | Full-text debounced |
| `useAITimeline` | `lead_history` | Stream eventos IA |
| `useVirtualList` | — | Abstração `@tanstack/react-virtual` |
| `useCommandPalette` | — | Context do `⌘K` |

### Regras obrigatórias antes de merge final (Onda 2b)

1. `npm run lint` zero warnings novos.
2. `npm run test:unit` 100% passando incluindo 3 novos test suites.
3. `npm run test:integration` com `supabase start` — migrations aplicam limpo.
4. `npm run test:e2e` smoke em `/_mockup/chat-v2`.
5. Security review de RPC `search_messages` + trigger `enforce_ai_state_transition` (veto possível).
6. DBA review de indices novos em `whatsapp_messages` (tamanho + CONCURRENTLY em prod).
7. Screenshots comparativos `LeadContactModal` antes/depois do split.

---

**Fim do plano. Próximo passo:** Conductor revisa, despacha DBA para validar migrations (C29, C31, C34, C35), Security para review da RPC + guard + XSS em headline (C35, C37), Backend para validar API de `usePatchedRealtime` (C19), e só depois dispara Frontend/QA pra execução em sprints.
