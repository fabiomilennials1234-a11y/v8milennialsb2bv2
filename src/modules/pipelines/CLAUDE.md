# Module — pipelines

**Status:** 🟡 Skeleton (slice 5 popula)
**BC:** pipelines
**Entidade primária:** Pipeline + Stage + Pipeline Entry
**Owner:** vendas

## Escopo

Funis de venda. Tipos:
- **Pipes canônicos** (legacy via views `pipe_*`): `pipe_whatsapp` (qualificação), `pipe_confirmacao` (reunião), `pipe_propostas` (fechamento)
- **Pipes customizados** (modelo novo via `pipeline_entries`)

Stages dinâmicas em `pipeline_stages`. Lead pode estar em múltiplos pipes simultaneamente.

Inclui:
- Kanban view + drag-drop
- Stage configuration
- Pipeline Entry CRUD
- Pipe metrics + display config
- Distribuição automática (round-robin)
- Funis hub

## Não-escopo

- Workflows disparados em stage change → `workflows`
- Campanhas por stage → `campaigns`
- Comunicação WhatsApp → `communication`

## API pública (`index.ts`) — TBD slice 5

Provável superfície:
- Hooks: `usePipelines`, `usePipelineEntries`, `usePipelineStages`, `useCustomPipelines`
- Components: `<Kanban>`, `<PipelineStage>`, `<PipelineEntryCard>`
- Types: `Pipeline`, `Stage`, `PipelineEntry`
- Eventos (post slice 19): `lead.stage_changed`, `pipeline.entry.moved` (slice 19 piloto migra `lead.stage_changed`)

## Áreas frágeis

- **Dual model**: 16 hooks misturando `usePipe*` (views legacy) e `usePipeline*` (modelo novo). Out-of-scope unificar agora (cleanup futuro).
- **Realtime**: subscriptions em `pipeline_entries`, NUNCA nas views `pipe_*` (CLAUDE.md raiz)
- **Status field**: `pipe_*` views usam `status` = `stage_key` (slug). Custom pipes usam `stage_id` (uuid)
- `triggerStageChangedWorkflows` chamado em 3 lugares (bug `08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`) — fix em slice 19 event-bus

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/pipelines/`, `pipe-propostas/`, `confirmacao/`, `kanban/`, `custom-pipelines/`, `funis/`
- `src/hooks/usePipe*.ts` (16 hooks total — pipe legacy + pipeline novo)
- `src/hooks/usePrefetchPipes.ts`
- `src/pages/PipeConfirmacao.tsx`, `PipePropostas.tsx`, `PipeWhatsapp.tsx`, `CustomPipeline.tsx`, `FunisHub.tsx`, `Negocios.tsx`

Backend:
- `supabase/functions/process-pipe-distribution/`
- `supabase/functions/pipe-rule-dispatch/`
- `supabase/functions/_shared/pipeline-adapter.ts`

## Slice de migração

**Slice 5** — `feat/modularizacao/04-pipelines` (6h + 1h dedup = 7h)

## Dedup pendente

- 16 hooks `usePipe*`/`usePipeline*` — namespacing legacy vs novo, sem unificar modelo
- 6 pastas pipeline → consolidar em `components/{kanban,custom,legacy,hub}/`
- `Negocios.tsx` vs `PipePropostas.tsx` — auditar atividade

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Filtros do Kanban: `Obsidian/.../06 — Features/Vendas/Filtros do Kanban.md`
- Pipe Confirmacao: `Obsidian/.../06 — Features/Vendas/Pipe Confirmacao.md`
- Memory: `reference_pipe_views_compat.md`
