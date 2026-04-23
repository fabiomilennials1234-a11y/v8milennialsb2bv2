# Architect Plan — Chat Onda 6.1 (Dark LOW components sweep)

**Autor:** Architect (agent-architect)
**Data:** 2026-04-23
**Branch:** `feat/chat-onda-6-1` (bifurcada de `feat/chat-onda-6-final`)
**Baseline:** tip `3326ba2` — Onda 6 final (pages closure).
**Dependência upstream:** `feat/chat-onda-6-final` deve ser mergeada antes (ou junto) desta branch.
**Status:** Plano — execução em seguida.

---

## 0. Veredicto

Onda 6.1 fecha o track **Dark LOW components** — 22 ocorrências `gray-*` residuais em 13 arquivos sob `src/components/**` + `src/types/`.

Mesmo pattern mecânico de pages: normalizar para semantic tokens (`bg-muted`, `text-muted-foreground`, `border-border`). Zero mudança funcional, zero componente novo.

**Fora de escopo (Onda 3.3):** `src/components/chat/WhatsAppChat.tsx:1327` — 1 ocorrência. Arquivo inteiro vai ser deletado na Onda 3.3 (legacy cleanup). Fixar agora = trabalho perdido.

## 1. Inventário

### Categoria 1 — Status badges / origin labels (kanban, confirmacao)

| Arquivo | Linha | Ocorrência | Fix |
|---------|-------|------------|-----|
| `src/components/kanban/CreateOpportunityModal.tsx` | 35 | TikTok `bg-gray-900` | `bg-foreground text-background` |
| `src/components/kanban/CreateOpportunityModal.tsx` | 44 | "Outros" `bg-gray-500` | `bg-muted text-muted-foreground` |
| `src/components/kanban/CreateOpportunityModal.tsx` | 285 | badge template literal fallback `bg-gray-500` | `bg-muted text-muted-foreground` |
| `src/components/kanban/KanbanCard.tsx` | 50 | TikTok `bg-gray-900/10 text-gray-900 border-gray-900/20` | `bg-foreground/10 text-foreground border-foreground/20` |
| `src/components/kanban/StageWorkflowsBadge.tsx` | 102 | inactive workflow `bg-gray-400` | `bg-muted-foreground` |
| `src/components/confirmacao/ConfirmacaoCard.tsx` | 80 | TikTok `bg-gray-900/10 text-gray-900 border-gray-900/30` | `bg-foreground/10 text-foreground border-foreground/30` |

### Categoria 2 — Status icons / config (automacoes, campanhas)

| Arquivo | Linha | Ocorrência | Fix |
|---------|-------|------------|-----|
| `src/components/automacoes/WorkflowToolbar.tsx` | 68 | end node `text-gray-400` | `text-muted-foreground` |
| `src/components/automacoes/nodes/EndNode.tsx` | 14 | CircleStop icon `text-gray-400` | `text-muted-foreground` |
| `src/components/campanhas/CampanhaAutomaticaPanel.tsx` | 58 | inactive agent `bg-gray-100 dark:bg-muted` | `bg-muted` (dropa dark: variant redundante) |
| `src/components/campanhas/CampanhaAutomaticaPanel.tsx` | 62 | inactive agent icon `text-gray-400 dark:text-muted-foreground` | `text-muted-foreground` |
| `src/components/campanhas/CampanhaSemiAutomaticaPanel.tsx` | 299 | pending batch `bg-gray-100 dark:bg-muted` | `bg-muted` |
| `src/components/campanhas/CampanhaSemiAutomaticaPanel.tsx` | 305 | pending batch icon `text-gray-400 dark:text-muted-foreground` | `text-muted-foreground` |
| `src/components/campanhas/CreateCampanhaModal.tsx` | 149 | `text-gray-600 dark:text-muted-foreground` | `text-muted-foreground` |
| `src/components/campanhas/CreateCampanhaModal.tsx` | 151 | `border-gray-200 dark:border-border` | `border-border` |
| `src/components/campanhas/CampanhaAnalytics.tsx` | 131 | Trophy rank 2 icon `text-gray-400 dark:text-muted-foreground` | `text-muted-foreground` |
| `src/components/campanhas/CampanhaAnalytics.tsx` | 138 | Trophy rank 2 gradient `from-gray-400/20 via-gray-400/10 to-transparent border-gray-400/30` | `from-muted-foreground/20 via-muted-foreground/10 to-transparent border-muted-foreground/30` |

### Categoria 3 — Chat notes legacy dark: variants

| Arquivo | Linha | Ocorrência | Fix |
|---------|-------|------------|-----|
| `src/components/chat/ConversationNotes.tsx` | 261 | `text-gray-800 dark:text-gray-200` | `text-foreground` |

### Categoria 4 — Sidebar demo (showcase)

| Arquivo | Linha | Ocorrência | Fix |
|---------|-------|------------|-----|
| `src/components/ui/sidebar-demo.tsx` | 50 | `bg-gray-100 dark:bg-neutral-800` | `bg-muted` |
| `src/components/ui/sidebar-demo.tsx` | 125 | `bg-gray-100 dark:bg-neutral-800` | `bg-muted` |
| `src/components/ui/sidebar-demo.tsx` | 133 | `bg-gray-100 dark:bg-neutral-800` | `bg-muted` |

### Categoria 5 — Workflow node type config

| Arquivo | Linha | Ocorrência | Fix |
|---------|-------|------------|-----|
| `src/types/workflow.ts` | 592 | `end: { border: "border-gray-400", bgLight: "bg-gray-50", bgDark: "dark:bg-gray-900" }` | `end: { border: "border-border", bgLight: "bg-muted", bgDark: "dark:bg-muted" }` |

### Out of scope — Onda 3.3

| Arquivo | Linha | Razão |
|---------|-------|-------|
| `src/components/chat/WhatsAppChat.tsx` | 1327 | Arquivo vai ser deletado integralmente na Onda 3.3 (flag `chatOnda2b` default-on) |

## 2. Decisões

### D1 — TikTok brand em 2 padrões

`CreateOpportunityModal.tsx:35` usa `bg-gray-900` sólido (filled badge). `KanbanCard.tsx:50` e `ConfirmacaoCard.tsx:80` usam `bg-gray-900/10 text-gray-900 border-gray-900/30` (tinted badge, mais sutil).

**Fix:**
- Sólido: `bg-foreground text-background` (brand-compliant)
- Tinted: `bg-foreground/10 text-foreground border-foreground/30`

`foreground` HSL inverte automaticamente (preto em light, branco em dark). Tinted preserva o efeito "soft tint" visual.

### D2 — dark: variants redundantes dropados

Vários componentes têm `bg-gray-100 dark:bg-muted` ou `text-gray-400 dark:text-muted-foreground`. Padrão anterior provavelmente surgiu gradualmente quando dark mode foi adicionado depois. Como `bg-muted`/`text-muted-foreground` já invertem automaticamente, as variants são ruído.

Fix: dropar variant, usar token semantic puro. Reduz LOC, unifica padrão.

### D3 — `bg-gray-50 dark:bg-gray-900` em workflow types = `bg-muted`

`types/workflow.ts:592` tem tripla `border-gray-400, bgLight: bg-gray-50, bgDark: dark:bg-gray-900`. Shape do objeto tem campos separados `bgLight`/`bgDark`, sugerindo runtime concat. Olhar uso antes de refatorar: **se consumido como `${bgLight} ${bgDark}` já nativamente**, troca para `bg-muted` deixa `bgDark` redundante mas mantém shape. Se consumidor só usa `bgLight`, aí tem que ajustar ambos.

Decisão: manter shape (campos separados), apenas usar tokens semânticos em cada.

### D4 — Sidebar-demo: showcase aspirante, dark-aware obrigatório

`ui/sidebar-demo.tsx` é um demo page (não produção), provavelmente importado por alguma rota `/demo`. Mesmo assim, parte do sistema — normalizar.

### D5 — Trophy rank 2 gradient

Usa `from-gray-400/20 via-gray-400/10 border-gray-400/30` — gradiente prata pra 2º lugar no ranking. `muted-foreground` tem hue neutro HSL que aproxima prata em ambos modos. Fix preserva intenção visual de "2º lugar / silver tone".

## 3. Tasks

Ver `tasks.md`.

## 4. Validação

- `grep "(bg|text|border|...)-gray-[0-9]+" src/` → **1 match** restante (WhatsAppChat.tsx:1327, Out of scope Onda 3.3)
- `npx tsc --noEmit` clean
- `npx eslint` nos arquivos alterados — zero novos erros

## 5. Riscos

- TikTok badge em tinted pode ficar invisível em dark mode (texto foreground/white sobre bg foreground/10 = branco sobre branco-transparente = baixo contraste). Se visual ficar ruim, fallback: `bg-foreground/20`.
- Trophy rank 2 gradient em `muted-foreground` pode perder "silver" semântico. Se stakeholder sentir que Rank 2 não se distingue de Rank 3 (bronze), refator para hue neutro explícito (`bg-neutral-400`) ou ADR futuro com token semantic `--silver`.
- Sidebar-demo fix pode mudar visual da demo page. Se for showcase de design system, stakeholder pode preferir visual "puro" Tailwind. Verificar antes se rota demo está em uso.

## 6. Follow-ups

- Onda 3.3: delete `WhatsAppChat.tsx` legacy + flag `chatOnda2b` default-on + rate limit server-side
- Onda 7+: ADR tokens semânticos `--success`/`--warning`/`--danger`/`--silver` HSL
