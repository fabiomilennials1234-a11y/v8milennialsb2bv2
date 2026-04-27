# Chat — Onda 2a — Refactor Plan (Architect)

> Spec autoral do Architect para splitar os god-components de `src/components/chat/` em 17 commits atômicos, sem regressão funcional, preservando 100% dos wins da Onda 1 e mantendo backwards-compat com `EmbeddedChatWindow` e páginas existentes.

- **Branch**: `feat/chat-ux-ui-redesign`
- **Pré-requisito**: Onda 1 mergeada (13 commits de quick wins já em branch/main)
- **Escopo**: estrutural. **Não** introduz features novas; reorganiza, extrai, documenta. Density mode é único comportamento novo e vive atrás de feature flag local (toggle no header).
- **Non-goals**: `LeadDetailContent.tsx` (1040 LOC) fica intocado nesta onda; pipeline panel redesenho é Onda 2b; bubble visual final é Onda 2 (tokens já caem aqui em `9`, mas polish visual vem depois).

---

## 1. Inventário atual

### 1.1 `src/components/chat/WhatsAppChat.tsx` (2627 LOC)

Componentes internos e helpers públicos, extraídos via `grep -n "^function\|^export function\|^const [A-Z].*=>\|^export class"`:

| Linha | Símbolo | Tipo | Exportado | Destino na Onda 2a |
|------:|---------|------|:---------:|--------------------|
| 141 | `getAudioPlaybackUrl` | helper | sim | `media/AudioPlayer.tsx` (co-locado) |
| 156 | `MessagesAreaErrorBoundary` | class component | sim | `view/MessageList.tsx` (co-locado + export) |
| 183 | `formatMessageTime` | helper | sim | `lib/chat-time.ts` (util) |
| 196 | `formatContactTime` | helper | privado | `lib/chat-time.ts` |
| 209 | `MessageStatusIcon` | component | sim | `view/MessageStatusIcon.tsx` ou co-locado em `MessageBubble` |
| 228 | `contactDisplayName` | helper | privado | `list/ConversationListItem.tsx` |
| 232 | `ContactList` | component | privado | `list/ConversationList.tsx` |
| 558 | `ContactContextMenu` | component | privado | `list/ConversationListItem.tsx` (co-locado) |
| 707 | `AudioPlayer` | component | privado | `media/AudioPlayer.tsx` |
| 946 | `MessageImage` | component | privado | `media/MessageMedia.tsx` |
| 986 | `MessageVideo` | component | privado | `media/MessageMedia.tsx` |
| 1019 | `MessageDocument` | component | privado | `media/MessageMedia.tsx` |
| 1077 | `MessageBubble` | component | **sim** | `MessageBubble.tsx` (fica em `components/chat/` — consumido por `EmbeddedChatWindow`) |
| 1232 | `AudioRecorder` | component | **sim** | `media/AudioRecorder.tsx` |
| 1376 | `ImagePreviewModal` | component | **sim** | `media/ImagePreviewModal.tsx` |
| 1408 | `ChatWindow` | component | privado | **dissolvido** entre `layout/ChatShell` + `view/ChatHeader` + `view/MessageList` + `composer/ChatComposer` |
| 2255 | `normalizePhoneForStorage` | helper | privado | `lib/chat-phone.ts` |
| 2264 | `normalizePhoneForParam` | helper | privado | `lib/chat-phone.ts` |
| 2276 | `getInstanceStorageKey` | helper | privado | `lib/chat-instance-storage.ts` |
| 2281 | `WhatsAppChat` | page-shell | **sim** | `WhatsAppChat.tsx` (reduzido a <200 LOC, consome `ChatShell`) |

Dependências internas (quem chama quem, dentro do arquivo):

- `WhatsAppChat` → `ContactList`, `ChatWindow`, `LeadDetailContent` (externo), `WhatsAppSettings` (externo)
- `ChatWindow` → `ScheduledMessagesBanner` (externo), `ConversationNotes` (externo), `MessageBubble`, `UnreadDivider` (externo), `ChatEmptyState` (externo), `ScrollToBottomFab` (externo), `SlashCommandPopover` (externo), `ScheduleMessageModal` (externo), `AudioRecorder`, `ImagePreviewModal`, `MessagesAreaErrorBoundary`, `ChannelBadge` (externo)
- `ContactList` → `ContactContextMenu`, `ChannelBadge` (externo)
- `MessageBubble` → `AudioPlayer`, `MessageImage`, `MessageVideo`, `MessageDocument`, `MessageStatusIcon`, `formatMessageTime`, `getAudioPlaybackUrl`

### 1.2 `src/hooks/useWhatsAppChat.ts` (1202 LOC) — exports

| Linha | Símbolo | Tipo | Destino |
|------:|---------|------|---------|
| 22 | `WhatsAppMessage` | interface | `hooks/chat/types.ts` |
| 43 | `FailedMessage` | interface | `hooks/chat/types.ts` |
| 58 | `ChatContactTag` | interface | `hooks/chat/types.ts` |
| 64 | `ChatContact` | interface | `hooks/chat/types.ts` |
| 83 | `WhatsAppInstanceForUser` | interface | `hooks/chat/types.ts` |
| 94 | `useWhatsAppInstancesForUser` | hook | `hooks/chat/useWhatsAppInstances.ts` |
| 161 | `useWhatsAppContacts` | hook | `hooks/chat/useWhatsAppContacts.ts` |
| 373 | `useWhatsAppMessages` | hook | `hooks/chat/useWhatsAppMessages.ts` |
| 442 | `useSendWhatsAppMessage` | hook | `hooks/chat/useWhatsAppSend.ts` |
| 621 | `useSendWhatsAppMedia` | hook | `hooks/chat/useWhatsAppSend.ts` |
| 996 | `useWhatsAppMessagesRealtime` | hook | `hooks/chat/useWhatsAppRealtime.ts` |
| 1058 | `useTransferToSzChatDepartment` | hook | `hooks/chat/useWhatsAppSzChat.ts` |
| 1098 | `useActiveSzChatSession` | hook | `hooks/chat/useWhatsAppSzChat.ts` |
| 1128 | `useActiveWhatsAppInstance` | hook | `hooks/chat/useWhatsAppInstances.ts` |
| 1158 | `useFailedMessages` | hook | `hooks/chat/useWhatsAppSend.ts` |
| 1171 | `useRetryMessage` | hook | `hooks/chat/useWhatsAppSend.ts` |

Helpers privados (`sanitizeFileName`, `normalizeMimeType`, `getMimeType`, `isSzChatInstance`) acompanham o arquivo onde são usados (`useWhatsAppSend.ts`).

### 1.3 Pontos de consumo externos (fora de `src/components/chat/`)

Verificado via `grep -rn "from.*components/chat/WhatsAppChat\|from.*hooks/useWhatsAppChat"`:

| Arquivo | Importa | Tipo de uso |
|---------|---------|-------------|
| `/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/pages/ChatWhatsApp.tsx` | `WhatsAppChat` (componente) | página `/chat` |
| `/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/EmbeddedChatWindow.tsx` | `MessageBubble`, `AudioRecorder`, `ImagePreviewModal`, `MessagesAreaErrorBoundary` (**todos de `./WhatsAppChat`**) | lead detail modal |
| `/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/WhatsAppChat.tsx` | `ChatContact`, `WhatsAppMessage`, `WhatsAppInstanceForUser`, `FailedMessage` + 10 hooks de `@/hooks/useWhatsAppChat` | self |
| `/Users/gabrielaureliogipp/Desktop/Projetos/v8milennialsb2bv2-main/src/components/chat/EmbeddedChatWindow.tsx` | `useWhatsAppMessages`, `useSendWhatsAppMessage`, `useSendWhatsAppMedia`, `useWhatsAppMessagesRealtime`, `useWhatsAppInstancesForUser` | self |

Consequência: qualquer quebra de `@/hooks/useWhatsAppChat` afeta **Embedded + WhatsAppChat**; qualquer quebra de re-exports (`MessageBubble`, `AudioRecorder`, `ImagePreviewModal`, `MessagesAreaErrorBoundary`) de `./WhatsAppChat` quebra **Embedded**. Ambos são contratos públicos desta onda.

---

## 2. Estrutura de pastas nova

```text
src/components/chat/
├── index.ts                         # barrel — exports públicos (ChatShell, MessageBubble, media, etc.)
├── layout/
│   └── ChatShell.tsx                # 3-col ResizablePanelGroup + density CSS vars + persistência
├── list/
│   ├── ConversationList.tsx         # ex-ContactList
│   └── ConversationListItem.tsx     # row + ContactContextMenu co-locado
├── view/
│   ├── ChatHeader.tsx               # avatar, nome, AI toggle, SZ transfer, badges
│   └── MessageList.tsx              # timeline + grouping + unread divider + transfer events + FAB host
├── composer/
│   └── ChatComposer.tsx             # input + slash + schedule + image/audio + shortcuts + kbd hints
├── media/
│   ├── AudioPlayer.tsx              # ex-AudioPlayer + getAudioPlaybackUrl co-locado
│   ├── AudioRecorder.tsx            # ex-AudioRecorder (public — Embedded consome)
│   ├── ImagePreviewModal.tsx        # ex-ImagePreviewModal (public — Embedded consome)
│   └── MessageMedia.tsx             # MessageImage + MessageVideo + MessageDocument (co-locados)
├── context-panel/
│   ├── ContextPanel.tsx             # shell com <Tabs>
│   ├── ContextPanelInfo.tsx         # stub — renderiza LeadDetailContent existente (Onda 2b redesenha)
│   ├── ContextPanelPipe.tsx         # stub — placeholder
│   ├── ContextPanelTags.tsx         # stub — placeholder
│   └── ContextPanelHistory.tsx      # stub — placeholder
├── MessageBubble.tsx                # public — consumido por EmbeddedChatWindow
├── ChatEmptyState.tsx               # Onda 1 — sem mudança
├── ScrollToBottomFab.tsx            # Onda 1 — sem mudança
├── UnreadDivider.tsx                # Onda 1 — sem mudança
├── ChannelBadge.tsx                 # intocado
├── ConversationNotes.tsx            # intocado
├── EmbeddedChatWindow.tsx           # intocado (importa de index.ts após c1)
├── LeadContactModal.tsx             # intocado
├── LeadDetailContent.tsx            # intocado (Onda 2b)
├── ScheduleMessageModal.tsx         # intocado
├── ScheduledMessagesBanner.tsx      # intocado
├── SlashCommandPopover.tsx          # intocado
└── WhatsAppChat.tsx                 # reduzido a ≤200 LOC — state de seleção + compose de ChatShell

src/hooks/chat/
├── types.ts                         # WhatsAppMessage, FailedMessage, ChatContact, ChatContactTag, WhatsAppInstanceForUser
├── useConversationReadState.ts      # NEW — substitui localStorage.whatsapp_last_seen_* com RPC/RLS-aware read tracking
├── useChatDensity.ts                # NEW — FSM compact|comfortable|spacious + persist + CSS vars
├── useWhatsAppInstances.ts          # useWhatsAppInstancesForUser + useActiveWhatsAppInstance
├── useWhatsAppContacts.ts           # useWhatsAppContacts
├── useWhatsAppMessages.ts           # useWhatsAppMessages
├── useWhatsAppSend.ts               # useSendWhatsAppMessage + useSendWhatsAppMedia + useFailedMessages + useRetryMessage
├── useWhatsAppRealtime.ts           # useWhatsAppMessagesRealtime
└── useWhatsAppSzChat.ts             # useTransferToSzChatDepartment + useActiveSzChatSession

src/hooks/useWhatsAppChat.ts         # vira thin re-export (barrel) — mantém todos os imports existentes vivos

src/lib/
├── chat-time.ts                     # formatMessageTime + formatContactTime
├── chat-phone.ts                    # normalizePhoneForStorage + normalizePhoneForParam
└── chat-instance-storage.ts         # getInstanceStorageKey
```

**Princípios da organização**:

1. **Feature foldering** dentro de `components/chat/` (layout, list, view, composer, media, context-panel) — domínios de responsabilidade ficam claros em 30s de leitura.
2. **Barrel `index.ts`** é o único contrato público de `components/chat/` para o resto do app. Consumidores internos (cross-folder dentro de `chat/`) importam por path relativo curto.
3. **Hooks barrel** (`useWhatsAppChat.ts` vira re-export) preserva backcompat de imports — zero arquivo fora de `chat/` precisa mudar.
4. **Types isolados** em `hooks/chat/types.ts` — evitam import cycle entre hooks.
5. **Lib helpers** (time/phone/storage) saem de dentro de componentes — reutilizáveis em testes unit e em futuras features.

---

## 3. 17 commits atômicos — ordem rígida

Cada commit compila, passa `tsc`, passa build. Sem feature nova, sem quebra visual. Commits em ordem de dependência — não pule.

---

### C1 — `refactor(chat): add barrel index.ts for public exports`

- **Arquivos**: `src/components/chat/index.ts` (new, ~30 linhas)
- **LOC movida**: 0 (apenas re-exports)
- **Extract**: nenhum. Re-exporta APIs já públicas:
  ```ts
  export { WhatsAppChat } from "./WhatsAppChat";
  export { MessageBubble, AudioRecorder, ImagePreviewModal, MessagesAreaErrorBoundary, getAudioPlaybackUrl, formatMessageTime, MessageStatusIcon } from "./WhatsAppChat";
  export { ChatEmptyState } from "./ChatEmptyState";
  export { ScrollToBottomFab } from "./ScrollToBottomFab";
  export { UnreadDivider } from "./UnreadDivider";
  ```
- **Props**: N/A
- **Dependências**: nenhuma
- **Smoke test**: build passa; `src/pages/ChatWhatsApp.tsx` e `src/components/chat/EmbeddedChatWindow.tsx` continuam importando de onde importavam (nada mudou).
- **Benefício**: a partir daqui, novos consumidores importam `from "@/components/chat"` e o Architect pode mover arquivos internamente sem quebrar ninguém.

---

### C2 — `refactor(chat): extract AudioPlayer to media/`

- **Arquivos**:
  - new `src/components/chat/media/AudioPlayer.tsx`
  - modified `src/components/chat/WhatsAppChat.tsx` (remove bloco + import novo)
  - modified `src/components/chat/index.ts` (re-export)
- **LOC movida**: ~235 LOC (linhas 141–153 `getAudioPlaybackUrl` + 703–943 `AudioPlayer`)
- **Extract**: `WhatsAppChat.tsx:141-153` + `WhatsAppChat.tsx:703-943`
- **Props**: `{ src: string; isOutgoing: boolean }` (inalterado)
- **Dependências**: C1 (barrel existe)
- **Smoke test**: áudio incoming `.ogg` reproduz; outgoing `.mp3` reproduz; stream-media URLs com Authorization funcionam; Safari fallback (blob URL + MP3 conversion) intacto.
- **Armadilha**: `STREAM_MEDIA_PATH`, `anonKey`, `convertAudioBlobToMp3` precisam estar no arquivo novo. `getAudioPlaybackUrl` fica co-locado (mesmo arquivo) e **re-exportado** via barrel pra compat.

---

### C3 — `refactor(chat): extract AudioRecorder to media/`

- **Arquivos**:
  - new `src/components/chat/media/AudioRecorder.tsx`
  - new `src/components/chat/media/ImagePreviewModal.tsx` (split junto por afinidade — ambos eram exports públicos adjacentes)
  - modified `src/components/chat/WhatsAppChat.tsx` (remove blocos)
  - modified `src/components/chat/index.ts` (ajusta re-exports)
  - modified `src/components/chat/EmbeddedChatWindow.tsx` (import muda de `./WhatsAppChat` → `@/components/chat`)
- **LOC movida**: ~142 + ~30 = ~172 LOC (linhas 1232–1373 `AudioRecorder` + 1376–1406 `ImagePreviewModal`)
- **Extract**: `WhatsAppChat.tsx:1232-1373`, `1376-1406`
- **Props**:
  - `AudioRecorder`: `{ onRecorded: (blob: Blob) => void; onCancel: () => void }` (inalterado)
  - `ImagePreviewModal`: `{ imageUrl: string | null; isOpen: boolean; onClose: () => void }` (inalterado)
- **Dependências**: C1, C2 (não toca AudioPlayer mas limpa área adjacente)
- **Smoke test**: gravar áudio → preview timer → enviar; ESC cancela; clicar imagem → modal abre/fecha.
- **Backcompat**: `EmbeddedChatWindow.tsx` atualiza de `from "./WhatsAppChat"` para `from "@/components/chat"`. Re-exports de `WhatsAppChat.tsx` viram delegates (`export { AudioRecorder } from "./media/AudioRecorder"`) por 1 commit — removidos em C16.

---

### C4 — `refactor(chat): extract MessageMedia (Image/Video/Document)`

- **Arquivos**:
  - new `src/components/chat/media/MessageMedia.tsx` (exporta 3 subcomponentes nomeados)
  - modified `src/components/chat/WhatsAppChat.tsx`
- **LOC movida**: ~130 LOC (linhas 946–1075)
- **Extract**: `WhatsAppChat.tsx:946-983` (`MessageImage`) + `986-1016` (`MessageVideo`) + `1019-1075` (`MessageDocument`)
- **Props**:
  - `MessageImage`: `{ src: string; onPreview: () => void }`
  - `MessageVideo`: `{ src: string }`
  - `MessageDocument`: `{ src: string; fileName?: string; isOutgoing: boolean }`
- **Dependências**: C2
- **Smoke test**: imagem lazy-load + preview onClick; vídeo controls + fallback `<FileVideo>`; documento download link.

---

### C5 — `refactor(chat): extract ConversationList + ConversationListItem to list/`

- **Arquivos**:
  - new `src/components/chat/list/ConversationList.tsx` (ex-`ContactList`)
  - new `src/components/chat/list/ConversationListItem.tsx` (ex-`ContactContextMenu` + row JSX extraído do map interno)
  - modified `src/components/chat/WhatsAppChat.tsx`
- **LOC movida**: ~470 LOC (linhas 228 `contactDisplayName` + 232–556 `ContactList` + 558–701 `ContactContextMenu`)
- **Extract**: `WhatsAppChat.tsx:228-556`, `558-701`
- **Props** (`ConversationList`): idêntica à atual `ContactList` (~25 props). Manter assinatura — **não refatorar interface agora**; isso é Onda 2b.
- **Props** (`ConversationListItem`): `{ contact: ChatContact; isSelected: boolean; onSelect: (phone: string) => void; waitingHumanLeadIds?: Set<string>; activeTab: "active" | "archived"; isAdmin: boolean; instanceId: string | null; organizationId: string | null; allTags: Tag[]; onArchive; onUnarchive; onDelete; onAddTag; onRemoveTag }`
- **Dependências**: C1
- **Smoke test**: lista carrega; seletor de instance funciona; filtros "Com lead" / "Humano" / tabs Ativas/Arquivadas; busca; context menu (arquivar/desarquivar/excluir/tags); unread count.
- **Nota**: o map interno de `contacts.map(...)` que atualmente está inline em `ContactList` vira `<ConversationListItem>` — reduz `ConversationList.tsx` a ~150 LOC de shell + filtros.

---

### C6 — `refactor(chat): extract ChatHeader to view/`

- **Arquivos**:
  - new `src/components/chat/view/ChatHeader.tsx`
  - modified `src/components/chat/WhatsAppChat.tsx` (dentro de `ChatWindow`, substitui header inline por `<ChatHeader>`)
- **LOC movida**: ~185 LOC (linhas 1742–1923 do antigo `ChatWindow`)
- **Extract**: `WhatsAppChat.tsx:1742-1923`
- **Props**: `{ phoneNumber: string; contactName: string; hasLead: boolean; leadId?: string; aiDisabled: boolean; isWaitingHuman: boolean; szChatSession: SzChatSession | null; organizationId: string | null; onBack: () => void; onOpenLeadModal: () => void; onToggleAi: (enable: boolean) => void; onTransferToSzChatTeam: (teamName: string, teamId: string) => void; toggleAiPending: boolean; transferPending: boolean }`
- **Dependências**: C1
- **Smoke test**: header renderiza; "Ver lead" / "Criar Lead"; AI Switch com otimismo; badge "Aguardando humano"; badge "IA desativada"; dropdown "Transferir setor" (apenas se `szChatSession`).

---

### C7 — `refactor(chat): extract MessageList to view/ (preserve Onda 1 grouping + unread + motion)`

- **Arquivos**:
  - new `src/components/chat/view/MessageList.tsx`
  - modified `src/components/chat/WhatsAppChat.tsx`
- **LOC movida**: ~150 LOC (linhas 1940–2081 incluindo `ScrollArea` + timeline + transfer events + unread divider + FAB)
- **Extract**: `WhatsAppChat.tsx:1940-2081`
- **Props**: `{ messages: WhatsAppMessage[]; transferEvents: TransferEvent[]; failedMessages: FailedMessage[]; isLoading: boolean; contactName: string; instanceName: string; lastReadAt: number; mountTime: number; onImagePreview: (url: string) => void; onRetry: (msg: FailedMessage) => void; onOpenTemplates: () => void }`
- **Dependências**: C1, C2, C3, C4, C6
- **Smoke test (inegociável — são wins da Onda 1)**:
  - Grouping por autor + janela 120s (radius adaptativo + gap 2px / 12px)
  - Date separators (`Hoje` / `Ontem` / `dd/MM/yyyy`) com cores/tipografia intactas
  - `<UnreadDivider count={n} />` aparece acima da primeira incoming não-lida
  - `<motion.div>` animação enter apenas para mensagens posteriores a `mountTime`
  - `prefers-reduced-motion` desabilita animação
  - `<MessagesAreaErrorBoundary>` continua envolvendo o timeline
  - FAB visível quando `!isAtBottom`, counter decimal sincronizado
  - `<ChatEmptyState>` quando `messages.length === 0`
- **Armadilha crítica**: `lastReadAtRef` hoje vive no `ChatWindow`. Virá como **prop derivada** (`lastReadAt: number`). Não recomputar dentro de `MessageList`. Commit 14 substitui `localStorage.whatsapp_last_seen_*` por `useConversationReadState()` — **neste commit a prop continua vinda do localStorage** via ref no componente pai.

---

### C8 — `refactor(chat): extract ContextPanel skeleton with tabs`

- **Arquivos**:
  - new `src/components/chat/context-panel/ContextPanel.tsx`
  - new `src/components/chat/context-panel/ContextPanelInfo.tsx` (renderiza `<LeadDetailContent>` existente — stub)
  - new `src/components/chat/context-panel/ContextPanelPipe.tsx` (stub: `"Em breve — Onda 2b"`)
  - new `src/components/chat/context-panel/ContextPanelTags.tsx` (stub)
  - new `src/components/chat/context-panel/ContextPanelHistory.tsx` (stub)
- **LOC movida**: 0 (stubs novos). Reaproveita `LeadDetailContent` por composição — não extrai nada dele.
- **Extract**: nenhum do god-component
- **Props** (`ContextPanel`): `{ phoneNumber: string; leadId?: string; pushName?: string | null; defaultTab?: "info" | "pipe" | "tags" | "history"; onClose?: () => void }`
- **Dependências**: C1
- **Smoke test**: visível só no mockup v2 (C16) por enquanto. Não ligado no `WhatsAppChat.tsx` de produção nesta onda — é um skeleton preparado para Onda 2b ocupar o 3rd panel do `ChatShell`.
- **Nota**: em produção (commit C10), `ChatShell` renderiza `<ContextPanel>` apenas se `selectedPhone && isLeadPanelOpen`, e a tab "Info" delega para `LeadDetailContent` existente → zero regressão do wizard atual.

---

### C9 — `feat(chat): add bubble + density tokens to CSS vars`

- **Arquivos**:
  - modified `src/index.css` (adiciona CSS vars no `:root` e `.dark` — defaults "comfortable")
  - modified `tailwind.config.ts` (registra utilities consumindo as vars em `theme.extend.spacing` ou plugin custom)
- **LOC modificada**: ~40 linhas
- **Extract**: nenhum
- **Tokens** (defaults = comfortable):
  ```css
  :root {
    --chat-bubble-padding-x: 14px;
    --chat-bubble-padding-y: 10px;
    --chat-bubble-radius-lg: 16px;
    --chat-bubble-radius-sm: 4px;
    --chat-msg-gap-same-author: 4px;
    --chat-msg-gap-different: 12px;
    --chat-avatar-size: 40px;
    --chat-composer-min-h: 44px;
    --chat-list-row-height: 72px;

    --chat-bubble-outgoing-bg: hsl(var(--muted) / 0.80);
    --chat-bubble-outgoing-border: hsl(var(--border) / 0.60);
    --chat-bubble-incoming-bg: hsl(var(--card));
    --chat-bubble-incoming-border: hsl(var(--border) / 0.40);
  }
  ```
- **Dependências**: nenhuma estrutural (é cosmético + infra pra C11 e C15)
- **Smoke test**: tokens existem; nenhuma classe ainda os consome (visual inalterado).
- **Nota**: classes virão em C15 (util) e C11 (injeção dinâmica de valores por density). Se agent-ui já tiver spec pronta, aplicar os números dela — este plano mantém defaults conservadores.

---

### C10 — `refactor(chat): introduce ChatShell with 3-col ResizablePanelGroup + persistence`

- **Arquivos**:
  - new `src/components/chat/layout/ChatShell.tsx`
  - modified `src/components/chat/WhatsAppChat.tsx` (vira consumidor: state de seleção + `<ChatShell list={...} view={...} context={...} />`)
- **LOC**: +180 LOC (novo) / −150 LOC (simplifica WhatsAppChat)
- **Extract**: lógica de layout 3-col sai do return JSX do `WhatsAppChat` (linhas 2509–2627) + chassis do `ChatWindow` (linhas 1741–1744 wrapper, 2248 close)
- **Props**: `{ list: ReactNode; view: ReactNode; context?: ReactNode; selectedPhone: string | null; onBack: () => void; density?: DensityMode }`
- **Implementação**:
  - Usa `<ResizablePanelGroup>` de `@/components/ui/resizable` (já existe em `src/components/ui/resizable.tsx`)
  - Persiste tamanhos em `localStorage.chat-panels-${userId}` — formato `{ list: 25, view: 50, context: 25 }`
  - Panel 3 (`context`) é colapsado por padrão (`defaultSize={0}` + handle escondido); abre quando `context !== null`
  - Breakpoint `md:` — abaixo disso volta ao comportamento atual (stack + `hidden md:flex`)
- **Dependências**: C5 (list), C6 + C7 (view composable), C8 (context)
- **Smoke test**: arrastar handle redimensiona; reload → tamanhos persistem; mobile → stack; ESC ou voltar → `selectedPhone = null`.
- **Armadilha**: `WhatsAppChat.tsx` **não pode perder** o Dialog de `LeadDetailContent` wizard enquanto a onda 2b não estiver pronta. Solução: `ContextPanel` fica atrás de feature flag `VITE_CHAT_ONDA_2A_CONTEXT_PANEL` (default `false`) → em produção continua abrindo `<Dialog>` com `LeadDetailContent` como hoje; no mockup v2 (C16) a flag está `true`.

---

### C11 — `feat(chat): useChatDensity FSM + header toggle + CSS vars injection`

- **Arquivos**:
  - new `src/hooks/chat/useChatDensity.ts` (hook + tipos)
  - modified `src/components/chat/view/ChatHeader.tsx` (adiciona toggle compact/comfortable/spacious)
  - modified `src/components/chat/layout/ChatShell.tsx` (injeta CSS vars via `style={{ "--chat-bubble-padding-x": ... }}` no root)
- **LOC**: +95 LOC
- **FSM**: ver seção 4 abaixo
- **Storage**: `localStorage.chat-density-${userId}` — valores `"compact" | "comfortable" | "spacious"`; default `"comfortable"`.
- **Dependências**: C9 (tokens existem), C10 (shell existe), C6 (header existe)
- **Smoke test**: toggle muda padding/gap imediatamente (sem reload); reload → persiste; novo user → comfortable.
- **Nota**: hook expõe `{ density, setDensity, cssVars }` — `cssVars` é o `Record<string, string>` pronto para spread no `style`.

---

### C12 — `refactor(chat): split useWhatsAppChat hook into 5 domain hooks + compat barrel`

- **Arquivos**:
  - new `src/hooks/chat/types.ts`
  - new `src/hooks/chat/useWhatsAppInstances.ts` (`useWhatsAppInstancesForUser` + `useActiveWhatsAppInstance`)
  - new `src/hooks/chat/useWhatsAppContacts.ts`
  - new `src/hooks/chat/useWhatsAppMessages.ts`
  - new `src/hooks/chat/useWhatsAppSend.ts` (`useSendWhatsAppMessage` + `useSendWhatsAppMedia` + `useFailedMessages` + `useRetryMessage` + helpers privados)
  - new `src/hooks/chat/useWhatsAppRealtime.ts`
  - new `src/hooks/chat/useWhatsAppSzChat.ts`
  - modified `src/hooks/useWhatsAppChat.ts` → **barrel de re-export** (mantém ~30 LOC)
- **LOC movida**: 1202 LOC redistribuídas em 6 arquivos; barrel fica ~30 LOC
- **Extract**: `hooks/useWhatsAppChat.ts` inteiro (mantendo behavior idêntico)
- **Barrel (compat)**:
  ```ts
  export type { WhatsAppMessage, FailedMessage, ChatContact, ChatContactTag, WhatsAppInstanceForUser } from "./chat/types";
  export { useWhatsAppInstancesForUser, useActiveWhatsAppInstance } from "./chat/useWhatsAppInstances";
  export { useWhatsAppContacts } from "./chat/useWhatsAppContacts";
  export { useWhatsAppMessages } from "./chat/useWhatsAppMessages";
  export { useSendWhatsAppMessage, useSendWhatsAppMedia, useFailedMessages, useRetryMessage } from "./chat/useWhatsAppSend";
  export { useWhatsAppMessagesRealtime } from "./chat/useWhatsAppRealtime";
  export { useTransferToSzChatDepartment, useActiveSzChatSession } from "./chat/useWhatsAppSzChat";
  ```
- **Dependências**: nenhuma (pode rodar antes de C2–C11, mas deixamos aqui para que refactor de componentes seja isolado de refactor de hooks — reduz blast radius por commit)
- **Smoke test**: `grep -rn "from.*hooks/useWhatsAppChat" src` retorna lista idêntica à pré-commit; build verde; `src/components/chat/WhatsAppChat.tsx` + `EmbeddedChatWindow.tsx` + outros hooks que importavam → funcionam sem mudança.

---

### C13 — `refactor(chat): extract ChatComposer with shortcuts + kbd hints + drop zone`

- **Arquivos**:
  - new `src/components/chat/composer/ChatComposer.tsx`
  - modified `src/components/chat/WhatsAppChat.tsx` / `view/MessageList.tsx` / integration (substitui bloco de input)
- **LOC movida**: ~240 LOC (linhas 2083–2225 input + image preview + AudioRecorder invocation + handlers relacionados)
- **Extract**: `WhatsAppChat.tsx:2083-2225` + handlers `handleSend`, `handleSlashSelect`, `handleKeyDown`, `handleImageSelect`, `handleSendImage`, `handleAudioRecorded` (linhas 1597–1730)
- **Props**: `{ phoneNumber: string; instanceId: string; instanceName: string; leadId?: string; contactName: string; canReply: boolean; onScheduleOpen: () => void }` — internaliza draft, slash, send/media mutations, audio record state.
- **Shortcuts** (wins novos nesta onda):
  - `Enter` → enviar (já existia)
  - `Shift+Enter` → nova linha (já existia)
  - `Ctrl/Cmd+K` → abrir popover de templates (`/`)
  - `Ctrl/Cmd+U` → abrir file picker de imagem
  - `Escape` → fechar popover de templates ou cancelar AudioRecorder
- **Kbd hints**: pequena linha `text-xs text-muted-foreground/60` abaixo do input, mobile-hidden, mostrando `Enter ↵ enviar · / templates`.
- **Drop zone**: `onDragOver`/`onDrop` no container — arrasta imagem → abre preview (mesmo handler que file picker).
- **Dependências**: C3 (AudioRecorder), C7 (composer vive abaixo de MessageList no render tree)
- **Smoke test**: enviar texto; Shift+Enter; `/` abre popover + escolha de template resolve variables; Ctrl+K; Ctrl+U; drag-drop imagem; agendar; gravar áudio; kbd hints visíveis.

---

### C14 — `feat(chat): useConversationReadState replaces localStorage whatsapp_last_seen_`

- **Arquivos**:
  - new `src/hooks/chat/useConversationReadState.ts`
  - modified `src/components/chat/view/MessageList.tsx` (consumidor)
  - modified `src/components/chat/WhatsAppChat.tsx` / `ChatWindow` consumer (remove ref para `localStorage.whatsapp_last_seen_*`)
- **LOC**: +120 / −30
- **API**:
  ```ts
  const { lastReadAt, markAsRead, isLoading } = useConversationReadState({
    phoneNumber: string;
    leadId?: string;
    organizationId?: string;
  });
  ```
- **Storage strategy** (escolher no momento do commit, baseado no que o DBA aprovar):
  - **Opção A (preferida)**: persistir em `whatsapp_conversations.last_read_at_by_user` (JSONB `{ user_id: timestamp }`) → RLS por org + user. Vantagem: sync cross-device. Custo: 1 UPDATE por seleção de conversa.
  - **Opção B (fallback)**: manter localStorage mas isolado por `userId:orgId:phone` (bug atual: chave só por phone, vaza entre usuários no mesmo browser). Chave: `chat-last-read:${userId}:${orgId}:${phone}`.
  - **Recomendação do Architect**: **B agora, A em Onda 3**. Motivo: Onda 2a é estrutural; mexer em schema puxa DBA + migration + RLS review, desalinhado com escopo. Mas corrige o bug de isolamento entre users no mesmo device hoje.
- **Dependências**: C7 (MessageList existe e recebe `lastReadAt` como prop)
- **Smoke test**: unread divider aparece corretamente após reload; trocar de user no mesmo browser → não vaza "já lido" do user anterior; abrir conversa zera unread count da lista.

---

### C15 — `feat(chat): register tailwind bubble utility classes consuming density vars`

- **Arquivos**: modified `tailwind.config.ts` (plugin ou `theme.extend.spacing` + `borderRadius`)
- **LOC**: ~40 linhas
- **Utilities novas** (exemplo):
  ```js
  // tailwind.config.ts — plugin
  plugin(function({ addUtilities }) {
    addUtilities({
      '.chat-bubble': {
        paddingLeft: 'var(--chat-bubble-padding-x)',
        paddingRight: 'var(--chat-bubble-padding-x)',
        paddingTop: 'var(--chat-bubble-padding-y)',
        paddingBottom: 'var(--chat-bubble-padding-y)',
      },
      '.chat-bubble-outgoing': {
        backgroundColor: 'var(--chat-bubble-outgoing-bg)',
        borderColor: 'var(--chat-bubble-outgoing-border)',
      },
      '.chat-bubble-incoming': {
        backgroundColor: 'var(--chat-bubble-incoming-bg)',
        borderColor: 'var(--chat-bubble-incoming-border)',
      },
      '.chat-gap-same': { marginTop: 'var(--chat-msg-gap-same-author)' },
      '.chat-gap-diff': { marginTop: 'var(--chat-msg-gap-different)' },
    });
  })
  ```
- **Modified**: `src/components/chat/MessageBubble.tsx` — substituir `px-4 py-2.5` e `bg-muted/80 border border-border/60` pelas classes `chat-bubble chat-bubble-outgoing`. Preservar `radiusClass` (adaptativo por grouping) mas ler raios das vars.
- **Dependências**: C9 (vars existem), C11 (density injeta valores)
- **Smoke test**: bubbles idênticos visualmente em density "comfortable" (default do C9); toggle para "compact" encolhe padding/gap imediatamente; "spacious" aumenta. Nenhuma regressão de radius adaptativo.

---

### C16 — `feat(chat): mockup v2 page at src/pages/MockupChatV2.tsx`

- **Arquivos**:
  - new `src/pages/MockupChatV2.tsx` (~400 LOC — dados fake + 4 cenários)
- **LOC**: +400
- **Conteúdo**: consome o stack novo (`ChatShell` + `ConversationList` + `ChatHeader` + `MessageList` + `ChatComposer` + `ContextPanel`) com dados hardcoded (sem chamadas Supabase). 4 cenários navegáveis via query `?scenario=`:
  1. `empty` — nenhuma conversa selecionada
  2. `active` — conversa com 30 mensagens, grouping diverso, transfer event, mensagem falhada
  3. `sz-transfer` — com `szChatSession` ativa (botão "Transferir setor")
  4. `context-open` — painel de contexto aberto (Info/Pipe/Tags/History)
- **Density toggle**: visível e funcional.
- **Dependências**: C1–C15
- **Smoke test**: navegar `/_mockup/chat-v2?scenario=X` renderiza sem erro; todos os 4 cenários; density toggle; resize handles; keyboard shortcuts.

---

### C17 — `chore(routes): mount /_mockup/chat-v2 in App.tsx`

- **Arquivos**: modified `src/App.tsx` (adiciona `<Route path="/_mockup/chat-v2" element={<MockupChatV2 />} />` ao lado do `/_mockup/chat` existente)
- **LOC**: +2 + 1 import
- **Dependências**: C16
- **Smoke test**: `/_mockup/chat` continua funcionando; `/_mockup/chat-v2` abre o novo mockup; ambos coexistem até aprovação final em Onda 2b.

---

## 4. FSM — Density Mode

```text
                    ┌─────────────┐
                    │  compact    │
         ◄───────── │  (dense)    │ ───────────►
         │          └─────────────┘            │
         │ cycle                        cycle  │
         │          ┌─────────────┐            │
         └────────► │ comfortable │ ◄──────────┘
          (default) │  (default)  │
                    └─────┬───────┘
                          │ cycle
                          ▼
                    ┌─────────────┐
                    │  spacious   │
                    │  (relaxed)  │
                    └─────────────┘
                          │ cycle
                          └──→ back to compact
```

**Transitions**: única ação é `cycle()` (click no toggle). Ordem circular: `comfortable → spacious → compact → comfortable → ...`. Alternativa: botão com 3 estados visuais (3 ícones lado a lado) — escolha de UI fica com `agent-ui`.

**CSS vars injetadas por `ChatShell` (via `style` inline no root)**:

| Variable | compact | comfortable | spacious |
|----------|--------:|------------:|---------:|
| `--chat-bubble-padding-x` | 10px | 14px | 18px |
| `--chat-bubble-padding-y` | 6px | 10px | 14px |
| `--chat-msg-gap-same-author` | 2px | 4px | 6px |
| `--chat-msg-gap-different` | 8px | 12px | 16px |
| `--chat-avatar-size` | 32px | 40px | 48px |
| `--chat-composer-min-h` | 36px | 44px | 52px |
| `--chat-list-row-height` | 56px | 72px | 88px |

**Storage**:
- Key: `chat-density-${userId}` (`userId` do auth context)
- Se `userId` indisponível → não persiste, mantém em memória com default `comfortable`
- Reset em logout (já acontece por limpar auth context — chave fica no localStorage mas não é lida sem userId)

**Implementação `useChatDensity`**:
```ts
type DensityMode = "compact" | "comfortable" | "spacious";
const DENSITY_TOKENS: Record<DensityMode, Record<string, string>> = { /* tabela acima */ };

export function useChatDensity(userId: string | undefined) {
  const key = userId ? `chat-density-${userId}` : null;
  const [density, setDensityState] = useState<DensityMode>(() => {
    if (!key) return "comfortable";
    const stored = localStorage.getItem(key);
    return (stored === "compact" || stored === "spacious" || stored === "comfortable")
      ? stored
      : "comfortable";
  });
  const setDensity = useCallback((d: DensityMode) => {
    setDensityState(d);
    if (key) localStorage.setItem(key, d);
  }, [key]);
  const cycle = useCallback(() => {
    setDensity(density === "comfortable" ? "spacious" : density === "spacious" ? "compact" : "comfortable");
  }, [density, setDensity]);
  const cssVars = useMemo(() => DENSITY_TOKENS[density], [density]);
  return { density, setDensity, cycle, cssVars };
}
```

---

## 5. Backwards-compatibility

| Contrato | Garantia | Como preservado |
|----------|----------|-----------------|
| `@/components/chat/WhatsAppChat` exporta `WhatsAppChat` | mantido | `WhatsAppChat.tsx` continua default entrypoint, reduzido internamente |
| `@/components/chat/WhatsAppChat` exporta `MessageBubble`, `AudioRecorder`, `ImagePreviewModal`, `MessagesAreaErrorBoundary` | mantido via re-export no próprio arquivo até C16, depois consumidor (`EmbeddedChatWindow`) migra pra `@/components/chat` (barrel) e re-exports são removidos | `EmbeddedChatWindow.tsx:40-44` atualiza import em **C3** |
| `@/hooks/useWhatsAppChat` exporta 10 hooks + 5 types | mantido 100% | arquivo vira barrel de re-exports em **C12** |
| `/_mockup/chat` route | mantido | `MockupChat.tsx` intocado; v2 é route nova paralela |
| `/chat` página | visual idêntico até Onda 2b aprovar | `ContextPanel` fica atrás de feature flag; `LeadDetailContent` Dialog continua como default |
| Realtime subscriptions | idêntico | `useWhatsAppMessagesRealtime` apenas muda de arquivo (C12) |
| localStorage keys | compatível | `whatsapp_last_seen_*` (C14 introduz chave nova + fallback de leitura da antiga por 1 release para migração suave) |

**Barrel `src/components/chat/index.ts` — contrato público final (pós-C17)**:
```ts
// Page / shell
export { WhatsAppChat } from "./WhatsAppChat";
export { ChatShell } from "./layout/ChatShell";

// Message primitives (consumed by EmbeddedChatWindow)
export { MessageBubble } from "./MessageBubble";
export { MessageStatusIcon, formatMessageTime } from "./view/MessageList";

// Media primitives (consumed by EmbeddedChatWindow + future reuse)
export { AudioPlayer, getAudioPlaybackUrl } from "./media/AudioPlayer";
export { AudioRecorder } from "./media/AudioRecorder";
export { ImagePreviewModal } from "./media/ImagePreviewModal";
export { MessageImage, MessageVideo, MessageDocument } from "./media/MessageMedia";

// Onda 1 primitives
export { ChatEmptyState } from "./ChatEmptyState";
export { ScrollToBottomFab } from "./ScrollToBottomFab";
export { UnreadDivider } from "./UnreadDivider";

// Error boundary
export { MessagesAreaErrorBoundary } from "./view/MessageList";
```

---

## 6. Risco + mitigação por commit

| Commit | Risco específico | Severidade | Mitigação |
|-------:|------------------|:----------:|-----------|
| C1 | nenhum (barrel aditivo) | — | — |
| C2 | `AudioPlayer` depende de `anonKey` env — se import falhar em chunk split, player quebra | baixo | manter `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY` no mesmo arquivo, sem passar por prop |
| C3 | `EmbeddedChatWindow` importa de `./WhatsAppChat` — path muda | médio | no mesmo commit, atualizar import do Embedded; manter re-export delegate no WhatsAppChat.tsx até C16 |
| C4 | `MessageBubble` chama `MessageImage`/`MessageVideo`/`MessageDocument` — path interno muda | baixo | import relativo `../media/MessageMedia` ok |
| C5 | `ContactList` tem 25+ props — erro de digitação em interface quebra TS | médio | copiar-colar a assinatura exata, sem refatorar props agora; rodar `tsc --noEmit` antes do commit |
| C6 | header consome `useLeadAiStatus`, `useToggleLeadAI`, `useToggleConversationAI` — derivar props corretamente | médio | props derivadas + callbacks; não duplicar hooks no header |
| C7 | `lastReadAtRef` é **crítico** para unread divider; se perdido, divider some | **alto** | passar como **prop** `lastReadAt: number` do parent; não mover a ref pra dentro de MessageList antes do C14; **incluir teste visual manual: fechar e reabrir conversa → divider aparece no lugar certo** |
| C7 | `timeline` merge (messages + transfers + failed) é lógica sutil; erro de ordenação quebra UX | alto | copiar a `(() => { ... })()` IIFE exatamente; TS strict na ordenação |
| C7 | animação `motion.div` condicional ao `mountTime` pode regredir em `prefers-reduced-motion` | médio | manter a check `window.matchMedia(...)` dentro do MessageBubble (C4 já preserva) |
| C8 | wizard atual (`LeadDetailContent` Dialog) não pode quebrar | alto | feature flag `VITE_CHAT_ONDA_2A_CONTEXT_PANEL=false` em produção; Dialog continua como hoje |
| C9 | tokens sem uso ainda — visual intacto | baixo | — |
| C10 | `ResizablePanelGroup` em mobile pode quebrar stack atual | alto | `md:` breakpoint preserva layout mobile; testar em viewport 375px |
| C10 | persistência de panel sizes corrompida em localStorage | médio | schema validation com Zod no read; fallback pra defaults |
| C11 | `cssVars` spread no style → se var inválida, quebra CSS | baixo | tipagem `Record<keyof typeof DENSITY_TOKENS["compact"], string>` |
| C12 | algum hook externo importa símbolo que se perde no split | alto | **grep completo** de todos os símbolos exportados antes do commit; barrel re-exporta 100% da superfície original |
| C12 | SSR ou dynamic import quebra porque barrel faz tree-shake diferente | baixo | Vite faz tree-shaking ok em barrels ESM; verificar `npm run build` chunk analysis |
| C13 | shortcuts Ctrl/Cmd+K podem colidir com atalhos do browser ou outras features | médio | escopar listener via `onKeyDown` do composer (não `window`); documentar |
| C13 | drop zone pode prender eventos de scroll em mobile | baixo | `onDragOver preventDefault` só em desktop (checar `matchMedia("(pointer: fine)")`) |
| C14 | migração de localStorage pode "esquecer" last-read de conversas ativas → divider aparece em mensagens já lidas | médio | fallback de leitura: se nova chave vazia, ler chave antiga `whatsapp_last_seen_${phone}` e migrar |
| C15 | `chat-bubble` utilities podem conflitar com classes existentes se Tailwind plugin ordem errada | baixo | rodar `npm run build` e inspecionar CSS gerado; prefixar com `.chat-` |
| C16 | mockup v2 pesa no bundle se não lazy | médio | `React.lazy(() => import("./MockupChatV2"))` como já é feito em `MockupChat` |
| C17 | rota nova colide com lazy loading | baixo | idem C16 |

---

## 7. Ordem de execução recomendada

### Grafo de dependências

```text
C1 (barrel)
 ├─► C2 (AudioPlayer) ──┐
 │                      ├─► C4 (MessageMedia) ──┐
 ├─► C3 (AudioRecorder+ImagePreviewModal)       │
 │                                              │
 ├─► C5 (ConversationList) ─────────────────────┤
 │                                              │
 ├─► C6 (ChatHeader) ──────────────────────────┐│
 │                                             ├┴─► C7 (MessageList)  ──┐
 ├─► C8 (ContextPanel skeleton) ────────────────────────────────────────┤
 │                                                                      │
 ├─► C9 (tokens CSS) ──► C11 (useChatDensity) ─►C10 (ChatShell) ────────┤
 │                                                                      │
 ├─► C12 (hook split) [independente, paralelo] ────────────────────────┤
 │                                                                      │
 │                                                          ┌───────────┘
 ├─► C13 (ChatComposer) ◄──────── C3, C7 ──────────────────┤
 ├─► C14 (useConversationReadState) ◄──── C7 ──────────────┤
 ├─► C15 (tailwind utils) ◄─ C9, C11 ──────────────────────┤
 │                                                          │
 └─► C16 (mockup v2) ◄─── C1..C15 ─────────────────────────┘
      │
      └─► C17 (route) ── C16
```

### Linha do tempo realista (2 sub-ondas)

**Onda 2a.1 — Arquitetura (commits C1 → C10)** — ~3–4 dias
- C1 (30min) → C2 (2h) → C3 (1h) → C4 (1h) → C5 (3h) → C6 (2h) → C7 (3h) → C8 (2h) → C9 (1h) → C10 (4h)
- **Checkpoint**: após C10, build verde, `/chat` funcional igual a hoje, `/_mockup/chat` intacto, estrutura de pastas nova em pé.

**Onda 2a.2 — Features estruturais (commits C11 → C17)** — ~2–3 dias
- C11 (2h) → C12 (3h) → C13 (4h) → C14 (2h) → C15 (1h) → C16 (3h) → C17 (15min)
- **Checkpoint final**: `/_mockup/chat-v2` renderiza com density toggle, resize handles, atalhos de teclado, context panel stub.

### Ordem paralelizável

Se houver 2 devs (improvável com a estrutura atual, mas possível com Claude + humano):
- **Track A (componentes)**: C1 → C2 → C3 → C4 → C5 → C6 → C7 → C13
- **Track B (infra)**: C9 → C11 → C12 (pode ir em paralelo desde C1)
- **Convergência**: C8, C10, C14, C15 dependem de ambos → sequencial pós-merge
- **Finalização**: C16 → C17

### Ordem recomendada se 1 executor (Backend/Frontend em sequência — padrão)

Exata sequência C1 → C2 → C3 → C4 → C5 → C6 → C7 → C8 → C9 → C10 → C11 → C12 → C13 → C14 → C15 → C16 → C17.

**Gate entre C10 e C11**: rodar `npm run build` + smoke test manual em `/chat` de dev. Se regressão visual, corrigir antes de seguir.

**Gate final (pós-C17)**: QA roda smoke checklist completo (Onda 1 preserved + Onda 2a toggles funcionam); Security revisa se localStorage migration de C14 não vaza dados cross-tenant.

---

## 8. Métrica de sucesso da Onda 2a

- `WhatsAppChat.tsx` cai de 2627 LOC → ≤ 200 LOC
- `useWhatsAppChat.ts` cai de 1202 LOC → ≤ 40 LOC (barrel)
- Todo componente do chat em ≤ 400 LOC (média esperada ~150 LOC)
- `npm run test:unit` verde (testes existentes continuam passando; nenhum novo requerido nesta onda, QA adiciona em Onda 2b)
- `npm run build` produz bundle equivalente ou menor (barrels são tree-shaken pelo Vite)
- Zero regressão em wins da Onda 1 (grouping, unread divider, FAB, retry, drafts, empty state, motion, focus ring, tabular-nums)
- `/chat` em produção visualmente idêntico ao atual até Onda 2b decidir ligar `ContextPanel`
- `/_mockup/chat-v2` renderiza 4 cenários + density toggle funcional

---

## 9. Trade-offs da decisão

### Alternativa A (escolhida): **17 commits atômicos, estrutural-only, context panel atrás de flag**
- **Pró**: cada commit é revisável em <15min, rollback por commit, Onda 2b pode seguir sem bloqueios
- **Contra**: 17 commits é muito — overhead de PR/review se for 1 PR por commit
- **Recomendação de PR**: **2 PRs** — um por sub-onda (C1–C10 e C11–C17) com commits atômicos preservados dentro de cada PR

### Alternativa B (descartada): **Big-bang single commit**
- **Pró**: 1 revisão, 1 deploy, velocidade
- **Contra**: diff inrevisável (~3000 LOC mexidas); risco de regressão alto; rollback binário

### Alternativa C (descartada): **Feature-flag incremental (conviver v1 + v2 em paralelo em produção)**
- **Pró**: risco zero de regressão
- **Contra**: duplicação massiva; 2x manutenção; dev junior se perde; v1 vira código morto após aprovação

**Por quê A**: Um codebase world-class é auditável. 17 commits nomeados explicam a refatoração pra qualquer engenheiro em 10 minutos. Um big-bang de 3k LOC não.

---

## 10. Próximos passos (pós-Onda 2a)

- **Onda 2b**: `LeadDetailContent` refactor (1040 LOC) + ativar `ContextPanel` em produção (flag `true`)
- **Onda 3**: `useConversationReadState` migra para `whatsapp_conversations.last_read_at_by_user` JSONB (DBA + migration + RLS)
- **Onda 3+**: QA automatizado — snapshot visual por density mode, Playwright para shortcuts
- **Futuro**: virtualization do `MessageList` (react-virtual) quando conversas passarem de 500 mensagens
