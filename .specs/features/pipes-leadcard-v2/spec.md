# Spec — Pipes + Lead Card v2

**Date:** 2026-04-23
**Scope:** Large
**Domain:** Frontend + Architect
**Approved by:** CTO (caveman session)

## Problem

Usuários têm dificuldade de entender as features do kanban e como usá-las nos pipes. Evidências diretas no código:

- `LeadCard.tsx` (615 LOC) empilha 8 tipos de badge na mesma linha, sem hierarquia — origin, urgency, tags(3), +N, potencial, inactive, date, calor.
- Calor popover só renderiza se `rating > 0` → discoverability zero.
- Quick Action é ícone `Target` genérico sem label.
- Botão WhatsApp full-width verde compete com click do card.
- `PipeWhatsapp`, `PipePropostas`, `PipeConfirmacao`, `PipeFollowUps` duplicam ~70% código (header, stats, filters, delete dialogs).
- 3–4 rows de config antes do kanban (period selector, stats, filters, banner).
- Header com 2 CTAs quase-iguais ("Novo Lead" vs "Nova Oportunidade").
- Column header sobrecarregado: dot + title + count + workflow badge + botão `+` placeholder + menu.
- Workflow badge usa ícone `Zap` abstrato, sem label.
- Horizontal scroll no board sem affordance (scrollbar-hide + sem gradient fade).
- `is_final_positive` dispara modal chain invisível em drag (AddMeeting, CompareceuModal, CommitmentDate, TinyERP, Cadastro Externo, LossReason) sem preview.

## Goals

1. Card lead mais escaneável — hierarquia visual clara, 1 hero metric por variant, reveal progressivo em hover.
2. Calor sempre visível como border-left colorido (substitui badge condicional).
3. Página pipe com shell compartilhado → 4 pages ≤ 200 LOC cada.
4. Header com CTA único (dropdown Lead/Oportunidade), settings como ícone.
5. Filtros em linha única com chips dismissíveis, secundários em sheet.
6. Stats condensados com delta placeholder (hook de comparativo fica para follow-up).
7. Column header slim — apenas título + count + stripe color + workflow chip com label + `+` wirado.
8. Gradient fade nas bordas L/R do kanban board para affordance de scroll.
9. Preview textual de modal chain ao hover sobre coluna `is_final_positive`.

## Non-goals (este ciclo)

- Hook `usePipeMetricsCompare` (delta real vs período anterior) — placeholder na v1.
- Redesign de `LeadDetailDrawer` — será onda 4 follow-up.
- Mobile-first reflow do kanban (continua scroll horizontal).
- Refatorar `DraggableKanbanBoard` para DnD novo — mantém `@dnd-kit`.

## Ondas

### Onda 1 — LeadCard v2
Reescreve `src/components/leads/LeadCard.tsx`. Mantém mesma API pública (`LeadCardProps`) para compat. Muda:
- Hierarquia por linhas L1–footer (ver plano).
- Slot pattern interno via `renderHero()` por variant; API externa inalterada.
- Calor como border-left 3px permanente + popover inalterado.
- Quick actions aparecem em hover (hover-reveal footer row) com tooltips.
- Elimina WhatsApp full-width verde — passa para hover row.
- Badges reorganizados em hierarquia: origin SEMPRE 1ª, depois {urgency OR inactive OR date OR potencial} no máx 2, tags com max 2 + `+N`.

### Onda 2 — PipeShell
Novo `src/components/pipelines/PipeShell.tsx` + subcomponentes:
- `PipeHeader` — title + subtitle + actions slot
- `PipeFilterBar` — search + chips + "Mais filtros" sheet
- `PipeStatsBar` — hero metric + 3 secundárias + delta placeholder
- `PipePeriodChip` — unifica MetricsPeriodSelector collapse + period banner dismissível
- `DeletePipeCardDialog`, `DeleteStageLeadsDialog` — extraídos (eram duplicados em 4 pages)

Refatora 4 pages:
- `PipeWhatsapp.tsx` — 621 → ~200 LOC
- `PipePropostas.tsx` — 1479 → ~350 LOC (mantém analytics tab)
- `PipeConfirmacao.tsx` — 796 → ~280 LOC (mantém timeline tab + ConfirmacaoFilters custom)
- `PipeFollowUps.tsx` — parcial (estrutura diferente, lista agrupada; aplica PipeHeader + stats style)

### Onda 3 — Kanban column + drag UX
Modifica `src/components/kanban/DraggableKanbanBoard.tsx`:
- Column header slim: stripe color 3px top + title + count.
- Workflow badge inline com label: `⚡ 3 auto` (hover expande).
- Botão `+` da coluna wirado → `onAddInColumn(stageId)` callback. Pages passam CreateOpportunityModal com stage pré-preenchido. Sem handler → botão some.
- Gradient fade nas bordas L/R do container horizontal.
- Preview de chain modal: se stage tem `is_final_positive` ou stage-key mapeada, column header mostra chip `→ Destino` (ex: `→ Confirmação`).

### Mockup (final)
HTML standalone em `mockups/pipes-leadcard-v2.html` com Tailwind CDN + design tokens replicados. Mostra:
- 3 variantes de LeadCard (whatsapp, confirmacao, propostas) com calor quente/morno/frio
- PipeShell completo com stats + filters + period chip
- Kanban board com 4 colunas + gradient fade + workflow chip + preview chain
- Hover states documentados

## Verification

Por onda:
- `npm run lint` sem novos warnings
- `npx tsc --noEmit` sem novos erros
- `npm run build` passa
- Review manual: cada página pipe preserva funcionalidade (drag, filters, dialogs)

## Risks

- **Regression em pipes específicos** (ConfirmacaoFilters custom, AnalyticsTab propostas, RescheduleModal chain) — mitigação: PipeShell expõe `renderSlot` para customização local.
- **API break do LeadCard** — mitigação: API pública inalterada, só muda internals.
- **Delta placeholder causar confusão** — mitigação: ícone ausente, só nome+valor, sem chevron up/down.

## Tasks

Ver `tasks.md`.
