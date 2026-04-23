# Tasks — Chat Onda 6.1 (components sweep)

**Baseline:** `3326ba2` (Onda 6 final)
**Branch:** `feat/chat-onda-6-1` (bifurcada de `feat/chat-onda-6-final`)

## B1 — Kanban (3 arquivos)

- [ ] `kanban/CreateOpportunityModal.tsx:35,44,285` — TikTok + Outros + fallback template
- [ ] `kanban/KanbanCard.tsx:50` — TikTok tinted badge
- [ ] `kanban/StageWorkflowsBadge.tsx:102` — inactive workflow indicator

## B2 — Campanhas (5 arquivos)

- [ ] `campanhas/CampanhaAutomaticaPanel.tsx:58,62` — inactive agent state
- [ ] `campanhas/CampanhaSemiAutomaticaPanel.tsx:299,305` — pending batch state
- [ ] `campanhas/CreateCampanhaModal.tsx:149,151` — muted text + border
- [ ] `campanhas/CampanhaAnalytics.tsx:131,138` — Trophy rank 2 icon + gradient

## B3 — Automacoes (2 arquivos)

- [ ] `automacoes/WorkflowToolbar.tsx:68` — end node icon color
- [ ] `automacoes/nodes/EndNode.tsx:14` — CircleStop color

## B4 — Confirmacao

- [ ] `confirmacao/ConfirmacaoCard.tsx:80` — TikTok tinted badge

## B5 — Chat notes

- [ ] `chat/ConversationNotes.tsx:261` — text-gray-800 dark:text-gray-200 → text-foreground

## B6 — UI demo + types

- [ ] `ui/sidebar-demo.tsx:50,125,133` — bg-gray-100 dark:bg-neutral-800 → bg-muted (3x)
- [ ] `types/workflow.ts:592` — end node config semantic tokens

## B7 — Validação

- [ ] `npx tsc --noEmit` clean
- [ ] `grep "(bg|text|border|...)-gray-[0-9]+" src/` → 1 match apenas (WhatsAppChat legacy)
- [ ] QA visual manual — smoke test kanban + campanhas + automacoes + confirmacao

## B8 — Docs + Obsidian + commit

- [ ] Update `06 — Features/Comunicacao/Chat WhatsApp.md` histórico Onda 6.1
- [ ] Append `07 — Changelog/2026-04-23.md` seção Onda 6.1
- [ ] Commit `fix(app): dark LOW components sweep`
- [ ] Commit `docs: Onda 6.1 architect-plan + tasks`
- [ ] Push `feat/chat-onda-6-1` (sem merge em main)

## Out of scope

- `src/components/chat/WhatsAppChat.tsx:1327` — delete integral em Onda 3.3
