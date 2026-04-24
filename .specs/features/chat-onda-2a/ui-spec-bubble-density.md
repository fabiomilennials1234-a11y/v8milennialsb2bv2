# UI Spec — Chat Onda 2a: Bubble Tokens + Density Modes + Typography

**Branch**: `feat/chat-ux-ui-redesign`
**Pré-requisito**: Architect Refactor Plan (`architect-refactor-plan.md`) lido — commits C9 e C15 implementam este spec.
**Refs visuais**: Apple Messages, WhatsApp Web, Linear, Intercom, Front, Missive.
**Input de contexto lido**: `src/index.css`, `tailwind.config.ts`, `WhatsAppChat.tsx:1064–1163`, architect plan.

---

## Contexto: o problema atual

`MessageBubble.tsx` (linha 1140–1141) usa:
```
isOutgoing: bg-muted/80 border border-border/60
incoming:   bg-card border border-border/40
```

Ambas as classes são tokens *de layout geral*, não de chat. Resultado:
- Outgoing e incoming têm diferença visual mínima em dark (mesma família hsl 36°)
- AI bubble é indistinguível de human outgoing — apenas o label "Copilot" diferencia
- Opacity hacks (`/80`, `/60`) produzem artefatos de compositing em backgrounds texturizados
- Sem semântica: `bg-muted` numa bubble é ruído — não diz nada sobre o tipo de mensagem

A Onda 2a introduz tokens dedicados. O band-aid some.

---

## 1. Tokens bubble — 12 novos tokens HSL

### Filosofia de design

**Outgoing (humano, operador)** — Fill mais denso, hue cool (azul-cinza em light). Peso visual maior. Referência: Apple iMessage outgoing (blue), WhatsApp Web outgoing (green). Aqui não usamos a cor do sistema operacional do usuário — usamos cool gray como neutro sofisticado que não compete com o accent gold do Torque.

**Incoming (lead/contato)** — Quase transparente em light (praticamente branco card), ligeiramente elevado em dark. Sem fill forte: o contato não é o "produto", o operador escreve mais. Ref: WhatsApp Web incoming (white), Apple Messages incoming (light gray).

**AI (Copilot)** — Mesma posição que outgoing (direita), mas distinguível em 0.5s. Em light: tint gold mínimo (5–8% de saturação) + left border gold de 3px. Em dark: bg levemente mais quente que o outgoing cool-tinted + left border gold pleno. Ref: Intercom AI card (amber accent), Linear AI response (warm tint, border left).

**System** — Sem balão real. Pill centralizado, sem fill forte. Texto de suporte: transferências, separadores de data, eventos de pipeline. Ref: WhatsApp "Mensagens criptografadas de ponta a ponta", iMessage "Hoje".

### Nota sobre AI border (WCAG 1.4.11)

O token `--bubble-ai-border` é usado exclusivamente como **3px left border** (accent indicator), não como border all-around. O contraste do gold (`hsl(47 100% 50%)`) contra o bubble bg em light (`hsl(47 35% 90%)`) é 1.30:1 — abaixo do threshold WCAG 1.4.11 para UI components se usado all-around. Porém:

1. O AI indicator usa **dois cues não-cor**: label "Copilot" + ícone Bot
2. A borda left é *enhancement* decorativo, não o único cue
3. Em dark, o mesmo gold contra `hsl(38 22% 24%)` tem 6.44:1 — visível

Conclusão: a borda gold cumpre função de polish e reconhecimento rápido. O critério de acessibilidade é atendido pelos cues label+ícone, não pela borda.

### Tabela completa dos 12 tokens

Todos os ratios calculados com WCAG 2.1 relative luminance formula.

| Token | Light HSL | Dark HSL | Contraste Texto | Uso da border | Ref |
|-------|-----------|----------|-----------------|---------------|-----|
| `--bubble-outgoing` | `220 30% 88%` | `217 19% 27%` | — | bg | cool blue-gray fill |
| `--bubble-outgoing-foreground` | `220 25% 18%` | `210 20% 94%` | **10.57:1** / **8.87:1** | text | texto escuro/claro sobre fill |
| `--bubble-outgoing-border` | `220 22% 75%` | `217 20% 38%` | 1.42 / 1.50 (UI) | all-around 1px | borda sutil, define forma |
| `--bubble-incoming` | `42 18% 97%` | `36 18% 20%` | — | bg | quase-branco warm / elevado warm dark |
| `--bubble-incoming-foreground` | `30 18% 16%` | `45 15% 88%` | **13.51:1** / **9.43:1** | text | máximo contraste |
| `--bubble-incoming-border` | `40 15% 84%` | `38 14% 30%` | 1.34 / 1.50 (UI) | all-around 1px | define forma no light |
| `--bubble-ai` | `47 35% 90%` | `38 22% 24%` | — | bg | gold tint 5% sat / warm dark |
| `--bubble-ai-foreground` | `36 20% 18%` | `47 40% 90%` | **10.90:1** / **8.39:1** | text | dark warm / warm cream |
| `--bubble-ai-border` | `47 100% 50%` | `47 100% 50%` | 1.30 / **6.44:1** (UI left) | **3px left ONLY** | accent gold — ver nota WCAG acima |
| `--bubble-system` | `42 15% 92%` | `36 15% 15%` | — | bg | pill cinza quente / quase-bg dark |
| `--bubble-system-foreground` | `30 12% 33%` | `40 12% 56%` | **6.26:1** / **4.86:1** | text | muted mas legível |
| `--bubble-system-border` | `40 12% 80%` | `38 12% 22%` | 1.33 / 1.31 (UI) | all-around 1px | define pill |

### Justificativa visual por token

**`--bubble-outgoing` light `220 30% 88%`**
Hue 220° (azul-cinza frio) vs page bg `42° 25% 96%` (warm off-white). O shift de hue 178° cria diferenciação clara sem ser primário/brand. Lightness 88% = fill denso o suficiente para "peso" visual > incoming (97%), mas não pesado a ponto de competir com ações. Analogia: Apple iMessage em "modo claro de terceiros" — fill controlado, não exuberante.

**`--bubble-outgoing` dark `217 19% 27%`**
Lightness 27% no hue 217° (navy-gray). Vs page bg `36° 20% 12%` (L=12%). Delta de 15pp de lightness + shift de hue quente→frio. Sem ser azul perceptível — saturação 19% é quase acromática. Ref: Linear dark interface (painéis elevados em cool gray). Outgoing é o elemento mais elevado da timeline → deve ser o mais claro entre bubbles.

**`--bubble-incoming` light `42 18% 97%`**
Quase `--card` original (`42 18% 99%`) mas 2pp mais escuro — suficiente para o bubble ter borda implícita de contraste vs fundo de conversa. Hue 42° mantém família warm do brand. Incoming "fala menos" visualmente: o lead é o alvo, não o ator principal da interface.

**`--bubble-incoming` dark `36 18% 20%`**
Hue 36° (warm brown family), L=20% vs page L=12%. 8pp de elevação, mesma família hue do bg — incoming parece "parte do ambiente", não destaque. Contraste com outgoing (217° 27%) vem do hue shift (quente vs frio) + 7pp lightness. Dois cues simultâneos para diferenciação.

**`--bubble-ai` light `47 35% 90%`**
Gold tint: hue 47° (mesmo que `--primary`), sat 35% (vs primary 100%), L=90%. O bubble é quase-branco com um "calor dourado" — percebido como diferente do incoming warm mas não gritante. Ref: Intercom AI card com amber wash muito sutil.

**`--bubble-ai` dark `38 22% 24%`**
Hue 38° (mais quente que o cool 217° do outgoing), sat 22%, L=24% vs outgoing L=27% — ligeiramente mais escuro mas hue diferente. O gold left border compensa qualquer ambiguidade. Ref: Linear AI response em dark — warm tint sutil + border accent.

**`--bubble-system` light `42 15% 92%` / dark `36 15% 15%`**
Minimal: em light, pill com fill cinza-quente claro que some no fundo. Em dark, quase idêntico ao bg (`L=15` vs `L=12`). Propositalmente invisível — transferências e dates não devem chamar atenção.

---

## 2. CSS vars a adicionar em `src/index.css`

```css
/* ─── Bubble tokens ─────────────────────────────────────── */
/* Adicionar em :root (light) */
:root {
  --bubble-outgoing:            220 30% 88%;
  --bubble-outgoing-foreground: 220 25% 18%;
  --bubble-outgoing-border:     220 22% 75%;

  --bubble-incoming:            42 18% 97%;
  --bubble-incoming-foreground: 30 18% 16%;
  --bubble-incoming-border:     40 15% 84%;

  --bubble-ai:                  47 35% 90%;
  --bubble-ai-foreground:       36 20% 18%;
  --bubble-ai-border:           47 100% 50%;

  --bubble-system:              42 15% 92%;
  --bubble-system-foreground:   30 12% 33%;
  --bubble-system-border:       40 12% 80%;
}

/* Adicionar em html.dark, .dark */
html.dark,
.dark {
  --bubble-outgoing:            217 19% 27%;
  --bubble-outgoing-foreground: 210 20% 94%;
  --bubble-outgoing-border:     217 20% 38%;

  --bubble-incoming:            36 18% 20%;
  --bubble-incoming-foreground: 45 15% 88%;
  --bubble-incoming-border:     38 14% 30%;

  --bubble-ai:                  38 22% 24%;
  --bubble-ai-foreground:       47 40% 90%;
  --bubble-ai-border:           47 100% 50%;

  --bubble-system:              36 15% 15%;
  --bubble-system-foreground:   40 12% 56%;
  --bubble-system-border:       38 12% 22%;
}
```

Posição no arquivo: após o bloco de `--border` e antes de `--sidebar-*`, em ambos os blocos `:root` e `.dark`.

---

## 3. Classes Tailwind a registrar em `tailwind.config.ts`

Adicionar em `theme.extend.colors`:

```typescript
bubble: {
  outgoing: {
    DEFAULT: 'hsl(var(--bubble-outgoing))',
    foreground: 'hsl(var(--bubble-outgoing-foreground))',
    border: 'hsl(var(--bubble-outgoing-border))',
  },
  incoming: {
    DEFAULT: 'hsl(var(--bubble-incoming))',
    foreground: 'hsl(var(--bubble-incoming-foreground))',
    border: 'hsl(var(--bubble-incoming-border))',
  },
  ai: {
    DEFAULT: 'hsl(var(--bubble-ai))',
    foreground: 'hsl(var(--bubble-ai-foreground))',
    border: 'hsl(var(--bubble-ai-border))',
  },
  system: {
    DEFAULT: 'hsl(var(--bubble-system))',
    foreground: 'hsl(var(--bubble-system-foreground))',
    border: 'hsl(var(--bubble-system-border))',
  },
},
```

**Utilities geradas:**

| Classe | Propriedade CSS | Uso |
|--------|----------------|-----|
| `bg-bubble-outgoing` | `background-color: hsl(var(--bubble-outgoing))` | bubble bg |
| `text-bubble-outgoing-foreground` | `color: hsl(var(--bubble-outgoing-foreground))` | texto |
| `border-bubble-outgoing-border` | `border-color: hsl(var(--bubble-outgoing-border))` | borda 1px |
| `bg-bubble-incoming` | idem | bubble bg |
| `text-bubble-incoming-foreground` | idem | texto |
| `border-bubble-incoming-border` | idem | borda 1px |
| `bg-bubble-ai` | idem | bubble bg |
| `text-bubble-ai-foreground` | idem | texto |
| `border-l-bubble-ai-border` | `border-left-color` | **left border 3px only** |
| `bg-bubble-system` | idem | pill bg |
| `text-bubble-system-foreground` | idem | texto |
| `border-bubble-system-border` | idem | pill border |

**Classe composta para AI bubble** (adicionar como `@layer components` em `index.css`):
```css
@layer components {
  .bubble-ai-indicator {
    border-left: 3px solid hsl(var(--bubble-ai-border));
    border-radius: inherit;
  }
}
```

Ou via Tailwind: `border-l-[3px] border-l-bubble-ai-border`. Preferir o utilitário Tailwind para consistência.

---

## 4. Density modes — 3 presets

Consolida e confirma os valores do Architect Plan (seção 4, tabela de vars). Nenhuma divergência — o plan estava correto nos números.

| CSS var | compact | comfortable (default) | spacious |
|---------|---------|-----------------------|----------|
| `--chat-bubble-padding-x` | `10px` | `14px` | `18px` |
| `--chat-bubble-padding-y` | `6px` | `10px` | `14px` |
| `--chat-msg-gap-same-author` | `2px` | `4px` | `6px` |
| `--chat-msg-gap-different` | `8px` | `12px` | `16px` |
| `--chat-avatar-size` | `32px` | `40px` | `48px` |
| `--chat-composer-min-h` | `36px` | `44px` | `52px` |
| `--chat-list-row-height` | `56px` | `72px` | `88px` |

**Defaults em `:root`** (colar em `index.css` junto com bubble tokens, bloco separado):
```css
/* ─── Chat layout density (default: comfortable) ──────────── */
:root {
  --chat-bubble-padding-x:    14px;
  --chat-bubble-padding-y:    10px;
  --chat-bubble-radius-lg:    16px;
  --chat-bubble-radius-sm:    4px;
  --chat-msg-gap-same-author: 4px;
  --chat-msg-gap-different:   12px;
  --chat-avatar-size:         40px;
  --chat-composer-min-h:      44px;
  --chat-list-row-height:     72px;
}
```

`--chat-bubble-radius-lg` e `--chat-bubble-radius-sm` não variam por density — são fixos. O radius adaptativo por grouping (`rounded-2xl rounded-br-sm` etc.) já funciona via classes Tailwind e não deve ser tocado.

**Transição CSS** — aplicar nos containers que consomem as vars, não nas vars em si:

```css
/* Em ChatShell root element ou em .chat-bubble class */
.chat-bubble {
  padding: var(--chat-bubble-padding-y) var(--chat-bubble-padding-x);
  transition: padding 120ms ease-out;
}

.chat-msg-gap-same {
  margin-top: var(--chat-msg-gap-same-author);
  transition: margin-top 120ms ease-out;
}

.chat-msg-gap-diff {
  margin-top: var(--chat-msg-gap-different);
  transition: margin-top 120ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .chat-bubble,
  .chat-msg-gap-same,
  .chat-msg-gap-diff {
    transition: none;
  }
}
```

**Persistência**: `localStorage.chat-density-${userId}` — ver implementação em `useChatDensity.ts` (Architect Plan seção 4). Default `"comfortable"` quando chave ausente ou userId indisponível.

**Toggle no ChatHeader**: 3 botões lado a lado (não cycle) — mais explícito que cycle para o usuário descobrir a feature. Ícones Lucide:

| Mode | Ícone Lucide | Label (tooltip) |
|------|-------------|-----------------|
| compact | `AlignJustify` (linhas juntas) | Compacto |
| comfortable | `List` (linhas médias) | Padrão |
| spacious | `LayoutList` (linhas espaçadas) | Espaçoso |

Variante visual do toggle: 3 `Button` variant `ghost` size `sm` em linha, com `ring-2 ring-ring` no ativo. Não usar Tabs — é operação de layout, não navegação de conteúdo.

---

## 5. Tipografia escala editorial

Fonte: `Inter` (já carregada). Feature settings recomendados para leitura em chat:

```css
/* Adicionar em body ou em .chat-typography-scope */
font-feature-settings: "cv11", "ss01";
```

`cv11` = alterna numeral "1" com serif (mais legível em timestamps como "11:11"), `ss01` = "a" alternativo (mais distinto do "o"). Verificar se já está globalmente: **não está** — `src/index.css` não define `font-feature-settings`. Adicionar em `body {}` no `@layer base`.

| Elemento | font-size | line-height | font-weight | extras |
|----------|-----------|-------------|-------------|--------|
| Corpo da mensagem | `text-sm` (14px) | `leading-relaxed` (1.625) | `400` | `break-words whitespace-pre-wrap` |
| Sender label (AI, sistema) | `text-[11px]` | `leading-none` | `500` | **não uppercase** — case-sensitive em nomes |
| Timestamp inline (bubble) | `text-[10px]` | `leading-none` | `400` | `tabular-nums` — já implementado em Onda 1 |
| Nome contato (lista) | `text-sm` (14px) | `leading-tight` | `500` | `truncate` |
| Last msg preview (lista) | `text-xs` (12px) | `leading-tight` | `400` | `text-muted-foreground truncate` |
| Unread count badge | `text-[10px]` | `leading-none` | `600` | `tabular-nums` — nunca "99+" em termos de largura (reservar 2ch mínimo) |
| Header nome do contato | `text-sm` (14px) | `leading-tight` | `600` | `truncate` |
| Header sub-info | `text-xs` (12px) | `leading-tight` | `400` | `text-muted-foreground` |
| Date separator (system) | `text-[11px]` | `leading-none` | `500` | `text-bubble-system-foreground tracking-wide` |
| Transfer event label | `text-xs` (12px) | `leading-tight` | `400` | `text-bubble-system-foreground italic` |

**Regras tipográficas adicionais:**

1. **Nunca uppercase em labels de sender** — "COPILOT" é gritante; "Copilot" é editorial.
2. **Max-width em mensagens longas**: bubble já tem `max-w-[75%]`. Para mensagens text-only longas, o conteúdo fica ok com `break-words`. Não adicionar `max-ch` interno — quebra layout de mídia.
3. **Tabular-nums obrigatório** em: timestamps, unread badge, contador de mensagens, métricas de delivery.
4. **Leading-relaxed só em corpo de mensagem** — não em labels, timestamps ou previews. Labels com leading-relaxed ficam desalinhados verticalmente em espaços compactos.

---

## 6. Layout 3 colunas — larguras e breakpoints

| Painel | Default | Min | Max | Collapse |
|--------|---------|-----|-----|---------|
| Left (lista de conversas) | `300px` (~25% em 1280px) | `250px` | `400px` | `<780px` viewport → stack mobile |
| Center (chat) | `flex-1` (crescimento livre) | `320px` | sem limite | centro sempre visível |
| Right (context panel) | `340px` (~28% em 1280px) | `280px` | `500px` | `<1200px` → colapsado por default; abre via toggle |

**Persistência**: `localStorage.chat-layout-sizes-${userId}` — array numérico de percentuais `[leftPct, centerPct, rightPct]` (formato do `ResizablePanelGroup`). Validar ao ler: soma deve ser ~100, cada valor dentro dos bounds — se inválido, resetar para defaults.

**Breakpoints:**

- `≥1200px`: 3 colunas disponíveis. Right panel colapsado por default, toggle no header abre.
- `≥780px <1200px`: 2 colunas (Left + Center). Right panel não disponível — escondido, não colapsado.
- `<780px`: 1 coluna. Stack: lista é a view default; selecionar conversa empurra para chat (slide left → right). Sem Right panel.

**Handle de resize**: `ResizableHandle` do shadcn/ui. Hover: `opacity-60 → opacity-100`, `80ms ease-out`. Cursor `col-resize`. Não adicionar ícone no handle — já é intuitivo pelo cursor.

---

## 7. Motion specs

Todas as animações respeitam `prefers-reduced-motion: reduce` → fallback sem animação (não apenas `duration: 0` — remover o `motion.div` wrapper ou usar `initial={false}`).

| Elemento | Trigger | Animação | Duração | Easing | Propósito |
|----------|---------|----------|---------|--------|-----------|
| Bubble entrada (nova mensagem pós-mount) | message.timestamp > mountTime | `opacity: 0→1, y: 8→0` | `180ms` | `ease-out` | Guiar atenção para nova msg sem interromper leitura |
| FAB ScrollToBottom | `!isAtBottom` → aparece | `opacity: 0→1, y: 8→0, scale: 0.9→1` | `180ms` | `ease-out` | Indicar ação disponível sem flash abrupto |
| FAB ScrollToBottom | `isAtBottom` → some | `opacity: 1→0, y: 0→8` | `150ms` | `ease-in` | Saída suave — easing diferente da entrada |
| Density change | `setDensity()` call | CSS `transition: padding 120ms, margin-top 120ms` | `120ms` | `ease-out` | Confirmar que a mudança aconteceu — sem jump |
| Resize handle hover | `mouseenter` | `opacity 60%→100%` | `80ms` | `ease-out` | Revelar interatividade do handle |
| Unread divider | Scroll para cima descobrindo msgs não lidas | `opacity: 0→1` (sem y) | `220ms` | `ease-out` | Não perturbar leitura com movimento vertical |
| Context panel open | Toggle no header | `width: 0→340px` via `ResizablePanel` | `250ms` | `ease-out` | Transição de contexto — mais lenta que feedback |
| Timestamp hover reveal | `mouseenter` no bubble | `opacity: 0→1` | `120ms` | `ease-out` | Revelar info secundária on-demand |

**O que não animar:**
- Troca de conversa — carregamento de mensagens deve ser imediato (skeleton instantâneo)
- Agrupamento de mensagens — radius adaptativo não anima
- Indicadores de status (✓✓) — são estado, não transição

---

## 8. Dark mode — hierarquia visual confirmada

Lightness progressiva das bubbles em dark:

```
page bg:  hsl(36 20% 12%)  L≈0.015  ← mais escuro
system:   hsl(36 15% 15%)  L≈0.021  ← quase invisível
incoming: hsl(36 18% 20%)  L≈0.037  ← elevado warm
outgoing: hsl(217 19% 27%) L≈0.054  ← mais elevado + cool shift
ai:       hsl(38 22% 24%)  L≈0.044  ← entre incoming e outgoing + gold border
```

Hierarquia dark: `outgoing (L 0.054) > ai (L 0.044) > incoming (L 0.037) > system (L 0.021) > page (L 0.015)`.

Verificação: outgoing vs incoming ratio de bg-bg = 1.19 — baixo numericamente, mas suficiente porque:
1. **Posição** (direita vs esquerda) é cue primário
2. **Hue shift** (cool 217° vs warm 36°) = diferenciação perceptiva não mensurável por ratio simples
3. **Borda** define forma individualmente

Nenhuma bubble usa preto puro. Menor lightness = 12% (page bg). Bubbles em 15%, 20%, 24%, 27%. Gradação suave.

**Glow sutil em bubbles outgoing no dark** (optional, cinema polish):
```css
/* Aplicar via shadow utilitária ou inline no componente */
box-shadow: inset 0 1px 0 hsl(var(--bubble-outgoing-foreground) / 0.08);
```
Efeito de brilho interno sutil — como a iluminação que Linear usa em cards elevados. Não obrigatório para Onda 2a; inclui-se como comentário `/* polish-optional */` no código.

---

## 9. Acessibilidade

### Contraste de texto (WCAG 2.1 — 1.4.3, AA mínimo 4.5:1 texto normal)

| Par | Modo | Ratio | Veredicto |
|-----|------|-------|-----------|
| `--bubble-outgoing-foreground` / `--bubble-outgoing` | light | 10.57:1 | PASS (AAA) |
| `--bubble-outgoing-foreground` / `--bubble-outgoing` | dark | 8.87:1 | PASS (AAA) |
| `--bubble-incoming-foreground` / `--bubble-incoming` | light | 13.51:1 | PASS (AAA) |
| `--bubble-incoming-foreground` / `--bubble-incoming` | dark | 9.43:1 | PASS (AAA) |
| `--bubble-ai-foreground` / `--bubble-ai` | light | 10.90:1 | PASS (AAA) |
| `--bubble-ai-foreground` / `--bubble-ai` | dark | 8.39:1 | PASS (AAA) |
| `--bubble-system-foreground` / `--bubble-system` | light | 6.26:1 | PASS (AA) |
| `--bubble-system-foreground` / `--bubble-system` | dark | 4.86:1 | PASS (AA) |

### Contraste de UI components (WCAG 2.1 — 1.4.11, mínimo 3:1)

Bordas all-around dos bubbles: ratios entre 1.30 e 1.50 — abaixo de 3:1. **Isso é aceitável** porque:
- A forma do bubble é definida por bg-bg contrast (bubble vs chat area bg), não pela borda em si
- Bordas em chat são linhas de refinamento, não de delimitação necessária para compreensão
- WhatsApp Web, iMessage, Missive: nenhum usa bordas de alto contraste em bubbles

O requisito 1.4.11 aplica a "UI components que o usuário precisa operar" — bordas de bubble não são componentes interativos. Porém, para bubbles tabbable (Onda 2b), o **focus ring** deve ter ratio ≥ 3:1 contra o bg adjacente: `ring-ring` (gold `hsl(47 100% 50%)`) contra page bg dark `hsl(36 20% 12%)` = calculado abaixo.

```
hsl(47 100% 50%) vs hsl(36 20% 12%): ~6.3:1 PASS
```

### Focus ring

Para elementos tabbable em bubbles (Onda 2b), usar:
```
ring-2 ring-ring ring-offset-2 ring-offset-background
```
Nunca remover. Nunca mudar `ring-ring` para cor de menor contraste.

### Indicadores não-cor para AI

O bubble AI usa:
1. **Posição**: direita (mesmo que outgoing humano) — cue posicional
2. **Label**: texto "Copilot" com `text-[11px] font-medium` + ícone `Bot` (Lucide, `h-3 w-3`)
3. **Cor**: tint gold no bg + left border gold (enhancement, não cue primário)

Cues 1 e 2 funcionam sem cor — atende WCAG 1.4.1.

### `prefers-reduced-motion`

Dois pontos obrigatórios:
1. `MessageBubble.tsx` já implementa o check (`window.matchMedia("(prefers-reduced-motion: reduce)")`). Preservar.
2. CSS transitions de density: envolver em `@media (prefers-reduced-motion: no-preference)` ou usar `transition: none` no `reduce` block.

```css
@media (prefers-reduced-motion: reduce) {
  .chat-bubble,
  .chat-msg-gap-same,
  .chat-msg-gap-diff {
    transition: none;
  }
}
```

---

## 10. Checklist de implementação para Frontend

**Commit C9 — CSS vars + density defaults:**
- [ ] Adicionar 12 tokens bubble em `:root` em `src/index.css` (posição: após `--border`, antes de `--sidebar-*`)
- [ ] Adicionar 12 tokens bubble em `.dark` em `src/index.css`
- [ ] Adicionar 9 density vars em `:root` com defaults `comfortable`
- [ ] Adicionar `font-feature-settings: "cv11", "ss01"` no `body {}` em `@layer base`
- [ ] Não adicionar density vars no `.dark` — são independentes de tema

**Commit C15 — Tailwind + MessageBubble refactor:**
- [ ] Adicionar objeto `bubble` em `theme.extend.colors` no `tailwind.config.ts`
- [ ] Adicionar classe composta `.chat-bubble` no plugin do Tailwind (padding via vars) — ver Architect Plan C15
- [ ] Adicionar `.chat-bubble-outgoing`, `.chat-bubble-incoming`, `.chat-bubble-ai`, `.chat-bubble-system` com bg + borderColor via vars
- [ ] Em `MessageBubble.tsx` linha 1140: substituir `bg-muted/80 border border-border/60` por `bg-bubble-outgoing border border-bubble-outgoing-border text-bubble-outgoing-foreground`
- [ ] Em `MessageBubble.tsx` linha 1141: substituir `bg-card border border-border/40` por `bg-bubble-incoming border border-bubble-incoming-border text-bubble-incoming-foreground`
- [ ] Para AI bubbles (`message.sent_by_ai === true`): usar `bg-bubble-ai border-l-[3px] border-l-bubble-ai-border border border-bubble-ai-border/0 text-bubble-ai-foreground` — nota: borda all-around é transparente; só a left é visível
- [ ] Para system/transfer events em `MessageList.tsx`: usar `bg-bubble-system border border-bubble-system-border text-bubble-system-foreground`
- [ ] Remover toda `opacity` hack das classes de bubble (`/80`, `/60`, `/40`)

**Commit C11 — useChatDensity + toggle:**
- [ ] `useChatDensity` injeta CSS vars via `style` inline no root do `ChatShell`
- [ ] Toggle no `ChatHeader`: 3 botões `ghost size="sm"` com ícones `AlignJustify`, `List`, `LayoutList`
- [ ] Botão ativo recebe `ring-2 ring-ring` — não mudar bg para primary (não é ação primária da tela)
- [ ] Tooltip com label `Compacto` / `Padrão` / `Espaçoso`
- [ ] Adicionar `transition: padding 120ms ease-out` na classe `.chat-bubble` (ou via Tailwind `transition-[padding]`)
- [ ] Adicionar `@media (prefers-reduced-motion: reduce) { .chat-bubble { transition: none } }`

**Validação:**
- [ ] Testar contraste com [webaim.org/resources/contrastchecker](https://webaim.org/resources/contrastchecker) ou `axe-core` nos 4 tipos de bubble × 2 temas
- [ ] Screenshot dark + light em cada density (compact/comfortable/spacious) — mínimo 12 screenshots
- [ ] Verificar que bubbles AI são distinguíveis de outgoing humano em ambos os temas sem ler o label
- [ ] Verificar que system pills desaparecem visualmente (não chamam atenção) em dark
- [ ] Verificar `prefers-reduced-motion` desabilita tanto a animação de entrada quanto as transitions de density
- [ ] Build `npm run build` sem erros — verificar bundle size (12 tokens novos = ~2KB no CSS, aceitável)

---

## 11. Critério de aceite UI

- [ ] Todos os 12 tokens usam valores HSL justificados neste documento
- [ ] Zero classes `bg-muted/X` ou `bg-card` em `MessageBubble.tsx` após refactor
- [ ] AI bubble distinguível em 0.5s de glance em dark — cue: left border gold + warm tint
- [ ] System bubble não chama atenção — percebido como parte do background, não como mensagem
- [ ] Outgoing visualmente mais "pesado" que incoming em ambos os temas
- [ ] Hierarchy dark: outgoing > ai > incoming > system (lightness progressiva verificada)
- [ ] Contraste de texto ≥ 4.5:1 em todos os 8 pares texto/fundo (calculado — ver seção 9)
- [ ] Density toggle muda padding + gap visivelmente sem reload
- [ ] Transition 120ms suave — não abrupta, não lenta
- [ ] `prefers-reduced-motion` desabilita todas as transitions e animações de bubble
- [ ] Não parece WhatsApp verde nem iMessage azul — é Torque: cool gray outgoing + gold AI accent

---

## Próximo passo

Frontend implementa via commits C9 (CSS vars) → C11 (density hook + toggle) → C15 (Tailwind classes + MessageBubble refactor), nessa ordem. Cada commit é smoke-testado isoladamente conforme gates definidos no Architect Plan.
