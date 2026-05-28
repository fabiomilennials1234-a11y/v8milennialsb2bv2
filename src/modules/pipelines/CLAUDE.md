# Module — pipelines

**Status:** 🟢 Active (slice 5 + cleanup longtail slice 16 — 2026-05-28)
**BC:** pipelines
**Entidade primária:** Pipeline + Stage + Pipeline Entry
**Owner:** vendas

## Escopo

Funis de venda. Dois modelos coexistem:

- **Pipes canônicos (legacy)**: `pipe_whatsapp` (qualificação), `pipe_confirmacao` (reunião), `pipe_propostas` (fechamento). Views sobre `pipeline_entries` (coluna `status` = `stage_key` slug). Hooks namespace `usePipe*`.
- **Pipelines customizados (modelo novo)**: `pipeline_entries` + `pipeline_stages` (coluna `stage_id` uuid). Hooks namespace `usePipeline*` / `useCustom*`.

Stages dinâmicas em `pipeline_stages`. Lead pode estar em múltiplos pipes simultaneamente (invariante crítico).

Inclui:
- Kanban view (drag-drop, list, table) + filtros
- Pipeline + Stage CRUD
- Pipeline Entry CRUD + move/migrate
- Pipe metrics + display config (visibilidade por org)
- Distribuição automática (round-robin)
- Dispatch rules (sequência de templates)
- Custom pipelines + temporary funnels
- Confirmação de reunião (modais standalone legacy)
- Settings dialog unificado

## Não-escopo

- Workflows disparados em stage change → `workflows` (consumido via event-bus `lead.stage_changed` desde slice 19)
- Campanhas por stage → `campaigns`
- Comunicação WhatsApp → `communication`
- Edge functions (`process-pipe-distribution`, `pipe-rule-dispatch`, `_shared/pipeline-adapter.ts`) → slice 15 (consolidação backend)
- Analytics agregadas (`useAnalyticsPipesFunis`) → slice 12 (`analytics`)

## API pública (`index.ts`)

Ver `./index.ts` para a superfície completa. Estável.

### Hooks — pipe legacy (views `pipe_*`)
- WhatsApp: `usePipeWhatsapp`, `useCreatePipeWhatsapp`, `useUpdatePipeWhatsapp`, `useDeletePipeWhatsapp`
- Confirmação: `usePipeConfirmacao`, `useCreatePipeConfirmacao`, `useUpdatePipeConfirmacao`, `useDeletePipeConfirmacao`, `usePipeConfirmacaoByLeadId`
- Propostas: `usePipePropostas`, `useCreatePipeProposta`, `useUpdatePipeProposta`, `useDeletePipeProposta`, `usePipePropostaByLeadId`
- Proposta items: `usePipePropostaItems`, `useCreatePipePropostaItem`, `useCreateManyPipePropostaItems`, `useUpdatePipePropostaItem`, `useDeletePipePropostaItem`

### Hooks — modelo novo (`pipeline_entries` + `pipeline_stages`)
- `usePipelines`, `usePipeline`, `usePipelineEntriesBySlug`, `useCreatePipelineEntry`, `useUpdatePipelineEntry`, `useMovePipelineEntry`, `useMigratePipeEntries`
- `usePipelineId`, `usePipelineEntries` (slug-typed wrapper)
- `usePipelineStages`, `useAllPipelineStages`, `stagesToColumns`, `useCreatePipelineStage`, `useUpdatePipelineStage`, `useDeletePipelineStage`, `DEFAULT_STAGES`

### Hooks — config + metrics + rules
- Display config: `usePipelineDisplayConfig`, `useHiddenDefaultPipes`, `useTogglePipeVisibility`
- Metrics: `usePipePropostasMetrics`, `usePipeConfirmacaoMetrics`, `usePipeWhatsappMetrics`, `computeConfirmacaoStats`
- Dispatch: `usePipeDispatchRules`, `usePipeDispatchRuleSteps`, `useCreatePipeDispatchRule`, `useUpdatePipeDispatchRule`
- Distribution: `usePipeDistributionRule`, `useSavePipeDistribution`

### Hooks — custom pipelines + funnels
- `useCustomPipelines`, `usePermanentCustomFunnels`, `useTemporaryFunnels`, `TEMPORARY_FUNNEL_STAGES`
- Members: `usePipelineMembers`, `useAddPipelineMember`, `useUpdatePipelineMember`, `useRemovePipelineMember`, `useIncrementMemberAchieved`

### Hooks — performance
- `usePrefetchPipes`

### Hooks — slice 16 longtail
- `useLossReasons` — CRUD loss reasons per org (configurável em settings, usado em `pipe_propostas` Lost stage)

### Components — kanban
- `KanbanBoard`, `KanbanCard`, `KanbanFilterPanel`, `DraggableKanbanBoard`
- `PipelineListView`, `PipeTableView`
- `CreateOpportunityModal`, `ExportStageDialog`
- `StageWorkflowsBadge`, `StageWorkflowsBadgeWrapper`
- Helpers do filtro: `originLabels`, `ALL_ORIGIN_OPTIONS`, `countActiveFilters`

### Components — shared (configuração + dispatch)
- `PipeSettingsDialog`, `ManagePipelineStagesContent`, `ManagePipelineStagesModal`
- `PipeDispatchRulesSection`, `PipeDistributionSection`
- `MetricsPeriodSelector`
- `GhostLeadsBanner`

### Components — custom pipelines
- `CustomPipelineKanban`, `CustomPipeLeadCard`, `CustomPipeSettingsDialog`
- `CreatePipelineModal`, `AddLeadToPipeModal`, `ImportCustomPipelineContent`
- Constantes: `PIPELINE_COLORS`, `PIPELINE_ICONS`

### Components — funis (creators)
- `CreateFunilOuCampanhaModal`, `CreateTemporaryFunnelModal`

### Components — legacy (confirmação standalone)
- Cards/stats: `ConfirmacaoCard`, `ConfirmacaoStats`, `ConfirmacaoDetailModal`
- Meeting helpers: `AddMeetingModal`, `RescheduleModal`, `CompareceuModal`, `MeetingCountdown`, `MeetingTimeline`
- Daily action: `QuickAddDailyAction`

### Pages (deep-import only — preserva `React.lazy()`)
- `@/modules/pipelines/pages/PipeWhatsapp`
- `@/modules/pipelines/pages/PipeConfirmacao`
- `@/modules/pipelines/pages/PipePropostas`
- `@/modules/pipelines/pages/PipeFollowUps`
- `@/modules/pipelines/pages/CustomPipeline`
- `@/modules/pipelines/pages/FunisHub`
- `@/modules/pipelines/pages/Negocios`

Pages NÃO são exportadas via `index.ts` — `App.tsx` faz deep-import para preservar code-splitting via `React.lazy()` + `lazyRetry`.

### Types públicos
- Legacy (pipe_*): `PipeWhatsapp{,Insert,Update,Status}`, `PipeConfirmacao{,Insert,Update,Status,Row}`, `PipeProposta{,Insert,Update,Row}`, `PipePropostasStatus`, `PipePropostaItem{,Insert}`
- Modelo novo: `Pipeline`, `PipelineEntry`, `PipelineType` (`whatsapp|confirmacao|propostas|upsell_base|upsell_gestao`), `PipelineStage`, `PipelineStageInsert`
- Config: `PipelineDisplayConfig`
- Metrics: `PipePropostasMetrics`, `PipeConfirmacaoMetrics`, `PipeWhatsappMetrics`, `MetricsPeriod`, `DateRange`, `MetricsPeriodState`
- Rules: `PipeDispatchRule`, `PipeDispatchRuleStep`, `PipeDispatchRuleTriggerType`, `PipeDispatchRuleStepActionType`, `PipeDispatchRuleTimeoutAction`, `SdrAssignmentMode`
- Distribution: `DistributionMode`, `PipeDistributionRule`, `PipeDistributionMember`
- Custom: `CustomPipeline`, `CustomPipelineStage`, `CustomPipeEntry`, `LifecycleType`, `FunnelStatus`, `FunnelTemplateType`, `CustomPipelineMember`, `MemberRole`
- Kanban: `KanbanCardLead`, `KanbanCardLeadTag`, `KanbanColumn`, `DraggableItem`, `FilterSectionConfig`, `KanbanFilterPanelProps`, `PipelineListViewProps`
- Confirmação: `ReschedulingMode`

Eventos (post slice 19): `lead.stage_changed`, `pipeline.entry.moved`. Slice 19 piloto migra `lead.stage_changed`.

## Áreas frágeis

- **Dual model**: hooks `usePipe*` operam views legacy `pipe_*` (status=stage_key slug); hooks `usePipeline*` operam `pipeline_entries` (stage_id uuid). **Não unificar** — cleanup futuro fora do escopo slice 5.
- **Realtime**: subscriptions em `pipeline_entries` via `useRealtimeSubscription`, **nunca** nas views `pipe_*` (regra CLAUDE.md raiz). `usePipelineEntries.ts` + `usePipelines.ts` usam o hook. Não mexer na assinatura sem testar multi-tab.
- **Status field divergente**: pipe_* views = `status` (slug string). Custom pipes = `stage_id` (uuid). Code paths separados.
- **Lead em múltiplos pipes simultaneamente** — invariante crítico. `useLeadAllPipelines` (módulo `leads`) consolida via RPC.
- **Multi-tenancy**: toda query filtra `organization_id` via hook `useOrganization()`. RLS no Postgres é o gate final.
- **`statusColumns` duplicado**: existe em 3 hooks (`usePipeWhatsapp`, `usePipeConfirmacao`, `usePipePropostas`) com valores diferentes — não-exportado via index pra evitar colisão. Consumir via deep-import quando necessário.
- **`usePipelineEntries` colisão de nome**: existe em `usePipelines.ts` (versão por `pipelineId`) e `usePipelineEntries.ts` (versão por slug). Index exporta a versão slug-typed; deep-import pra outra.

## Origem (pré-slice 5)

Frontend (todas movidas, dirs antigas removidas):
- ~~`src/components/kanban/`~~ (10 arquivos) → `src/modules/pipelines/components/kanban/`
- ~~`src/components/confirmacao/`~~ (9 arquivos) → `src/modules/pipelines/components/legacy/confirmacao/`
- ~~`src/components/pipe-propostas/`~~ (vazia, só stub) → removida
- ~~`src/components/custom-pipelines/`~~ (6 arquivos) → `src/modules/pipelines/components/custom/`
- ~~`src/components/funis/`~~ (2 arquivos) → `src/modules/pipelines/components/funis/`
- ~~`src/components/pipelines/`~~ (6 arquivos) → `src/modules/pipelines/components/shared/`
- ~~`src/hooks/usePipe*.ts`, `usePipeline*.ts`, `useCustomPipelines.ts`, `useCustomPipelineMembers.ts`, `usePrefetchPipes.ts`~~ (16 arquivos) → `src/modules/pipelines/hooks/`
- ~~`src/pages/PipeWhatsapp.tsx`, `PipeConfirmacao.tsx`, `PipePropostas.tsx`, `PipeFollowUps.tsx`, `CustomPipeline.tsx`, `FunisHub.tsx`, `Negocios.tsx`~~ (7 arquivos) → `src/modules/pipelines/pages/`

Backend (NÃO movidos nesta slice — vai pra slice 15):
- `supabase/functions/process-pipe-distribution/`
- `supabase/functions/pipe-rule-dispatch/`
- `supabase/functions/_shared/pipeline-adapter.ts`

Out-of-scope (movem em outras slices):
- `useAnalyticsPipesFunis` → `analytics` (slice 12)

## Dedup feita (slice 5)

- **Pasta vazia removida**: `src/components/pipe-propostas/index.ts` (stub `export {}`) excluída — não havia conteúdo a mover.

## Dedup pendente (out-of-scope slice 5)

- **Dual model unificação**: hooks `usePipe*` (views) vs `usePipeline*` (entries). Cleanup futuro depois de migrar consumidores 100% para `pipeline_entries`.
- **`statusColumns`** existe em 3 hooks com valores divergentes — manter por compat até refactor.
- **`Negocios.tsx` vs `PipePropostas.tsx`** — auditar atividade (continua pendente).

## Slice de migração

**Slice 5** — branch `feat/modularizacao/04-pipelines` (estimativa 6h impl + 1h dedup = 7h).

## Refs

- ADR: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Filtros do Kanban: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Filtros do Kanban.md`
- Pipe Confirmacao: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Pipe Confirmacao.md`
- Memory: `reference_pipe_views_compat.md`
- SPEC modularização: `.specs/features/modularizacao/SPEC.md`
- Slices roadmap: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md`
