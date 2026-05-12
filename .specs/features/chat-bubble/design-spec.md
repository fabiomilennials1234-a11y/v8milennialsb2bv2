# Design Spec — Chat Bubble Kanban

> Widget flutuante (FAB + painel) nas Pipe pages do Torque CRM. Permite conversar com leads via WhatsApp/Uazapi sem sair do Kanban. Substitui o CTA temporário do drawer Lead.

**Audiência**: engenheiro implementando PR3.
**Status**: aprovado (após correções do hm-designer aplicadas).
**Não-objetivos**: tocar `/chat` moderno (`ChatShellWithContext`); criar nova edge function; mudar `OraculoFloatingButton` (Dashboard).

Backlog: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/08 — Backlog/backlog/chat-bubble-kanban-pr3-pr4.md`.

---

## 1. Tokens & dependências visuais

Toda decisão cromática referencia `src/index.css`. **Proibido inline hex.** Proibido inventar token novo.

### Reuso direto
- `--gradient-primary` — FAB background
- `--shadow-gold` — FAB elevação idle
- `--popover` / `--popover-foreground` — painel surface
- `--border` (`/40`, `/60`) — divisores e ring
- `--muted-foreground` (`/60`, `/80`) — preview, timestamp, microcopy secundário
- `--destructive` / `--destructive-foreground` — badge unread, banner sem permissão
- `--warning` (`/10`, `/20`, `/70`) — empty state sem instância, banner reconectando
- `--bubble-incoming-*` / `--bubble-outgoing-*` / `--bubble-ai-*` — thread (já consolidado)
- `--chat-list-row-height` (default 72px) e density compact (56px) via `useChatDensity`
- `--chat-bubble-padding-x|y`, `--chat-bubble-radius-lg|sm` — bubbles thread
- `--chat-composer-min-h` (44px) — composer altura mínima

### Tokens novos
**Nenhum.** Bubble inteiro construído sobre tokens existentes. Único helper:

```css
/* src/index.css — adicionar bloco @layer components */
.chat-bubble-panel-shadow {
  box-shadow:
    0 24px 60px -20px hsl(36 20% 4% / 0.55),
    0 8px 24px -12px hsl(36 20% 4% / 0.35);
}

html:not(.dark) .chat-bubble-panel-shadow,
.light .chat-bubble-panel-shadow {
  box-shadow:
    0 24px 60px -20px hsl(30 18% 20% / 0.18),
    0 8px 24px -12px hsl(30 18% 20% / 0.12);
}
```

Justificativa: `shadow-2xl` Tailwind é template-grade. Linear/Stripe usam sombra com offset Y elevado e blur generoso pra criar elevação cinematográfica em popovers.

### Tipografia (sem override)
- Font: `Inter` via body (já default), `font-feature-settings: "cv11", "ss01"` herdado
- Tabular nums em timestamps e badge: `tabular-nums`
- Sem `Racing Sans One` aqui — Bubble é workspace tool, não branding moment

---

## 2. Anatomia geral

```
┌─────────────────────────────────────────────────┐
│  Pipe page (Kanban)                             │
│                                                 │
│                                                 │
│                   [drawer Lead opcional →]      │
│                                                 │
│                                                 │
│                              ┌───────────────┐  │ ← painel z-50
│                              │  Painel 380×  │     (popover desktop /
│                              │    auto       │      sheet mobile)
│                              │               │
│                              │               │
│                              └───────────────┘  │
│                                          ●FAB  │ ← z-40 (FAB sempre)
│                                                 │
│                                          24px →│
│                                            ↑   │
│                                           24px │
└─────────────────────────────────────────────────┘
```

- **FAB** sempre visível em rotas `/pipe/**` (com flag `chatBubble` ON).
- **Painel** condicional ao `isOpen && !isMinimized`.
- **Auto-hide**: `pathname === '/chat' || pathname.startsWith('/chat-whatsapp')` → nada renderiza.
- **Auto-minimize**: drawer Lead aberto + Bubble aberto simultâneos → minimizar Bubble (preserva estado, libera viewport).

---

## 3. FAB

### Composição
```tsx
<motion.button
  className="
    fixed bottom-6 right-6 z-40
    w-14 h-14 rounded-full
    flex items-center justify-center
    text-primary-foreground
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
    transition-shadow duration-200
  "
  style={{ background: 'var(--gradient-primary)', boxShadow: 'var(--shadow-gold)' }}
  whileHover={{ scale: 1.04 }}
  whileTap={{ scale: 0.96 }}
  transition={{ type: 'tween', duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
  aria-label={ariaLabel}
  aria-expanded={isOpen}
  aria-controls="chat-bubble-panel"
  data-testid="chat-bubble-fab"
>
  <AnimatePresence mode="wait" initial={false}>
    {isOpen ? (
      <motion.span key="x" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} transition={{ duration: 0.12 }}>
        <X className="w-6 h-6" />
      </motion.span>
    ) : (
      <motion.span key="msg" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }} transition={{ duration: 0.12 }}>
        <MessageCircle className="w-6 h-6" />
      </motion.span>
    )}
  </AnimatePresence>
  {unreadTotal > 0 && <UnreadBadge count={unreadTotal} />}
</motion.button>
```

### Dimensões
- 56×56 px (`w-14 h-14`)
- Posição: `bottom-6 right-6` (24px de cada borda)
- Radius: `rounded-full`
- Ícone: 24×24 (`w-6 h-6`), Lucide `MessageCircle` (idle) / `X` (open)

### Cores
- Background: `var(--gradient-primary)` (orange→gold)
- Foreground: `text-primary-foreground` (`hsl(30 18% 15%)` — dark on gold)
- Shadow idle: `var(--shadow-gold)`
- Focus ring: padrão `ring-ring` com offset

### Estados
| Estado | Visual |
|--------|--------|
| **Idle** | Gradient + shadow-gold |
| **Hover** | `scale 1.04`, sombra mantida (sem brightness shift — Linear way) |
| **Tap** | `scale 0.96` |
| **Open** | Ícone troca pra X via AnimatePresence |
| **Disabled** (sem instância permitida E `featureFlags.chatBubble`) | Opacity 60%, cursor not-allowed, badge oculto, click abre painel direto no empty-state "sem instância" |
| **Focus-visible** | `ring-2 ring-ring ring-offset-2 ring-offset-background` |

**Sem pulse glow contínuo.** Diferenciação intencional do `OraculoFloatingButton` (Dashboard, gradient roxo, pulse infinito). Bubble vive em workspace de foco prolongado.

### prefers-reduced-motion
- `@media (prefers-reduced-motion: reduce)` → `whileHover`, `whileTap`, `AnimatePresence` ainda funcionam mas com `duration: 0` (troca instantânea).

### Aria
- `aria-label`: dinâmico — `"WhatsApp · ${N} não lida${N>1?'s':''}"` quando unread > 0; `"WhatsApp"` quando 0; `"Fechar conversas"` quando open
- `aria-expanded={isOpen}`
- `aria-controls="chat-bubble-panel"`

---

## 4. Badge unread

### Composição
```tsx
<motion.span
  key={count}
  initial={prefersReducedMotion ? false : { scale: 0 }}
  animate={{ scale: 1.15 }}
  transition={{ duration: 0.42, ease: [0.175, 0.885, 0.32, 1.275] }}
  onAnimationComplete={(d) => { if (d.scale === 1.15) animate(scope, { scale: 1 }, { duration: 0.18 }) }}
  className="
    absolute -top-1 -right-1
    min-w-[18px] h-[18px] px-1.5
    rounded-full
    bg-destructive text-destructive-foreground
    text-[10px] font-bold tabular-nums leading-none
    flex items-center justify-center
    ring-2 ring-background
  "
  aria-hidden
>
  {count > 99 ? '99+' : count}
</motion.span>
```

### Comportamento
- **Pop one-shot ao incrementar** (`key={count}` força remount): `scale 0 → 1.15 → 1`, `cubic-bezier(0.175, 0.885, 0.32, 1.275)`, total 600ms.
- **Idle**: estático.
- `count === 0` → não renderiza.
- `count > 99` → `"99+"`.
- Width auto via `min-w-[18px]` + `px-1.5` (acomoda 1, 2, 3 chars sem reflow).
- Ring `ring-2 ring-background` cria gap óptico entre badge e FAB gold (separação cromática).

### prefers-reduced-motion
- Sem pop. Update direto do count.

### Aria
- Badge é decorativo — `aria-hidden`. Count está no `aria-label` do FAB.

---

## 5. Painel — desktop popover

### Container
```tsx
<motion.div
  id="chat-bubble-panel"
  role="dialog"
  aria-label="WhatsApp"
  initial={{ opacity: 0, scale: 0.95, y: 8 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95, y: 8 }}
  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
  className="
    fixed bottom-24 right-6 z-50
    w-[380px] max-w-[calc(100vw-3rem)]
    h-[min(560px,calc(100dvh-7rem))]
    flex flex-col
    bg-popover text-popover-foreground
    rounded-2xl
    ring-1 ring-border/60
    chat-bubble-panel-shadow
    overflow-hidden
  "
>
  ...
</motion.div>
```

### Dimensões
- Width: 380px (max `calc(100vw-3rem)` previne overflow em viewport <404px)
- Height: `min(560px, calc(100dvh-7rem))` — 7rem = 24px gap inferior + 56px FAB + 24px buffer + 8px folga
- Border radius: `rounded-2xl` (16px) — distinção visual de cards inline (12px)
- Surface: `bg-popover`
- Border: `ring-1 ring-border/60` (não `border` — ring não consome espaço de layout)
- Shadow: `.chat-bubble-panel-shadow` (token novo, ver §1)

### Posição
- `fixed bottom-24 right-6` (24px FAB + 56px FAB altura + 16px gap = 96px = 24 spacing units)
- Z: 50 (mesmo de drawer, mas auto-minimize quando drawer aberto — ver §10)

### Motion
- Entry: `opacity 0 + scale 0.95 + translateY 8 → opacity 1 + scale 1 + y 0`, 200ms, `cubic-bezier(0.16, 1, 0.3, 1)`
- Exit: inversa
- prefers-reduced-motion: `duration: 0`

### Layout interno
```
┌──────────────────────────────────┐
│  Header (sticky)               48│ ← H 48px
├──────────────────────────────────┤
│  Search (lista) OU Thread header │
│                                64│ ← H 56-64px contextual
├──────────────────────────────────┤
│                                  │
│  Body — Lista OU Thread          │
│  (flex-1 overflow-y-auto)        │
│                                  │
├──────────────────────────────────┤
│  Composer (só em thread)       56│ ← H ~56-72px (autosize)
└──────────────────────────────────┘
```

---

## 6. Painel — mobile sheet

### Breakpoint
- `< 768px` → render via shadcn `<Sheet side="bottom">` em vez de popover fixed.

### Composição
```tsx
<Sheet open={isOpen} onOpenChange={(o) => !o && close()}>
  <SheetContent
    side="bottom"
    className="
      h-[88vh] p-0
      rounded-t-2xl
      bg-popover
      border-t border-border/60
      flex flex-col
    "
  >
    ...
  </SheetContent>
</Sheet>
```

### Dimensões
- Height: `88vh` (deixa 12vh respiração superior — sinaliza overlay)
- Radius: `rounded-t-2xl` (apenas top)
- Sem shadow customizada (sheet do shadcn já gere overlay backdrop)

### Drag-handle
- Barra 36×4 px em `bg-muted-foreground/30` no topo, `mx-auto mt-3 mb-1`. Visual cue de "arrastável" (Apple Sheets).

---

## 7. Header do painel

Dois modos: **lista** (default) e **thread** (após selecionar conv). Header fica sticky com glass.

### Background
```css
className="
  sticky top-0 z-10
  flex items-center gap-2 px-4 h-12
  bg-popover/85 backdrop-blur-xl backdrop-saturate-150
  border-b border-border/40
"
```

Coerência com `.topnav-header` ([src/index.css:340](src/index.css#L340)).

### Modo lista
```
┌──────────────────────────────────┐
│  Conversas              [—] [×]  │
└──────────────────────────────────┘
```
- Título: `text-sm font-semibold tracking-tight text-foreground`
- Buttons: ícone-only, 32×32, `Button variant="ghost" size="icon"` shadcn

### Modo thread
```
┌──────────────────────────────────┐
│  [←] ●Avatar  Nome    [—] [×]    │
│             instance·agora       │
└──────────────────────────────────┘
```
- Back button: `ChevronLeft` 16px, `Button variant="ghost" size="icon"` 32×32
- Avatar: 32px, `<Avatar>` shadcn — primary letter do nome em `bg-muted text-foreground/70`
- Color-dot instância (6px) à esquerda do nome quando >1 instância permitida (ver §9)
- Nome: `text-sm font-semibold leading-tight truncate` (max-w fixo via flex-1)
- Linha 2 metadata: `text-[11px] text-muted-foreground/70 truncate` — formato `${instance_name} · ${last_seen_relative}`
- Buttons direita: minimize + close (32×32 cada)

### Aria
- Modo thread: `aria-label="Conversa com ${nome}"` no container
- Back: `aria-label="Voltar para conversas"`
- Minimize: `aria-label="Minimizar"`
- Close: `aria-label="Fechar"`

---

## 8. Search bar (modo lista)

### Composição
```tsx
<div className="px-3 py-2 border-b border-border/40 bg-popover">
  <div className="relative">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" aria-hidden />
    <Input
      type="search"
      placeholder="Buscar contato ou número"
      aria-label="Buscar conversa"
      className="
        h-9 pl-8 pr-3
        bg-muted/40 border-0
        rounded-lg
        text-sm placeholder:text-muted-foreground/60
        focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0
      "
    />
  </div>
</div>
```

### Comportamento
- Debounce 200ms (`useDebounce(query, 200)`)
- Filtra `contacts` localmente: match em `push_name || lead_name || phone_number` (case-insensitive, `.includes()`)
- Esc no input → limpa query (mantém foco). Esc novamente → fecha painel.
- `Cmd/Ctrl+K` no painel → foca search

---

## 9. Lista de conversas

### Density
**`compact`** (`useChatDensity`). Item height: 56px. Avatar: 32px (não 40px do default).

Justificativa hm-designer: 64px era inventado, fora do sistema. `--chat-list-row-height` token canônico já existe ([src/index.css:92](src/index.css#L92)) com 3 modos (compact/comfortable/spacious). Bubble usa compact pela densidade do popover 380×560.

### Item composition
```
┌─────────────────────────────────────────────────┐
│ ●·● Maria Silva                          14:32  │ ← timestamp tabular
│      última mensagem truncada aqui...     [3]   │ ← badge unread (right)
└─────────────────────────────────────────────────┘
   ↑↑
   │└── nome 32px avatar
   └─── color-dot 6px instância (só quando >1)
```

```tsx
<button
  type="button"
  onClick={() => selectConversation(contact.phone_number, instanceId)}
  className="
    relative w-full flex items-start gap-3
    px-3 h-14 [--chat-list-row-height:56px]
    border-b border-border/40
    transition-colors duration-100
    hover:bg-muted/40
    focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-ring/40
    text-left
    data-[selected=true]:bg-muted/60
  "
  data-selected={isSelected}
>
  {/* color-dot instância */}
  {showInstanceDot && (
    <span
      className="absolute left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
      style={{ backgroundColor: instanceColor }}
      aria-hidden
    />
  )}

  {/* avatar */}
  <Avatar className="w-8 h-8 mt-1.5 shrink-0">
    <AvatarFallback className="bg-muted text-foreground/70 text-xs font-medium">
      {initials}
    </AvatarFallback>
  </Avatar>

  {/* nome + preview */}
  <div className="flex-1 min-w-0 py-2">
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium text-foreground truncate">{displayName}</span>
      <span className="text-[10px] tabular-nums text-muted-foreground/60 shrink-0">{relativeTime}</span>
    </div>
    <div className="flex items-center justify-between gap-2 mt-0.5">
      <span className="text-xs text-muted-foreground/80 line-clamp-1">{lastMsgPreview}</span>
      {unreadCount > 0 && (
        <Badge className="h-4 min-w-[16px] px-1 bg-destructive text-destructive-foreground text-[9px] font-bold tabular-nums shrink-0">
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      )}
    </div>
  </div>
</button>
```

### Color-dot instância
- Tamanho: 6×6 px (`w-1.5 h-1.5`)
- Posição: absolute left-1.5, vertical-center
- Cor: hash determinístico de `instance_id` → hue. Função:
  ```ts
  function instanceColor(instanceId: string): string {
    let h = 0;
    for (let i = 0; i < instanceId.length; i++) h = (h * 31 + instanceId.charCodeAt(i)) | 0;
    const hue = Math.abs(h) % 360;
    return `hsl(${hue} 70% 55%)`;
  }
  ```
- Renderiza apenas quando `instances.length > 1`
- Tooltip on hover (Radix `Tooltip`): `instance_name`

### Estados item
| Estado | Visual |
|--------|--------|
| Default | Surface popover |
| Hover | `bg-muted/40` |
| Focus-visible | `bg-muted/40 ring-1 ring-ring/40` |
| Selected | `bg-muted/60` |
| Active (tap) | `scale-[0.99]` (mobile only) |

### Virtualização
- `<= 50 itens`: render plano com `<ScrollArea>`
- `> 50 itens`: `@tanstack/react-virtual` com `estimateSize: 56`. Reusa padrão de [ConversationList.tsx:30](src/components/chat/list/ConversationList.tsx#L30).
- **Não introduzir nova dep** (`react-virtuoso` etc).

### Aria
- Container `<ul role="list">`, items `<li><button>...</button></li>`
- `aria-label` no button: `"Conversa com ${displayName}, ${unread > 0 ? unread + ' não lidas' : 'sem novas mensagens'}"`

---

## 10. Thread (após selecionar conversa)

### Bubbles
**Reusar componentes existentes** de `src/components/chat/view/MessageList.tsx` (canônico do `/chat` moderno). Bubble não duplica visual — herda tokens `--bubble-incoming-*`, `--bubble-outgoing-*`, `--bubble-ai-*`, `--bubble-system-*`.

Diferença única: padding container ajusta pra largura 380px:
```tsx
<MessageList
  messages={messages}
  className="px-3 py-3"
  density="compact"
  bubbleMaxWidth="80%"
/>
```

(Se `MessageList` não aceitar `density`/`bubbleMaxWidth`, engenheiro adiciona props NÃO-breaking — defaults preservam visual /chat.)

### Scroll behavior
- `auto-scroll-to-bottom` quando nova msg ENVIADA pelo usuário
- `auto-scroll-to-bottom` quando nova msg recebida E user já está no bottom (within 100px threshold)
- Se user scrolled up: NÃO auto-scroll. Mostrar `<ScrollToBottomFab>` reusado de [src/components/chat/ScrollToBottomFab.tsx](src/components/chat/ScrollToBottomFab.tsx) ancorado ao container do thread (não viewport).

### Indicador "digitando"
- Fora do escopo PR3 (Uazapi não envia evento `presence` confiável hoje). Não implementar.

---

## 11. Composer — `ChatBubbleComposer` (compact próprio)

### Decisão
**NÃO reusar `ChatComposer` cheio.** Construir versão compact dedicada. Reusa apenas hooks: `useSendWhatsAppMessage`, `useSendWhatsAppMedia`, `useAudioRecorder`. UI inteira própria.

Justificativa: `ChatComposer` carrega slash-commands, scheduling, AI suggest, preview de mídia — overkill em popover 380px e infla bundle inicial.

### Composição
```tsx
<div className="flex items-end gap-1.5 px-3 py-2 border-t border-border/40 bg-popover/95">
  {/* Anexar */}
  <Button
    variant="ghost"
    size="icon"
    className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
    onClick={openImagePicker}
    aria-label="Anexar imagem"
  >
    <Paperclip className="w-4 h-4" />
  </Button>

  {/* Textarea autosize */}
  <Textarea
    value={text}
    onChange={onChange}
    onKeyDown={onKeyDown}
    placeholder="Mensagem"
    aria-label="Mensagem"
    rows={1}
    className="
      flex-1 min-h-[36px] max-h-[120px] py-2 px-3
      resize-none border-0 bg-muted/40
      text-sm placeholder:text-muted-foreground/60
      rounded-xl
      focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0
    "
  />

  {/* Mic ↔ Send contextual */}
  <Button
    variant="default"
    size="icon"
    className="h-9 w-9 shrink-0 rounded-full"
    style={text.trim() ? undefined : { background: 'transparent', color: 'hsl(var(--muted-foreground))' }}
    onClick={text.trim() ? handleSend : handleMicToggle}
    disabled={isSending}
    aria-label={text.trim() ? 'Enviar mensagem' : isRecording ? 'Parar gravação' : 'Gravar áudio'}
  >
    {text.trim() ? <Send className="w-4 h-4" /> : isRecording ? <StopCircle className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
  </Button>
</div>
```

### Convenção mic ↔ send
- Textarea vazio → botão é **mic** (`variant="ghost"`, transparent + muted-foreground)
- Textarea com texto → botão é **send** (`variant="default"`, gold gradient herdado do primary)
- Recording → botão é **stop** (`variant="destructive"`)

Convenção do WhatsApp Web/Mobile. Familiaridade do usuário B2B.

### Keyboard
- `Enter` → envia. `Shift+Enter` → newline.
- `Esc` no textarea → blur (não fecha painel).
- Recording state: `Esc` cancela gravação.

### Anexar imagem
- `<input type="file" accept="image/*" hidden ref={fileInputRef}>` + Paperclip trigger
- Preview inline acima do composer ANTES de enviar (modal `ImagePreviewModal` reusado)
- Sem dropzone (mantém compact)

### Áudio
- Reusa hook do `AudioRecorder` ([src/components/chat/media/AudioRecorder.tsx](src/components/chat/media/AudioRecorder.tsx))
- Recording state: textarea vira indicador visual `● 0:12` (timer + dot vermelho `bg-destructive animate-pulse-success`)
- Cancelar: swipe-left mobile / Esc desktop / botão X que aparece à esquerda durante recording

### Padding/altura
- Container: `px-3 py-2` (12px H, 8px V)
- Textarea: `min-h-[36px] max-h-[120px]` (1-4 linhas autosize)
- Buttons: 36×36 (`h-9 w-9`)

---

## 12. Estados completos

### 12.1 Loading inicial
```tsx
<div className="flex flex-col gap-1 px-3 py-3">
  {[1,2,3,4,5].map(i => (
    <div key={i} className="flex items-center gap-3 py-2">
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-44" />
      </div>
    </div>
  ))}
</div>
```

- 5 skeleton items
- `Skeleton` shadcn (`bg-muted animate-pulse` herdado)
- Stagger opcional: cada skeleton com `animation-delay` em 60ms steps. prefers-reduced-motion → sem stagger.

### 12.2 Empty — sem conversas ainda
```tsx
<div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
  <MessageCircleDashed className="w-8 h-8 text-muted-foreground/40" aria-hidden />
  <div className="space-y-1">
    <p className="text-sm font-medium text-foreground/80">Nenhuma conversa por aqui</p>
    <p className="text-xs text-muted-foreground">Quando alguém responder no WhatsApp, aparece aqui.</p>
  </div>
</div>
```

### 12.3 Empty — sem instância conectada
```tsx
<div className="flex flex-col items-center justify-center text-center px-6 py-12 gap-3">
  <PlugZap className="w-8 h-8 text-warning/70" aria-hidden />
  <div className="space-y-1">
    <p className="text-sm font-medium text-foreground/80">Nenhum WhatsApp conectado</p>
    <p className="text-xs text-muted-foreground">Conecte um número pra começar a conversar com leads.</p>
  </div>
  <Button variant="outline" size="sm" asChild>
    <Link to="/configuracoes/whatsapp">Conectar WhatsApp</Link>
  </Button>
</div>
```

### 12.4 Sem permissão (banner inline em thread)
**Posição**: rodapé do thread, ONDE composer ficaria. Substitui composer.
```tsx
<div className="flex items-center gap-2 px-4 py-3 border-t border-border/40 bg-destructive/10 text-destructive">
  <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden />
  <p className="text-xs leading-snug">
    Você não tem permissão pra responder nesta instância. Peça acesso ao admin.
  </p>
</div>
```

### 12.5 Erro realtime (pill no topo)
```tsx
<div className="flex items-center justify-center gap-2 mx-3 mt-3 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/20 text-warning text-[11px]">
  <WifiOff className="w-3 h-3" aria-hidden />
  <span>Reconectando…</span>
</div>
```

- Mostra apenas quando `realtime.status === 'CHANNEL_ERROR' || 'TIMED_OUT'`
- Auto-some em <300ms quando status volta pra `SUBSCRIBED`

### 12.6 Sem telefone (CTA do drawer Lead)
- Drawer chama `openBubble({ phone: null, leadName })`
- Bubble abre normalmente (lista global)
- Toast inferior: `text-xs` — "Adicione um telefone do lead pra abrir a conversa."
- Toast usa `useToast()` existente. Variant: default (não destructive — não é erro do user). Duration: 4s.

### 12.7 Erro de envio (toast)
- Reusa toast existente do `useSendWhatsAppMessage` (já implementado em hooks). Sem mudança visual.

---

## 13. Motion completo (resumo)

| Elemento | Trigger | Curva | Duração |
|----------|---------|-------|---------|
| FAB hover | `whileHover` | `cubic-bezier(0.16, 1, 0.3, 1)` | 150ms |
| FAB tap | `whileTap` | tween default | 100ms |
| FAB icon swap | `AnimatePresence mode="wait"` | tween | 120ms |
| Badge pop (incremento) | `key={count}` remount | `cubic-bezier(0.175, 0.885, 0.32, 1.275)` | 420ms (overshoot) + 180ms settle |
| Painel entry | `AnimatePresence` | `cubic-bezier(0.16, 1, 0.3, 1)` | 200ms |
| Painel exit | inversa | mesma | 200ms |
| Item hover | CSS transition | linear | 100ms |
| Skeleton | `animate-pulse` Tailwind | linear infinite | 2s |

### prefers-reduced-motion: reduce
- TODOS os `motion.*` viram `duration: 0`
- Skeleton mantém pulse (background-color shift apenas, sem transform)
- Badge pop → troca instantânea
- Painel slide → dissolve simples (opacity only, sem scale/translate)

---

## 14. Z-index map

| Camada | z |
|--------|---|
| TopNav (sticky) | 50 (existente) |
| Drawer Lead (Radix Dialog) | 50 |
| Painel Bubble | 50 |
| FAB | 40 |
| Onboarding pill | 40 (existente) |
| Toasts | 100 (existente) |

### Regra de coexistência
- **FAB sempre clicável** — z-40 garante que drawer/dialog não sobrepõe
- **Painel + drawer Lead simultâneos**: auto-minimize do painel quando drawer abre. Implementação:
  - Engenheiro escuta estado global de drawer Lead (verificar se hook existe; senão, criar `useGlobalLeadDrawerState` ou usar contexto Radix Dialog `data-state`)
  - Quando drawer state vira `open`: `if (chatBubble.isOpen) chatBubble.toggleMinimized()`
  - **NÃO fecha** — preserva `selectedPhone`/`selectedInstanceId`. Drawer fecha → painel volta automático (se `wasOpenBeforeDrawer === true`)

---

## 15. Acessibilidade

### Keyboard nav
| Tecla | Ação |
|-------|------|
| `Tab` no FAB | Foca FAB com ring visível |
| `Enter`/`Space` no FAB | Toggle painel |
| `Esc` painel aberto | Fecha painel (modo lista) ou volta pra lista (modo thread) |
| `Esc` segundo `Esc` | Fecha painel |
| `Cmd/Ctrl+K` no painel | Foca search (modo lista) |
| `Enter` em item lista | Abre thread |
| `Enter` no composer | Envia |
| `Shift+Enter` | Newline no composer |
| `↑/↓` em lista | Navega entre items |

### ARIA roles
- FAB: `<button aria-label aria-expanded aria-controls>`
- Painel: `<div role="dialog" aria-label="WhatsApp">`
- Lista: `<ul role="list">` items `<li><button>`
- Thread: `<div role="log" aria-label="Mensagens com {nome}" aria-live="polite">`
- Composer textarea: `aria-label="Mensagem"`
- Banner sem permissão: `role="status"` (não-bloqueante, informativo)
- Erro realtime: `role="status" aria-live="polite"`

### Contraste WCAG AA
| Combinação | Ratio (alvo ≥ 4.5:1 texto, ≥ 3:1 UI) | Token |
|------------|--------------------------------------|-------|
| Foreground / popover | 14.2:1 (dark) | `--foreground` / `--popover` |
| Muted-foreground / popover | 4.8:1 (dark) | `--muted-foreground` / `--popover` |
| Primary-foreground / gradient gold | 8.1:1 | `hsl(30 18% 15%)` / gold |
| Destructive-foreground / destructive | 5.4:1 | white / red |

### Focus management
- Ao abrir painel: focus trap no painel (Radix Dialog cuida quando wrapper `<Dialog>`; em popover custom, implementar com `react-focus-lock` ou similar — engenheiro avalia)
- Ao fechar: foco retorna pro FAB
- Ao selecionar conversa: foco vai pro composer (se permitido) ou pro back button (se sem permissão)

---

## 16. Microcopy completa (PT-BR)

| Lugar | Cópia |
|-------|-------|
| FAB tooltip idle | "Conversas no WhatsApp" |
| FAB tooltip open | "Fechar" |
| FAB aria-label (com unread) | "WhatsApp · {N} não lida{s}" |
| FAB aria-label (sem unread) | "WhatsApp" |
| FAB aria-label (open) | "Fechar conversas" |
| Header título (lista) | "Conversas" |
| Search placeholder | "Buscar contato ou número" |
| Search aria-label | "Buscar conversa" |
| Empty (sem conv) — headline | "Nenhuma conversa por aqui" |
| Empty (sem conv) — body | "Quando alguém responder no WhatsApp, aparece aqui." |
| Empty (sem instância) — headline | "Nenhum WhatsApp conectado" |
| Empty (sem instância) — body | "Conecte um número pra começar a conversar com leads." |
| Empty (sem instância) — CTA | "Conectar WhatsApp" |
| Sem permissão (banner) | "Você não tem permissão pra responder nesta instância. Peça acesso ao admin." |
| Reconectando (pill) | "Reconectando…" |
| Sem telefone (toast) | "Adicione um telefone do lead pra abrir a conversa." |
| Composer placeholder | "Mensagem" |
| Composer aria-label | "Mensagem" |
| Send aria-label | "Enviar mensagem" |
| Mic aria-label idle | "Gravar áudio" |
| Mic aria-label recording | "Parar gravação" |
| Anexar aria-label | "Anexar imagem" |
| Minimize aria-label | "Minimizar" |
| Close aria-label | "Fechar" |
| Back aria-label | "Voltar para conversas" |
| Recording timer prefix | "Gravando" (screen reader: `aria-label="Gravando, {seconds} segundos"`) |
| Erro envio (toast existente) | mantém fórmula atual do hook |

**Regras de tom**:
- Sem fluff ("Ops!", "Algo deu errado", "Por favor")
- Sem ponto final em headlines curtos (≤4 palavras)
- Headlines: PrimeiraLetraMaiúscula apenas
- Vírgulas naturais — "Quando alguém responder no WhatsApp, aparece aqui." vs "Quando alguem responder, no WhatsApp aparece aqui"
- 2ª pessoa direta ("Você não tem", "Adicione um telefone")

---

## 17. Aceite (checklist QA visual)

- [ ] Items lista usam token canônico `--chat-list-row-height` density compact (56px), avatar 32px
- [ ] FAB sem rotate de 15°; ícone interno troca via `AnimatePresence` (Linear way)
- [ ] FAB hover = `scale 1.04` `cubic-bezier(0.16, 1, 0.3, 1)` 150ms; tap = `scale 0.96` 100ms
- [ ] Pulse badge é one-shot ao incrementar (`key={count}`), NÃO loop infinito
- [ ] Diferenciação clara do `OraculoFloatingButton`: gold gradient + sem pulse contínuo
- [ ] Painel: `chat-bubble-panel-shadow` (custom token) + `ring-1 ring-border/60` + `rounded-2xl`
- [ ] Altura painel responsiva: `min(560px, calc(100dvh - 7rem))`
- [ ] Header sticky usa fórmula de glass do `.topnav-header` (`backdrop-blur-xl backdrop-saturate-150 bg-popover/85`)
- [ ] Tag instância = color-dot 6px hash-derived, só quando >1 instância
- [ ] Cada estado (empty/sem-instância/sem-permissão/erro/sem-tel) tem composição visual completa
- [ ] Composer = versão compact própria (`ChatBubbleComposer`), reusa apenas hooks
- [ ] Mic+Send = botão único contextual (textarea-empty → mic; texto → send)
- [ ] Recording state: textarea vira "● 0:12" + dot vermelho `animate-pulse-success`
- [ ] Microcopy completa em §16 — sem TBDs em código
- [ ] FAB z-40, painel z-50, regra auto-minimize quando drawer Lead aberto
- [ ] `prefers-reduced-motion: reduce` dispara fallback em FAB hover/badge pop/painel slide/skeleton stagger
- [ ] Spec só usa tokens existentes em `src/index.css` + 1 helper `.chat-bubble-panel-shadow`
- [ ] Inter via body herdado (`font-feature-settings: "cv11", "ss01"` automático)
- [ ] Bubbles thread reusam `view/MessageList.tsx` canônico — zero divergência visual de `/chat`
- [ ] Bundle delta < 30KB gzipped (lazy-load do painel)
- [ ] Dark mode: spec especifica `chat-bubble-panel-shadow` com sombra dark-tuned; light mode tem variante
- [ ] Light mode passa WCAG AA em todos os textos contra surfaces

---

## 18. Estrutura de arquivos esperada

```
src/components/chat/bubble/
  ChatBubble.tsx                 # Wrapper raiz (render condicional + lazy)
  ChatBubbleFab.tsx              # FAB
  ChatBubbleBadge.tsx            # Badge unread (motion)
  ChatBubblePanel.tsx            # Painel container (popover/sheet responsivo)
  ChatBubbleHeader.tsx           # Header dual-mode (lista/thread)
  ChatBubbleSearch.tsx           # Search bar
  ChatBubbleConversationList.tsx # Lista (compact, próprio)
  ChatBubbleConversationItem.tsx # Item da lista (compact)
  ChatBubbleThread.tsx           # Thread (reusa MessageList)
  ChatBubbleComposer.tsx         # Composer compact próprio
  ChatBubbleEmptyState.tsx       # Estados vazio/sem-instância
  ChatBubblePermissionBanner.tsx # Banner sem permissão
  ChatBubbleRealtimePill.tsx     # Pill reconectando
  index.ts                       # exports + lazy
  utils/instanceColor.ts         # Hash → hue
```

```
src/contexts/ChatBubbleContext.tsx
src/hooks/useChatBubbleState.ts
```

CSS:
```
src/index.css — adicionar @layer components:
  .chat-bubble-panel-shadow { ... }
```

---

## 19. Referências

- **Linear** — sidebar trigger (icon swap não FAB rotate); densidade compact 56px; color-dot por workspace na lista
- **Stripe Dashboard** — popover de inbox (380px width, sombra Y-elevated 24px)
- **Vercel** — quietude motion (sem pulses contínuos; impulso curto e some)
- **Apple Messages / iOS** — composer mic↔send contextual; sheet bottom drag-handle
- **WhatsApp Web** — convenção UX mic↔send (familiaridade B2B do usuário)
- **shadcn/ui Radix** — Sheet, Popover, Avatar, Button, Input, Textarea, Skeleton, Badge, Tooltip
- Ref interna: `/chat` moderno — bubbles canônicas em `view/MessageList.tsx`, escala de tipografia consistente

---

## 20. Fora-de-escopo (PR3)

- Indicador "digitando" / presence
- Notificações push do browser
- Reactions inline em thread
- Drag-and-drop de imagem no composer (só picker via Paperclip)
- Múltiplas conversas em tabs dentro do painel
- Histórico de chats arquivados (apenas active)
- Search global cross-instâncias com fuzzy matching avançado
- Mensagens agendadas
- Slash commands

Esses ficam pra iterações futuras (PR5+).
