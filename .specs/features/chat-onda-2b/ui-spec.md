# UI Spec — Chat Onda 2b

**Branch:** `feat/chat-ux-ui-redesign`
**Autor:** UI (agent-ui)
**Data:** 2026-04-22
**Input de Contexto Lido:**
- Architect Plan `chat-onda-2b/architect-plan.md` §1–§6
- UI Spec 2a `chat-onda-2a/ui-spec-bubble-density.md` (tokens bubble + density — herdados)
- `src/index.css` — design system tokens confirmados
- `tailwind.config.ts` — utilitários existentes

**Refs visuais:** Linear command menu, Intercom AI pill, Notion search highlight, Apple Spotlight, Missive unified inbox

---

## Design System — tokens consumidos nesta onda

### Tokens existentes reutilizados

| Token | Valor (dark) | Uso |
|-------|-------------|-----|
| `--background` | `36 20% 12%` | page bg, command palette backdrop base |
| `--foreground` | `45 20% 95%` | texto primário |
| `--card` | `36 20% 16%` | surface elevada — dialog command palette dark |
| `--border` | `36 15% 25%` | bordas gerais |
| `--muted` | `36 15% 22%` | hover states, group headers |
| `--muted-foreground` | `45 15% 70%` | texto terciário, group headers, timestamps |
| `--primary` | `47 100% 50%` | ring, accent gold |
| `--primary-foreground` | `30 18% 15%` | texto sobre primary |
| `--ring` | `47 100% 50%` | focus ring |
| `--destructive` | `0 62% 50%` | ações destructivas, revert |
| `--success` | `142 70% 45%` | estado HUMAN_ACTIVE (verde) |
| `--warning` | `38 92% 50%` | estado AI_PAUSED (amber-ish) |

### Novos tokens necessários — command palette

Adicionar em `src/index.css` no bloco `:root` (após `--shadow-gold`) e no bloco `.dark`:

```css
/* ─── Command Palette tokens ────────────────────────────── */
/* :root (light) */
--command-palette-bg:           0 0% 100%;
--command-palette-border:       220 10% 88%;
--command-palette-shadow:       220 15% 60%;

/* html.dark, .dark */
--command-palette-bg:           220 15% 10%;
--command-palette-border:       220 10% 20%;
--command-palette-shadow:       0 0% 0%;
```

**Justificativa:** o popover/card do sistema usa `--card` (`36 20% 16%` dark) que tem hue warm 36°. O command palette é um elemento de comando global — deve ter hue neutral-cool (220°) para criar separação perceptiva do chat warm. Não é decoração: diferença de hue sinaliza "mudei de modo/contexto". Referência direta: Linear command menu (`hsl(220 15% 10%)` dark).

Light: branco puro (não off-white 42°) — paleta de comando deve ter máximo contraste com itens. Ref: Spotlight da Apple, Linear.

### Novos tokens — pill states TakeoverControls

Não adicionar CSS vars novos. Usar classes Tailwind com modificadores de opacidade direto nos componentes:

```
AI_ACTIVE:        bg-primary/10  text-primary  border-primary/30
AI_PAUSED_MANUAL: bg-amber-500/10  text-amber-700 dark:text-amber-300  border-amber-500/30
WAITING_HUMAN:    bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30
HUMAN_ACTIVE:     bg-green-500/10  text-green-700  dark:text-green-300  border-green-500/30
HANDOFF_BACK:     bg-blue-500/10   text-blue-700   dark:text-blue-300   border-blue-500/30
```

Não criar tokens para esses estados — são semânticos de produto, não do design system base. Colocar no `aiStateLabels.ts` como objetos de configuração por estado (ver §3.2).

---

## Hierarquia visual

- **Primário:** ação que transiciona o estado da IA (pill + dropdown TakeoverControls)
- **Secundário:** busca e navegação (CommandPalette)
- **Terciário:** auditoria e contexto (AITimeline, search highlights)

---

## Componentes

---

### 1. CommandPalette

**Referência visual:** Linear command menu + Apple Spotlight

**Arquivos:** `src/components/command/CommandPalette.tsx` + `CommandPaletteProvider.tsx`

#### Mockup descritivo

```
╔══════════════════════════════════════════════════════╗
║ [🔍] Buscar ações, conversas, leads...               ║
╠══════════════════════════════════════════════════════╣
║ RECENTES                                             ║
║  [↩ ] Analytics                              ⌘A     ║  ← selected: bg-muted/60
║  [↩ ] Toggle dark mode                              ║
╠══════════════════════════════════════════════════════╣
║ NAVEGAÇÃO                                            ║
║  [🏠] Dashboard                                     ║
║  [👥] Leads                                         ║
║  [🤖] Copilot                                       ║
╠══════════════════════════════════════════════════════╣
║  ↑↓ navegar · ↵ selecionar · esc fechar             ║
╚══════════════════════════════════════════════════════╝
      max-w-[640px] · centered · rounded-xl
```

#### Primitivo

`cmdk` (`Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`) envolto em shadcn `Dialog`.

NÃO usar `DialogContent` diretamente — o `cmdk` controla seu próprio scroll interno. Usar `Dialog` apenas para o backdrop e o `role="dialog"`.

#### Estrutura de classes

**Backdrop/overlay:**
```tsx
// Overlay custom — não usar DialogOverlay padrão (muito opaco)
<div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md" />
```

**Dialog container:**
```tsx
<div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
  <Command
    className={cn(
      "w-[90vw] max-w-[640px]",
      "rounded-xl border shadow-2xl",
      "bg-[hsl(var(--command-palette-bg))]",
      "border-[hsl(var(--command-palette-border))]",
      "overflow-hidden"
    )}
  >
    ...
  </Command>
</div>
```

**Input:**
```tsx
<CommandInput
  placeholder="Buscar ações, conversas, leads..."
  className={cn(
    "h-12 px-4 text-sm",              // altura generosa — tap target
    "bg-transparent",
    "border-b border-border/60",
    "placeholder:text-muted-foreground/60",
    "focus:outline-none"
  )}
  // ícone Search 16px à esquerda via wrapperClassName
/>
```

Ícone `Search` (Lucide, `h-4 w-4`, `text-muted-foreground`) posicionado em `absolute left-4` dentro de um wrapper relativo.

**Group header:**
```tsx
<CommandGroup heading="Recentes">
  {/* heading renderizado como: */}
</CommandGroup>
// Override CSS do cmdk heading:
// [cmdk-group-heading]:text-[11px] [cmdk-group-heading]:font-medium
// [cmdk-group-heading]:uppercase [cmdk-group-heading]:tracking-wider
// [cmdk-group-heading]:text-muted-foreground
// [cmdk-group-heading]:px-3 [cmdk-group-heading]:py-1.5
```

**Item:**
```tsx
<CommandItem
  className={cn(
    "flex items-center gap-3 px-3 py-2.5 rounded-md mx-1",
    "cursor-default select-none",
    "data-[selected=true]:bg-muted/60",
    "hover:bg-muted/40",
    "transition-colors duration-75"
  )}
>
  {/* Ícone: h-4 w-4, text-muted-foreground (default) ou cor semântica */}
  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />

  {/* Label + description */}
  <div className="flex flex-col min-w-0 flex-1">
    <span className="text-sm font-medium leading-tight truncate text-foreground">
      {label}
    </span>
    {description && (
      <span className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
        {description}
      </span>
    )}
  </div>

  {/* Shortcut kbd */}
  {shortcut && (
    <div className="flex items-center gap-0.5 ml-auto shrink-0">
      {shortcut.map((key) => (
        <kbd
          key={key}
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded",
            "bg-muted text-muted-foreground",
            "border border-border/60",
            "font-mono leading-none"
          )}
        >
          {key}
        </kbd>
      ))}
    </div>
  )}
</CommandItem>
```

**Separador entre grupos:** `<CommandSeparator className="my-1 bg-border/40" />`

**Footer de hints:**
```tsx
<div className={cn(
  "flex items-center gap-4 px-4 py-2",
  "border-t border-border/40",
  "text-[10px] text-muted-foreground/70"
)}>
  <span><kbd className="font-mono">↑↓</kbd> navegar</span>
  <span><kbd className="font-mono">↵</kbd> selecionar</span>
  <span><kbd className="font-mono">esc</kbd> fechar</span>
</div>
```

**Empty state:**
```tsx
<CommandEmpty className="py-10 text-center">
  <p className="text-sm text-muted-foreground">Nenhum resultado</p>
  <p className="text-xs text-muted-foreground/60 mt-1">
    Tente "leads", "analytics" ou o nome de um contato
  </p>
</CommandEmpty>
```

#### Estados visuais

| Estado | Visual |
|--------|--------|
| default | item: texto `foreground`, bg transparente |
| hover | `bg-muted/40`, transição 75ms |
| selected (teclado) | `bg-muted/60` — levemente mais escuro que hover |
| disabled | `opacity-40 pointer-events-none` |
| focus (input) | sem ring no input — o próprio dialog é o contexto de foco |
| loading (search) | spinner `animate-spin h-3 w-3 border-2 border-primary/30 border-t-primary rounded-full` no lugar do ícone Search |

#### Motion

```tsx
// Framer Motion — AnimatePresence envolve o dialog
<AnimatePresence>
  {isOpen && (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="fixed inset-0 z-50 bg-background/70 backdrop-blur-md"
      />
      {/* Palette */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      >
        <Command ...>...</Command>
      </motion.div>
    </>
  )}
</AnimatePresence>
```

**Propósito da animação:** entrance suave guia o olhar para o centro sem flash abrupto. Scale 0.96→1 = pequena perspectiva de "surgir de dentro da tela" (Spotlight-like). Exit é o inverso — 150ms (mais rápido) porque fechar deve ser instantâneo percepcionalmente.

**prefers-reduced-motion:**
```tsx
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Se true: initial/animate/exit = { opacity: [0,1,0] } apenas. Sem scale, sem y.
```

#### Acessibilidade

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-label="Paleta de comandos"
>
  <Command loop> {/* cmdk loop = ↓ no último vai pro primeiro */}
    <CommandInput autoFocus />
    ...
  </Command>
</div>
```

- **Focus trap:** usar `@radix-ui/react-focus-trap` (já disponível via shadcn Dialog) ou o `useFocusTrap` do Radix. Alternativa: `cmdk` já gerencia foco internamente quando `autoFocus` no input.
- **Restore focus:** no `close()`, usar `previousFocusRef.current?.focus()`.
- **Escape:** `cmdk` nativo ou `onKeyDown` no root do dialog.

---

### 2. TakeoverControls

**Referência visual:** Intercom AI badge + Linear status pill

**Arquivos:** `src/components/chat/takeover/TakeoverControls.tsx`, `src/components/chat/takeover/aiStateLabels.ts`

#### Mockup descritivo

```
ChatHeader:
┌─────────────────────────────────────────────────────────────────┐
│ [avatar] Rodrigo Lima          [IA ativa ▾] [IA●] [⋮⋮] [···]   │
└─────────────────────────────────────────────────────────────────┘
                                 ↑ TakeoverControls

Pill expanded (dropdown aberto, estado AI_ACTIVE):
┌────────────────────────┐
│ ✓ Pausar IA — agora    │
│   Pausar após resposta │
│   Não retomar (manual) │
│ ─────────────────────  │
│   Ver timeline IA      │
└────────────────────────┘
```

#### aiStateLabels.ts

```ts
import { Bot, Pause, Hand, User, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AiState } from "@/lib/chat-types";

interface StateConfig {
  label: string;
  icon: LucideIcon;
  pillClasses: string;  // Tailwind classes completas
  ariaLabel: string;
}

export const AI_STATE_CONFIG: Record<AiState, StateConfig> = {
  AI_ACTIVE: {
    label: "IA ativa",
    icon: Bot,
    pillClasses: "bg-primary/10 text-primary border-primary/30",
    ariaLabel: "IA está respondendo automaticamente",
  },
  AI_PAUSED_MANUAL: {
    label: "IA pausada",
    icon: Pause,
    pillClasses: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    ariaLabel: "IA pausada manualmente",
  },
  WAITING_HUMAN: {
    label: "Aguardando você",
    icon: Hand,
    pillClasses: "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30",
    ariaLabel: "IA pediu intervenção humana — aguardando operador",
  },
  HUMAN_ACTIVE: {
    label: "Você assumiu",
    icon: User,
    pillClasses: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/30",
    ariaLabel: "Operador humano está controlando a conversa",
  },
  HANDOFF_BACK: {
    label: "Retomando IA",
    icon: RefreshCw,
    pillClasses: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
    ariaLabel: "Conversa sendo transferida de volta para a IA",
  },
};
```

#### Pill — classes exatas

```tsx
const { label, icon: Icon, pillClasses, ariaLabel } = AI_STATE_CONFIG[state];

<button
  type="button"
  role="group"                           // grupo semântico pill + dropdown
  aria-label={ariaLabel}
  aria-haspopup="menu"
  aria-expanded={isOpen}
  className={cn(
    "inline-flex items-center gap-1.5",
    "h-7 pl-2 pr-1.5 rounded-full",     // pr menor: acomoda ChevronDown 12px
    "border text-[11px] font-medium",
    "transition-all duration-150",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "focus-visible:ring-offset-background",
    pillClasses                          // classes semânticas por estado
  )}
  style={{
    // Hover: brightness sutil sem mudar a cor semântica
    filter: isHovered ? "brightness(1.05)" : undefined,
  }}
  onMouseEnter={() => setIsHovered(true)}
  onMouseLeave={() => setIsHovered(false)}
  onClick={() => setIsOpen(!isOpen)}
>
  <Icon className="h-3 w-3 shrink-0" aria-hidden />
  <span>{label}</span>
  <ChevronDown
    className={cn(
      "h-3 w-3 shrink-0 transition-transform duration-150",
      isOpen && "rotate-180"
    )}
    aria-hidden
  />
</button>
```

**Por que `filter: brightness` e não classe Tailwind?**
As classes `pillClasses` usam cores Tailwind opacas (amber, orange, green, blue) que não têm utilitários `hover:brightness-*` diretos no Tailwind 3. `brightness(1.05)` via inline style é a forma precisa de clarear levemente qualquer hue sem duplicar classes por estado. Alternativa aceitável: `hover:opacity-90` — mais simples mas inverte o efeito (escurece). Preferir brightness.

#### Dropdown — ações por estado

```tsx
<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
  <DropdownMenuContent
    align="end"
    className="w-52 text-sm"
    // sem sideOffset — pills já tem gap pelo header padding
  >
    {/* Ações condicionais por estado — geradas via canTransition() */}
    {state === "AI_ACTIVE" && (
      <>
        <DropdownMenuItem onSelect={() => pauseAi("immediate")}>
          <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
          Pausar IA — agora
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pauseAi("after_response")}>
          <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
          Pausar após resposta
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pauseAi("dont_resume")}>
          <Pause className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
          Não retomar automaticamente
        </DropdownMenuItem>
      </>
    )}
    {(state === "AI_PAUSED_MANUAL" || state === "HUMAN_ACTIVE") && (
      <DropdownMenuItem onSelect={() => resumeAi()}>
        <Bot className="h-3.5 w-3.5 mr-2 text-primary" />
        Retomar IA
      </DropdownMenuItem>
    )}
    {state === "WAITING_HUMAN" && (
      <>
        <DropdownMenuItem onSelect={() => markHumanActive()}>
          <User className="h-3.5 w-3.5 mr-2 text-green-500" />
          Assumir conversa
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => resumeAi()}>
          <Bot className="h-3.5 w-3.5 mr-2 text-primary" />
          Descartar handoff
        </DropdownMenuItem>
      </>
    )}
    {state === "HUMAN_ACTIVE" && (
      <DropdownMenuItem onSelect={() => markHandoffBack()}>
        <RefreshCw className="h-3.5 w-3.5 mr-2 text-blue-500" />
        Devolver para IA
      </DropdownMenuItem>
    )}
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={openAITimeline} className="text-muted-foreground">
      <Clock className="h-3.5 w-3.5 mr-2" />
      Ver histórico da IA
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

#### Estados visuais do pill

| Estado | Visual |
|--------|--------|
| default | pill com `pillClasses` por AiState |
| hover | `brightness(1.05)` — 150ms |
| focus | `ring-2 ring-ring ring-offset-2 ring-offset-background` |
| loading (mutation) | ícone substituído por `animate-spin` spinner `h-3 w-3` |
| disabled | não usar — pill sempre ativa (usuário precisa saber o estado mesmo sem poder agir) |

#### Posição no ChatHeader

Ordem de elementos (RTL display: flex, gap-2, items-center):
```
[··· menu overflow]  [DensityToggle]  [IA toggle]  [TakeoverControls]  [nome+sub | avatar]
```

TakeoverControls vem **antes** do IA toggle — é a ação mais importante quando há handoff pendente.

#### Aria live

```tsx
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {/* Atualizado ao mudar state */}
  {AI_STATE_CONFIG[state].ariaLabel}
</div>
```

#### Motion — transição de estado

```tsx
// Animar mudança de label/cor via layout animation
<motion.div
  key={state}               // key muda → Framer anima saída/entrada
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.15 }}
>
  <Icon ... />
  <span>{label}</span>
</motion.div>
```

Propósito: confirmar visualmente que a transição de estado aconteceu. Sem scale — é pill pequeno, scale seria excessivo.

**prefers-reduced-motion:** `<AnimatePresence initial={false}>` + `transition={{ duration: 0 }}` quando `prefersReduced`.

---

### 3. AITimeline

**Referência visual:** Linear activity feed + Intercom conversation timeline

**Arquivos:** `src/components/chat/takeover/AITimeline.tsx`

#### Mockup descritivo

```
AITimeline (dentro de ContextPanelInfo, seção expansível)

  ┌────────────────────────────────────────────────┐
  │ HISTÓRICO DA IA                           [∧]  │ ← header clicável (collapse)
  ├────────────────────────────────────────────────┤
  │                                                │
  │  14:32  [→] Mensagem enviada                   │ ← message_sent
  │         "Olá Rodrigo, como posso ajudar..."    │
  │                                                │
  │  14:35  [⚡] Ação executada                    │ ← action_executed (amber)
  │         Moveu para stage: respondeu            │
  │         [Reverter]                             │ ← hover revela btn
  │                                                │
  │  14:40  [→] Mensagem enviada                   │
  │         "Vou te enviar nossa proposta..."       │
  │                                                │
  │  14:52  [🕐] Silêncio detectado                │ ← silence_detected (muted)
  │         Sem resposta por 12 min                │
  │                                                │
  │  15:01  [✋] Handoff solicitado                │ ← handoff_triggered (orange)
  │         Lead fez pergunta fora do escopo       │
  │                                                │
└─────────────────────────────────────────────────┘
```

#### Primitivo

`<ol>` semântico com `<li>` por evento. Não usar `<ul>` — lista ordenada (cronológica) é `<ol>`.

#### Estrutura de classes

**Container:**
```tsx
<section aria-label="Histórico de ações da IA">
  <button
    type="button"
    className={cn(
      "flex items-center justify-between w-full",
      "px-4 py-3 text-left",
      "border-b border-border/40",
      "hover:bg-muted/20 transition-colors duration-100"
    )}
    onClick={() => setExpanded(!expanded)}
    aria-expanded={expanded}
  >
    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      Histórico da IA
    </span>
    <ChevronDown
      className={cn(
        "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
        !expanded && "-rotate-90"
      )}
    />
  </button>

  {expanded && (
    <ScrollArea className="max-h-[320px]">
      <ol className="space-y-0 py-2">
        {events.map((event) => (
          <AITimelineEvent key={event.id} event={event} />
        ))}
      </ol>
    </ScrollArea>
  )}
</section>
```

**Evento individual (`AITimelineEvent`):**
```tsx
<li className="relative flex gap-3 px-4 py-2 group hover:bg-muted/10 transition-colors duration-100">
  {/* Connector vertical */}
  {!isLast && (
    <div className="absolute left-[calc(1rem+14px)] top-[28px] bottom-0 border-l border-border/30" />
  )}

  {/* Timestamp column — min-w fixo para alinhar */}
  <time
    dateTime={event.created_at}
    className="min-w-[44px] pt-0.5 text-[10px] text-muted-foreground tabular-nums leading-none shrink-0"
  >
    {formatTime(event.created_at)}  {/* ex: "14:32" */}
  </time>

  {/* Ícone + conteúdo */}
  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
    <div className="flex items-center gap-1.5">
      <EventIcon className={cn("h-3.5 w-3.5 shrink-0", EVENT_ICON_COLOR[event.type])} />
      <span className="text-xs font-medium text-foreground leading-tight">
        {EVENT_LABELS[event.type]}
      </span>
    </div>
    {event.description && (
      <p className="text-[11px] text-muted-foreground leading-tight truncate">
        {event.description}
      </p>
    )}

    {/* Revert button — aparece no hover, apenas em eventos revertíveis */}
    {isRevertible(event) && (
      <button
        type="button"
        className={cn(
          "mt-0.5 text-[10px] text-muted-foreground",
          "hover:text-destructive transition-colors duration-100",
          "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
          "self-start leading-none"
        )}
        onClick={() => onRevert(event)}
      >
        Reverter
      </button>
    )}
  </div>
</li>
```

#### Configuração por tipo de evento

```ts
import { Send, Zap, ArrowRight, Tag, Clock, Hand, Undo2 } from "lucide-react";

export const EVENT_CONFIG = {
  message_sent: {
    icon: Send,
    colorClass: "text-primary",
    label: "Mensagem enviada",
    revertible: false,
  },
  action_executed: {
    icon: Zap,
    colorClass: "text-amber-500",
    label: "Ação executada",
    revertible: true,
  },
  stage_moved: {
    icon: ArrowRight,
    colorClass: "text-blue-500",
    label: "Stage movido",
    revertible: true,
  },
  tag_added: {
    icon: Tag,
    colorClass: "text-purple-500",
    label: "Tag adicionada",
    revertible: true,
  },
  silence_detected: {
    icon: Clock,
    colorClass: "text-muted-foreground",
    label: "Silêncio detectado",
    revertible: false,
  },
  handoff_triggered: {
    icon: Hand,
    colorClass: "text-orange-500",
    label: "Handoff solicitado",
    revertible: false,
  },
  reverted: {
    icon: Undo2,
    colorClass: "text-destructive",
    label: "Ação revertida",
    revertible: false,
  },
} as const;
```

**Nota sobre colors:** `text-amber-500`, `text-orange-500`, `text-purple-500`, `text-blue-500` são cores Tailwind arbitrárias — aceitável em timeline de auditoria (não são ações primárias do sistema). Não adicionar tokens para esses — são representações visuais de categorias de evento, não do design system base.

#### Motion — novo evento

```tsx
<AnimatePresence initial={false}>
  {events.map((event, index) => (
    <motion.li
      key={event.id}
      layout                              // layout animation p/ items existentes
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      // ...classes
    >
      <AITimelineEvent event={event} />
    </motion.li>
  ))}
</AnimatePresence>
```

Propósito: novo evento aparece de cima (mais recente no topo) deslizando para baixo — guia o olhar para a atualização.

**prefers-reduced-motion:** `initial={false}` + `transition={{ duration: 0 }}`.

#### Estados

| Estado | Visual |
|--------|--------|
| loading (inicial) | 3 skeleton lines: `h-10 bg-muted/40 rounded animate-pulse` |
| empty | texto `text-xs text-muted-foreground` "Nenhuma ação da IA registrada" centralizado, `py-6` |
| error | `text-xs text-destructive` com ícone `AlertCircle h-3.5 w-3.5` |

---

### 4. Search Result Highlight

**Referência visual:** Notion search highlight, Algolia InstantSearch

#### Problema de segurança

O `ts_headline` do Postgres retorna HTML com `<mark>` tags: `"...enviou a <mark>proposta</mark> comercial..."`.

Usar `dangerouslySetInnerHTML` é aceitável **se e somente se** a string for sanitizada antes. O `ts_headline` só injeta `<mark>StartSel</mark>` — mas nunca confiar no servidor para sanitização client-side.

```tsx
import DOMPurify from "dompurify";

// Config: whitelist mínima — só <mark> e text nodes
const ALLOWED = { ALLOWED_TAGS: ["mark"], ALLOWED_ATTR: [] };

function HighlightedText({ headline }: { headline: string }) {
  const clean = DOMPurify.sanitize(headline, ALLOWED);
  return (
    <span
      dangerouslySetInnerHTML={{ __html: clean }}
      className="search-highlight-scope"
    />
  );
}
```

`DOMPurify` já está disponível (verificar — se não: `npm install dompurify @types/dompurify`). Alternativa sem lib: parser manual que só aceita `<mark>` via regex — mais simples mas menos robusto.

#### Estilo da `<mark>`

```css
/* Em @layer components em src/index.css */
.search-highlight-scope mark {
  background-color: hsl(var(--primary) / 0.25);
  color: hsl(var(--foreground));
  border-radius: 2px;
  padding: 0 2px;
  font-weight: inherit;  /* não bold — highlight é cor, não peso */
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;  /* multi-line highlight sem corte */
}

html.dark .search-highlight-scope mark,
.dark .search-highlight-scope mark {
  background-color: hsl(var(--primary) / 0.35);
}
```

**Por que não Tailwind direto?** `box-decoration-break: clone` não tem utilitário Tailwind 3. Adicionar como `@layer components` é o caminho correto. A classe `.search-highlight-scope` isola o escopo — não polui `<mark>` global.

**Por que não bold?** Bold causa reflow — letras mudam de largura, o texto ao redor se move. Destaque por cor e bg é zero-reflow. Ref: Algolia, Notion, Linear — todos usam bg highlight sem bold.

#### Uso no CommandGroupMessages

```tsx
<CommandItem key={result.id} onSelect={() => navigate(...)}>
  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
  <div className="flex flex-col min-w-0 flex-1">
    <span className="text-xs text-muted-foreground truncate">
      {result.phone_number} · {formatRelative(result.timestamp)}
    </span>
    <HighlightedText
      headline={result.headline}
      className="text-sm leading-tight line-clamp-2"
    />
  </div>
</CommandItem>
```

---

### 5. Virtualização — feedback visual

**Princípio:** virtualização é invisível. O usuário não vê, não sente (se implementado corretamente). UI só expõe dois feedbacks:

#### Spinner de load (topo/bottom ao scroll extremo)

Aparece quando `isFetchingPreviousPage` ou `isFetchingNextPage` (TanStack Query infinite).

```tsx
// No topo da MessageList, antes dos virtualItems
{isFetchingPreviousPage && (
  <div className="flex justify-center py-3">
    <div className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
)}
```

Sem texto, sem label — o spinner é o único indicador. Discreto. Referência: WhatsApp Web ao carregar histórico.

#### Quando não há mais mensagens (topo)

```tsx
{!hasPreviousPage && messages.length > 0 && (
  <div className="py-4 text-center text-[11px] text-muted-foreground/50">
    Início da conversa
  </div>
)}
```

Sem animação — é estado final, não transição.

---

### 6. Realtime Cirúrgico — feedback visual

**Princípio:** realtime cirúrgico também é invisível. A operação de `setQueryData` é silenciosa por design.

O único feedback visual é o que já existe da Onda 1 (bubble entrada com motion `y: 8→0, opacity 0→1`). Não adicionar nenhum indicador novo de "mensagem chegando por realtime" — isso cria ansiedade (usuário fica olhando para o indicador).

#### Conversa nova no sidebar (ConversationList)

Quando `usePatchedRealtime` insere nova conversa no topo da lista:

```tsx
// Em ConversationListItem, quando isNew (montado há menos de 2s)
<motion.div
  initial={{ opacity: 0, x: -20 }}
  animate={{ opacity: 1, x: 0 }}
  transition={{ duration: 0.18, ease: "easeOut" }}
>
  <ConversationListItem ... />
</motion.div>
```

Propósito: guiar atenção para nova conversa na lista sem flash abrupto. `x: -20` = slide da esquerda — direção natural de "chegou de fora".

**Threshold `isNew`:** item cujo `created_at` > `mountTime - 5000ms`. Além disso, usar render normal (sem motion). Evitar animar todos os items no primeiro render.

**prefers-reduced-motion:** sem `motion.div` — render direto.

---

## Layout Updates

### ContextPanelInfo refatorado

Estrutura após C40:

```
ContextPanelInfo
│
├── Header (não colapsável)
│   ├── Avatar 40px (initials fallback)
│   ├── Nome + empresa (text-sm font-semibold + text-xs text-muted-foreground)
│   └── Status pill lead (qualification_score chip)
│
├── Quick actions (border-b border-border/40 py-3)
│   └── 4 icon buttons: [📞 Ligar] [💬 WhatsApp] [✉ Email] [📅 Follow-up]
│       Classes: Button variant="ghost" size="sm" com ícone 16px + tooltip
│
├── Lead meta (border-b border-border/40 py-3)
│   ├── Source chip: text-[11px] bg-muted/60 rounded px-2 py-0.5
│   ├── Score: "Score: 78" text-[11px] tabular-nums
│   └── Responsible: avatar 20px + nome truncado
│
└── AITimeline (expansível, py-0 — header interno tem py-3)
```

Spacing entre seções: `border-b border-border/40` — a divisória é a borda, não margin/padding. Padding vertical interno de cada seção: `py-3 px-4`.

### ChatHeader com TakeoverControls

Order dos elementos (esquerda → direita):

```tsx
<header className="flex items-center gap-2 px-4 h-14 border-b border-border/40 shrink-0">
  {/* Esquerda: identidade da conversa */}
  <Avatar className="h-8 w-8 shrink-0" />
  <div className="flex flex-col min-w-0 flex-1">
    <span className="text-sm font-semibold leading-tight truncate">{name}</span>
    <span className="text-xs text-muted-foreground leading-tight truncate">{subInfo}</span>
  </div>

  {/* Direita: controles (gap-1.5 entre eles) */}
  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
    <TakeoverControls conversationId={conversationId} />  {/* PRIMEIRO */}
    <IAToggle ... />
    <DensityToggle ... />
    <MoreActionsMenu ... />
  </div>
</header>
```

Ordem justificada: TakeoverControls é estado crítico da conversa — handoff pode estar pendente. Deve ser o item mais próximo ao nome do contato (leitura LTR: nome → estado da IA → ações). IA toggle vem depois porque é menos urgente que o estado atual.

---

## Novos Tokens

### command-palette-bg / border

| Token | Light | Dark | Justificativa |
|-------|-------|------|---------------|
| `--command-palette-bg` | `0 0% 100%` | `220 15% 10%` | Hue neutral-cool 220° separa perceptivamente do warm 36° do chat. Light = white puro para máximo contraste de itens. |
| `--command-palette-border` | `220 10% 88%` | `220 10% 20%` | Borda cool-tinted, família do bg palette. |

Registrar em `src/index.css` após `--shadow-gold` no bloco `:root`, e no bloco `.dark`.

NÃO registrar no `tailwind.config.ts` — consumir via `bg-[hsl(var(--command-palette-bg))]` inline. O palette é um componente isolado, não precisa de utilitário global.

---

## WCAG AA — Contraste Calculado

### Pill states TakeoverControls — valores críticos

Os estados amber/orange em light mode são os mais propensos a falha (fundo claro + texto claro). Cálculo usando relative luminance WCAG 2.1:

#### AI_PAUSED_MANUAL — light mode
- bg: `amber-500/10` sobre `background 42 25% 96%` ≈ resultante `~hsl(47 50% 94%)`
- text: `amber-700` ≈ `hsl(32 95% 35%)`

Luminance `hsl(32 95% 35%)` ≈ 0.099
Luminance `hsl(47 50% 94%)` ≈ 0.836
Ratio: `(0.836 + 0.05) / (0.099 + 0.05)` = **5.95:1 — PASS AA**

#### WAITING_HUMAN — light mode
- bg: `orange-500/10` sobre page bg ≈ `~hsl(25 50% 94%)`
- text: `orange-700` ≈ `hsl(21 90% 35%)`

Luminance `hsl(21 90% 35%)` ≈ 0.091
Luminance `~hsl(25 50% 94%)` ≈ 0.830
Ratio: `(0.830 + 0.05) / (0.091 + 0.05)` = **6.24:1 — PASS AA**

#### AI_PAUSED_MANUAL — dark mode
- text: `amber-300` ≈ `hsl(47 96% 70%)`
- bg: `amber-500/10` sobre dark bg `36 20% 12%` ≈ `hsl(40 20% 13%)`

Luminance `hsl(47 96% 70%)` ≈ 0.478
Luminance `hsl(40 20% 13%)` ≈ 0.021
Ratio: `(0.478 + 0.05) / (0.021 + 0.05)` = **7.44:1 — PASS AAA**

#### WAITING_HUMAN — dark mode
- text: `orange-300` ≈ `hsl(30 97% 72%)`
- bg: dark base ≈ `hsl(36 20% 12%)`

Luminance `hsl(30 97% 72%)` ≈ 0.432
Ratio: `(0.432 + 0.05) / (0.021 + 0.05)` = **6.79:1 — PASS AAA**

#### HUMAN_ACTIVE — light mode (verde — verificar)
- text: `green-700` ≈ `hsl(142 72% 29%)`
- bg: `green-500/10` sobre page ≈ `hsl(142 30% 94%)`

Luminance `hsl(142 72% 29%)` ≈ 0.057
Luminance `hsl(142 30% 94%)` ≈ 0.835
Ratio: `(0.835 + 0.05) / (0.057 + 0.05)` = **8.29:1 — PASS AAA**

#### HANDOFF_BACK — light mode (azul)
- text: `blue-700` ≈ `hsl(221 83% 40%)`
- bg: `blue-500/10` sobre page ≈ `hsl(217 30% 94%)`

Luminance `hsl(221 83% 40%)` ≈ 0.098
Ratio: `(0.835 + 0.05) / (0.098 + 0.05)` = **5.98:1 — PASS AA**

**Veredicto:** todos os 5 estados pill PASSAM WCAG AA em light e dark. Os mais apertados (AI_PAUSED e WAITING_HUMAN light) ainda têm margem de ~33% acima do mínimo 4.5:1.

### CommandPalette — contraste

| Par | Modo | Ratio estimado | Veredicto |
|-----|------|---------------|-----------|
| `foreground` / `command-palette-bg` (dark) | dark | `hsl(45 20% 95%)` vs `hsl(220 15% 10%)` ≈ **15.3:1** | PASS AAA |
| `muted-foreground` / `command-palette-bg` (dark) | dark | `hsl(45 15% 70%)` vs `hsl(220 15% 10%)` ≈ **7.1:1** | PASS AA |
| `foreground` / `--command-palette-bg` (light) | light | `hsl(30 18% 16%)` vs `white` ≈ **14.4:1** | PASS AAA |

### AITimeline — timestamps

| Par | Modo | Ratio | Veredicto |
|-----|------|-------|-----------|
| `muted-foreground 45 15% 70%` / dark card bg `36 20% 16%` | dark | ~**5.2:1** | PASS AA |
| `muted-foreground 30 10% 46%` / light card bg `42 18% 99%` | light | ~**4.8:1** | PASS AA |

Timestamps `text-[10px]` são "large text" (≥18pt bold ou ≥14pt regular = 18.67px). 10px (7.5pt) NÃO é large text — precisa ratio 4.5:1. Ambos passam.

### Focus ring

`hsl(47 100% 50%)` (gold, `--ring`) contra:
- dark page bg `hsl(36 20% 12%)`: **6.3:1 — PASS**
- light page bg `hsl(42 25% 96%)`: ~**2.1:1 — FAIL**

**Problema em light mode:** gold sobre off-white não tem contraste suficiente para focus ring. Já documentado na Onda 2a (seção 9). Mitigação: `ring-offset-2 ring-offset-background` cria halo de separação. Ratio efetivo: gold vs branco do offset (se `--card` = `42 18% 99%`): **2.2:1** — ainda tecnicamente abaixo.

**Decisão:** aceitar para esta onda. Mitigation path: em Onda 2c, adicionar `--ring-light: 221 83% 40%` (blue 700) para light mode e usar `dark:ring-ring ring-blue-700` nos elementos focáveis. Documentar como issue conhecida.

---

## Acessibilidade — resumo por componente

### CommandPalette

- `role="dialog"` + `aria-modal="true"` + `aria-label="Paleta de comandos"`
- `autoFocus` no `CommandInput`
- Focus trap via Radix FocusTrap (ou cmdk nativo)
- Restore focus: guardar `document.activeElement` antes de abrir, restaurar no close
- `Escape` fecha (nativo do cmdk)
- Itens têm `role="option"` (nativo cmdk `CommandItem`)
- Lista tem `role="listbox"` (nativo cmdk `CommandList`)
- Grupos com `aria-label` via `CommandGroup heading`

### TakeoverControls

- `role="group"` no wrapper externo
- `aria-label` descritivo no pill button (não apenas "IA ativa" — "IA está respondendo automaticamente")
- `aria-haspopup="menu"` + `aria-expanded` no botão
- `aria-live="polite"` em div `.sr-only` que espelha o estado atual
- Ícones: todos `aria-hidden`
- Dropdown items: Radix `DropdownMenuItem` já tem `role="menuitem"`

### AITimeline

- `<ol>` com `aria-label="Histórico de ações da IA"`
- Cada `<li>` contém `<time dateTime={iso8601}>` para timestamps
- Botão "Reverter" tem `aria-label` descritivo: `"Reverter: ${EVENT_LABELS[event.type]} às ${time}"`
- Section header com `aria-expanded` no button de collapse

### Search highlight

- `<mark>` tem semântica implícita de "highlight/relevance" — não precisa role adicional
- `HighlightedText` wrapper não precisa aria extra — conteúdo é texto com `<mark>` inline

### prefers-reduced-motion — cobertura completa

```tsx
// Hook utilitário — usar em todos os componentes com motion
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}
```

| Componente | Com reduce | Sem reduce |
|-----------|------------|-----------|
| CommandPalette backdrop | `opacity 0→1` only, 150ms | `opacity + scale + y`, 180ms |
| CommandPalette dialog | `opacity 0→1` only, 150ms | `opacity + scale 0.96 + y -8`, 180ms |
| TakeoverControls pill | sem AnimatePresence | `opacity 0→1` no key change |
| AITimeline event | sem motion | `opacity 0→1 + y -8`, 220ms |
| ConversationList item novo | sem motion | `opacity 0→1 + x -20`, 180ms |

---

## Checklist de Implementação para o Frontend

### Tokens e CSS (fazer primeiro — sem isso nada funciona)

- [ ] Adicionar `--command-palette-bg` e `--command-palette-border` em `:root` e `.dark` em `src/index.css`
- [ ] Adicionar `.search-highlight-scope mark` em `@layer components` com `box-decoration-break: clone`
- [ ] Verificar `DOMPurify` instalado — se não: `npm install dompurify @types/dompurify`

### C24 — CommandPalette base

- [ ] Criar `src/components/command/CommandPaletteProvider.tsx` com context + `isOpen`, `open()`, `close()`, `toggle()`, `register()`
- [ ] Criar `src/components/command/CommandPalette.tsx` com:
  - [ ] Backdrop `bg-background/70 backdrop-blur-md`
  - [ ] Dialog `max-w-[640px] w-[90vw] rounded-xl border` usando tokens command-palette
  - [ ] Input com ícone Search 16px + placeholder "Buscar ações, conversas, leads..."
  - [ ] Group headers `text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-3 py-1.5`
  - [ ] Items com ícone + label + description truncate + kbd shortcut
  - [ ] `data-[selected=true]:bg-muted/60` + `hover:bg-muted/40`
  - [ ] Empty state com copy sugestão
  - [ ] Footer hints `↑↓ · ↵ · esc`
  - [ ] Motion: `AnimatePresence` + `scale 0.96→1 + opacity + y -8`, 180ms ease-out
  - [ ] `prefers-reduced-motion` hook aplicado
- [ ] Criar `src/components/command/useCommandPalette.ts` (hook consumidor do context)
- [ ] Listener global `⌘K` / `Ctrl+K` no Provider com `e.preventDefault()`
- [ ] Guard: só abre se `user` logado
- [ ] `role="dialog"` + `aria-modal="true"` + `aria-label` + focus trap + restore focus
- [ ] Wrap `<AppRoutes>` com `<CommandPaletteProvider>` em `src/App.tsx`

### C25 — Grupos Navigation + Actions + Conversations

- [ ] Criar `src/components/command/groups/CommandGroupNavigation.tsx` (rotas estáticas)
- [ ] Criar `src/components/command/groups/CommandGroupActions.tsx` (dark toggle, criar lead, etc.)
- [ ] Criar `src/components/command/groups/CommandGroupConversations.tsx` (context-aware `/chat`)

### C26 — Recent commands

- [ ] Criar `src/components/command/recentCommands.ts` com `pushRecent`, `getRecent`, `clearRecent`
- [ ] Key localStorage: `cmd-palette-recent-${userId}`
- [ ] Seção "Recentes" no topo quando query vazia

### C29–C31 — Migrations (DBA — não Frontend)

- [ ] `20260501000000_add_ai_state_to_conversations.sql`
- [ ] `20260501000003_ai_state_transition_guard.sql`
- [ ] Regenerar types Supabase após migration

### C32 — TakeoverControls

- [ ] Criar `src/components/chat/takeover/aiStateLabels.ts` com `AI_STATE_CONFIG` completo (5 estados)
- [ ] Criar `src/components/chat/takeover/TakeoverControls.tsx` com:
  - [ ] Pill `h-7 pl-2 pr-1.5 rounded-full border text-[11px] font-medium`
  - [ ] Classes semânticas por estado via `AI_STATE_CONFIG[state].pillClasses`
  - [ ] Chevron com rotate 180° quando aberto
  - [ ] `filter: brightness(1.05)` no hover via inline style
  - [ ] Transição 150ms
  - [ ] Dropdown com ações condicionais por estado (baseado em `canTransition`)
  - [ ] `aria-live="polite"` div `.sr-only` espelhando estado
  - [ ] `aria-label` descritivo no pill button
  - [ ] Motion de troca de estado: `key={state}` + `AnimatePresence opacity 0→1` 150ms
  - [ ] `prefers-reduced-motion` hook
- [ ] Integrar `<TakeoverControls>` no `ChatHeader` — posição: antes do IA toggle

### C33 — AITimeline

- [ ] Criar `src/hooks/chat/useAITimeline.ts` — query `lead_history` filtrado por `ai_%`
- [ ] Criar `src/components/chat/takeover/AITimeline.tsx` com:
  - [ ] `<ol>` semântico + `<li>` por evento
  - [ ] Timestamp column `min-w-[44px] text-[10px] tabular-nums`
  - [ ] Conector vertical `border-l border-border/30`
  - [ ] 7 tipos de evento com ícone + cor de `EVENT_CONFIG`
  - [ ] Botão "Reverter" com `opacity-0 group-hover:opacity-100`
  - [ ] Collapse via button `aria-expanded`
  - [ ] `ScrollArea max-h-[320px]`
  - [ ] Motion: `AnimatePresence initial={false}` + `layout` + `y -8→0 opacity 0→1` 220ms
  - [ ] States: loading skeleton 3 lines, empty state, error state
  - [ ] `<time dateTime={iso}>` em cada evento
  - [ ] `prefers-reduced-motion` hook

### C34–C37 — Search (DBA + Frontend)

- [ ] `20260501000001_conversation_messages_search_tsv.sql` (DBA)
- [ ] `20260501000002_rpc_search_messages.sql` (DBA)
- [ ] Criar `src/hooks/chat/useMessageSearch.ts` com debounce 300ms, `enabled: query.length >= 3`
- [ ] Criar `src/components/command/groups/CommandGroupMessages.tsx`
- [ ] Criar `HighlightedText` component com `DOMPurify.sanitize({ ALLOWED_TAGS: ["mark"] })`
- [ ] Aplicar `.search-highlight-scope` wrapper

### C40 — ContextPanelInfo

- [ ] Refatorar `src/components/chat/context-panel/ContextPanelInfo.tsx`:
  - [ ] Header: avatar 40px + nome + empresa + status
  - [ ] Quick actions: 4 icon buttons ghost
  - [ ] Lead meta: source chip + score + responsible
  - [ ] `<AITimeline>` section expandível no bottom
  - [ ] `ScrollArea` única envolvendo tudo
  - [ ] Divisórias: `border-b border-border/40` (não padding heavy)

### Virtualização (C22, C23) — sem UI, só verificar

- [ ] Spinner `h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin` ao fetchPreviousPage
- [ ] Texto "Início da conversa" quando `!hasPreviousPage`
- [ ] Slide-in `x -20→0 opacity 0→1` 180ms para nova conversa no sidebar

---

## Critério de aceite UI

- [ ] CommandPalette usa tokens `--command-palette-bg/border` (hue cool 220°, não warm 36° do chat)
- [ ] Todos os 5 pill states do TakeoverControls distinguíveis em dark e light sem ler o label
- [ ] AITimeline `<ol>` semântico com `<time dateTime>` em cada evento
- [ ] Search highlight usa `DOMPurify` whitelist `mark` only — zero XSS
- [ ] `.search-highlight-scope mark` sem bold, com `box-decoration-break: clone`
- [ ] `aria-live="polite"` no TakeoverControls — screen reader anuncia mudança de estado
- [ ] Focus trap no CommandPalette + restore focus ao fechar
- [ ] Todos os 5 pill states WCAG AA ≥ 4.5:1 (calculado acima, todos passam)
- [ ] `prefers-reduced-motion` desabilita todas as animações novas desta onda
- [ ] ChatHeader: TakeoverControls vem ANTES do IA toggle na ordem de leitura
- [ ] CommandPalette fecha com Escape sem deixar foco "perdido"
- [ ] Não parece Headless UI genérico — palette tem tipografia editorial (headers uppercase tracking-wider, items com description truncada, footer de hints)
- [ ] AITimeline botão "Reverter" só aparece no hover (não polui a lista no estado resting)
- [ ] Build `npm run build` sem erros após tokens adicionados

---

## Próximo passo

Frontend implementa na ordem dos commits do Architect Plan (C18→C28 Fase 2b.1, C29→C45 Fase 2b.2). Cada componente visual tem seu commit mapeado. Mockup `/_mockup/chat-v2` deve refletir os novos componentes após C27/C42 para validação visual antes de ligar em produção.
