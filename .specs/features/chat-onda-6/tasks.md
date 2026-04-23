# Tasks — Chat Onda 6 Final

**Baseline:** `2ff302e` (Onda 6 parcial merged)
**Branch:** `feat/chat-onda-6-final` (branch própria — NÃO mergear auto em main)

## A1 — Badge fallback Master pages

- [x] `src/pages/master/MasterFeatures.tsx:171` — `bg-gray-500` → `bg-muted text-muted-foreground`
- [x] `src/pages/master/MasterAuditLogs.tsx:62` — `bg-gray-500` → `bg-muted text-muted-foreground`

## A2 — Skipped/engine badge MasterOperations

- [x] `src/pages/master/MasterOperations.tsx:162` — skipped status → `bg-muted text-muted-foreground border-border`
- [x] `src/pages/master/MasterOperations.tsx:772` — engine fallback → idem

## A3 — Privacidade dark-ification (14 ocorrências)

- [x] Container: `bg-white text-gray-900` → `bg-background text-foreground`
- [x] H2 headings (6x): `text-gray-900` → `text-foreground`
- [x] Body: `text-gray-700` → `text-foreground/80`
- [x] Meta: `text-gray-500` → `text-muted-foreground`
- [x] Footer meta: `text-gray-400` → `text-muted-foreground`
- [x] Border footer: `border-gray-200` → `border-border`
- [x] Links (2x): `text-blue-600` → `text-primary`

## A4 — AutomacoesExecucoes + PipeWhatsapp + CampanhaDetail

- [x] `AutomacoesExecucoes.tsx:50,341` — `text-gray-400` → `text-muted-foreground`
- [x] `PipeWhatsapp.tsx:58` — TikTok `bg-gray-900` → `bg-foreground text-background`
- [x] `PipeWhatsapp.tsx:67` — "Outros" `bg-gray-500` → `bg-muted text-muted-foreground`
- [x] `CampanhaDetail.tsx:34` — manual campaign badge simplificado para semantic puro

## A5 — Docs

- [x] `.specs/features/chat-onda-6/architect-plan.md` (closure + decisões + riscos)
- [x] `.specs/features/chat-onda-6/tasks.md` (este arquivo)

## A6 — Validação

- [x] Grep `(bg|text|border|ring|shadow|hover:|dark:|divide|placeholder|via|from|to)-gray-[0-9]+` em `src/pages/` → 0 matches
- [ ] `npx tsc --noEmit` clean
- [ ] QA visual: smoke test Privacidade + Master Features/AuditLogs/Operations + AutomacoesExecucoes + PipeWhatsapp + CampanhaDetail em dark mode

## A7 — Obsidian

- [ ] Atualizar `06 — Features/Chat/Dark Mode Audit.md` (ou criar se não existir) — marcar Dark LOW pages = done
- [ ] Criar/append `07 — Changelog/2026-04-23.md` — registrar Onda 6 final

## A8 — Commit + push (SEM merge em main)

- [ ] Commit 1: fix pages dark mode (7 arquivos)
- [ ] Commit 2: docs Onda 6 architect plan + tasks
- [ ] Push `feat/chat-onda-6-final` para origin
- [ ] CTO decide abertura de PR manual

## Out of scope — reagendado

### Onda 6.1 — Components dark sweep

14 arquivos, 22 ocorrências:
- `src/types/workflow.ts` (1)
- `src/components/kanban/StageWorkflowsBadge.tsx` (1)
- `src/components/kanban/KanbanCard.tsx` (1)
- `src/components/kanban/CreateOpportunityModal.tsx` (3)
- `src/components/chat/ConversationNotes.tsx` (1)
- `src/components/automacoes/WorkflowToolbar.tsx` (1)
- `src/components/automacoes/nodes/EndNode.tsx` (1)
- `src/components/campanhas/CampanhaAutomaticaPanel.tsx` (2)
- `src/components/campanhas/CampanhaSemiAutomaticaPanel.tsx` (2)
- `src/components/campanhas/CreateCampanhaModal.tsx` (2)
- `src/components/campanhas/CampanhaAnalytics.tsx` (2)
- `src/components/confirmacao/ConfirmacaoCard.tsx` (1)
- `src/components/ui/sidebar-demo.tsx` (3)

### Onda 3.3 — Chat legacy cleanup

- `src/components/chat/WhatsAppChat.tsx` (1 ocorrência gray-*, mas delete integral)
- Flag `chatOnda2b` default-on
- Rate limit server-side (token bucket persistido)

### Onda 7+ — Design system tokens semânticos

ADR: `--success`/`--warning`/`--danger` HSL em `tailwind.config.ts`
