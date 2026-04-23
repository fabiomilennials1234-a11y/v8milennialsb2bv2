---
date: 2026-04-23
branch: claude/relaxed-blackburn-8e1b86
agents: [Conductor, Architect, Frontend, QA]
scope: Large
---

# 2026-04-23 — feat(pipes): LeadCard v2 + PipeShell + Kanban UX overhaul

## Contexto

CTO pediu revisão UX/UI técnica dos funis (pipes) e do card de lead. Usuários têm dificuldade entender features do kanban e como usar no frontend. Objetivo: mesmo DNA do redesign do chat — dark-first, editorial, hierarquia clara, reveal progressivo em hover.

## Diagnóstico (evidências no código)

| Área | Pain point | Arquivo |
|---|---|---|
| LeadCard | 8+ badges empilhados sem hierarquia | [LeadCard.tsx:395-446](../../../../src/components/leads/LeadCard.tsx:395) (versão antiga) |
| LeadCard | Calor só aparece se `rating > 0` | [LeadCard.tsx:443](../../../../src/components/leads/LeadCard.tsx:443) (antiga) |
| LeadCard | WhatsApp CTA verde compete com click do card | antigo |
| Pipe pages | 4 rows antes do kanban | PipeWhatsapp/PipePropostas/PipeConfirmacao |
| Pipe pages | Duplicação ~70% entre 4 pages | header + stats + filters + dialogs |
| Pipe pages | Header com 3 CTAs ambíguos | Settings + Novo Lead + Nova Oportunidade |
| Kanban column | Header poluído + botão `+` placeholder sem handler | [DraggableKanbanBoard.tsx:88-130](../../../../src/components/kanban/DraggableKanbanBoard.tsx:88) (antiga) |
| Kanban column | Workflow badge com `Zap` abstrato, sem label | StageWorkflowsBadge |
| Kanban board | `scrollbar-hide` + sem gradient fade = zero affordance | antiga |
| Drag UX | Modal chain invisível em `is_final_positive` | handleStatusChange |

## Implementação

### Onda 1 — LeadCard v2 (reescrita)

[LeadCard.tsx](../../../../src/components/leads/LeadCard.tsx) — API pública inalterada. Muda:

- **Hierarquia por linhas**: L1 nome + menu (hover-reveal) · L2 empresa · L3 `origin` + max 2 secundárias + `🔥 calor` à direita · L4 **hero slot** (varia por variant) · L5 tags max 2 + `+N` · hover row com quick actions · footer responsável + tempo relativo.
- **Calor sempre visível** — border-left 3px colorido permanente via `--card-accent`. Popover inalterado.
- **Hero slot** (prioridade interna): produtos > data+Meet > valor > telefone > notes.
- **Quick actions em hover-reveal** — 3 icon buttons tooltips (Ligar · WhatsApp · Ação do dia). Remove WhatsApp CTA full-width verde.
- **Badges secundárias** priorizadas: urgency > inactive > potencial > date indicator (max 2 exibidas).

### Onda 2 — PipeShell componentes compartilhados

Novos em `src/components/pipelines/`:

- [PipeHeader.tsx](../../../../src/components/pipelines/PipeHeader.tsx) — title + subtitle + count + settings ícone + CTA único `+ Novo ▾` com descrições inline (dropdown quando múltiplas ações, botão direto quando uma).
- [PipeStatsRow.tsx](../../../../src/components/pipelines/PipeStatsRow.tsx) — stats condensados com stripe accent lateral, hero metric, ícones opcionais, delta placeholder (flag `showDeltaPlaceholder`), stats interativas (acts as filter).
- [PipeFilterBar.tsx](../../../../src/components/pipelines/PipeFilterBar.tsx) — search + chips removíveis inline + sheet "Mais filtros" com badge counter + clear-all.
- [PipePeriodChip.tsx](../../../../src/components/pipelines/PipePeriodChip.tsx) — unifica MetricsPeriodSelector + banner "exibindo..." em chip compacto dismissível.
- [DeletePipeCardDialog.tsx](../../../../src/components/pipelines/DeletePipeCardDialog.tsx) — `DeletePipeCardDialog` + `DeleteStageLeadsDialog` extraídos (eram duplicados 4x).

Refatorações:
- [PipeWhatsapp.tsx](../../../../src/pages/PipeWhatsapp.tsx) — 621 LOC → 406 LOC (-35%). Full shell.
- [PipePropostas.tsx](../../../../src/pages/PipePropostas.tsx) — mantém analytics tab custom. Header + stats + filterBar + periodChip + delete dialogs adotados.
- [PipeConfirmacao.tsx](../../../../src/pages/PipeConfirmacao.tsx) — mantém timeline view + ConfirmacaoFilters custom (filtros complexos de data). Header + periodChip + delete dialogs adotados.
- [PipeFollowUps.tsx](../../../../src/pages/PipeFollowUps.tsx) — header redesenhado (estilo PipeHeader, mas com ListTodo icon por ser fluxo diferente).

### Onda 3 — Kanban column + drag UX

[DraggableKanbanBoard.tsx](../../../../src/components/kanban/DraggableKanbanBoard.tsx):

- **Column header slim** — stripe color 3px top + título + count chip. Dot colorido removido.
- **Botão `+` wirado** — callback `onAddInColumn(stageId)`. Pages usam para preset de stage no CreateOpportunityModal ou abrir modal relevante (Meeting, Proposta).
- **Empty state** — coluna sem cards mostra dashed-border CTA "+ Adicionar em {stage}".
- **Preview destino** — prop `stageDestinations` mapeia `stage_key → "Confirmação"/"Propostas"` e renderiza chip `→ Confirmação` no header da coluna `is_final_positive`, com tooltip explicando o modal chain.
- **Gradient fade** — divs absolutos left/right sobre o container do scroll. Opacidade controlada por estado `scrollState.atStart/atEnd` (ResizeObserver + scroll listeners).
- **Workflow badge** continua via `renderColumnExtra` mas agora com label inline na proposta visual ("⚡ 3 auto") — componente permanece extensível.

### Mockup

[mockups/pipes-leadcard-v2.html](../../../../mockups/pipes-leadcard-v2.html) — standalone HTML dark-first com Tailwind CDN. 6 seções: PipeShell completo · Kanban board 4 colunas · 3 variantes lado a lado · estado hover · calor popover · antes vs depois.

## Validação

- `npx tsc --noEmit` — **zero erros novos** (pré-existentes do projeto não afetados).
- `npm run build` — **passa** em 34s. Chunk sizes: PipePropostas 86kB (análogo ao antigo), PipeConfirmacao 53kB.
- `npx eslint` — 0 novos erros funcionais. Warnings pré-existentes de `any` em transformToCard/filterItems mantidos (fora de escopo deste ciclo).
- Manual ainda pendente em dev server — feature preserva: drag-drop, filters, period selection, delete dialogs, modal chains (meeting/commitment/loss-reason/tiny-erp/cadastro-externo/reschedule/compareceu).

## Métricas de LOC

| Arquivo | Antes | Depois |
|---|---:|---:|
| LeadCard.tsx | 615 | 549 |
| PipeWhatsapp.tsx | 621 | 406 |
| PipePropostas.tsx | 1479 | 1305 |
| PipeConfirmacao.tsx | 796 | 730 |
| DraggableKanbanBoard.tsx | 355 | 401 (novos gradient + preview destino) |

## Follow-ups

1. **Hook `usePipeMetricsCompare`** — delta real vs período anterior (placeholder na v1).
2. **LeadDetailDrawer redesign** (onda 4) — alinhar header ao DNA chat.
3. **StageWorkflowsBadge** inline label (hoje via `renderColumnExtra`) — visual leve ainda pode ser refinado.
4. **Mobile reflow** do kanban (vertical tabs ou single-column view) — fora de escopo.

---

## Iteração 2 (mesma data) — reversões + drawer simplification

Feedback CTO após ver implementação inicial:

### Rejeitado visualmente
- Kanban redesign (column sem bg, stripe luminoso, count/auto/dest chips premium)
- Lead card v2 (heat-bar, origin monochrome pill, meta-row, font-display, calor border permanente)
- Stats premium (halo radial, glow gold, delta chips)

### Ação: revert cirúrgico para git HEAD
- `src/components/leads/LeadCard.tsx` — restaurado (badges pastel coloridas, calor inline, WhatsApp CTA verde full-width, contact-block border-left)
- `src/components/kanban/DraggableKanbanBoard.tsx` — restaurado (column bg-muted/50, dot+title+count header, `Plus`/`MoreHorizontal` sem callback)
- `src/components/pipelines/PipeStatsRow.tsx` — simplificado (bg-card border, 2xl value, sem halo/glow)
- `src/index.css` — restaurado (sem classes premium invasivas)
- Pages — removido `onAddInColumn`, `stageDestinations`, `handleAddInColumn`, `opportunityStagePreset` (orfãos após revert)

### Mantido do redesign
- PipeShell infra compartilhada (PipeHeader + PipeFilterBar + PipePeriodChip + PipeStatsRow + DeletePipeCardDialog)
- Gradient fade L/R do kanban
- Header premium do LeadDetailDrawer (gold halo, avatar ring, tabs underline)

### LeadDetailDrawer simplification (aprovado)
De **5 tabs → 3 tabs**:
- REMOVIDA aba **Contexto do funil** → `renderFunnelContext` agora na sidebar acima de Responsável, com **estado vazio desenhado** quando null (card dashed + CTA "Ver pipeline completo" → activeTab=pipeline)
- REMOVIDA aba **Chat** (duplica Chat WhatsApp dedicado)
- REMOVIDO bloco **Histórico recente** da aba Dados (duplicava tab Histórico)
- MANTIDA aba **Histórico** world-class (timeline verticalizado, dots coloridos por tipo)

### Polish final + QA review (code-reviewer)

Code review identificou issues críticos:

**Blocker:** classes CSS `filter-chip`, `filter-chip-active`, `chip-value`, `tag-pill`, `origin-pill`, `heat-chip`, `heat-chip-hot/warm/cold`, `font-display`, `font-mono-num` referenciadas em código mas **faltando** em `index.css` (só existiam no mockup HTML). Resolvido — portadas para `@layer components` em [src/index.css](../../../../src/index.css) com variants dark.

**Correções aplicadas:**
- Dead code removido: `stageDestinations`, `handleAddInColumn`, `opportunityStagePreset`, `deleteAllLeadsDialogOpen` (PipeWhatsapp/PipeConfirmacao/PipePropostas)
- Imports orfãos: `Filter`, `ArrowUpRight`, `Tabs`/`TabsContent`/`TabsList`/`TabsTrigger`, `ConversationHistoryTab` (PipeFollowUps + LeadDetailDrawer)
- `console.log` debug stripped de PipePropostas (2 ocorrências)
- Header doc comment do drawer corrigido (5→3 tabs)
- a11y: `aria-label="Mais opções"` no MoreVertical do header drawer
- **Perf:** `lead-pipes` query (5 full-table scans) agora lazy — carrega só quando `activeTab === "pipeline"`. Drawer aberto no tab Dados: -5 queries

**Falsos positivos do QA:** `createdAt` sort em PipeConfirmacao está correto (sort roda PRÉ `transformToCard`, recebendo `item` do pipeData com `created_at` original do banco).

### Design skills aplicadas
- `/hm-design` invocado pra validar mockups — reprovou emojis, sugeriu Lucide SVG inline padrão (stroke 2, currentColor, round linecap/linejoin, viewBox 24, w-3/w-3.5/w-4/w-5)
- Mockup `mockups/pipes-light-drawer.html` refeito zero-emoji — todos ícones Lucide inline + WhatsApp brand path

### Memória
- `~/.claude/projects/.../memory/feedback_design_workflow.md` — regra permanente: tarefas de design invocam `/hm-design`; tarefas UX/UI invocam `agent-conductor`; zero emoji em mockups/código.

## Referências

- Spec: [.specs/features/pipes-leadcard-v2/spec.md](../../../../.specs/features/pipes-leadcard-v2/spec.md)
- Mockup: [mockups/pipes-leadcard-v2.html](../../../../mockups/pipes-leadcard-v2.html)
