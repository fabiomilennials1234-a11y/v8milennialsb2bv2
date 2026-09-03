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

## Estrutura interna (re-deepen slice 7.3-bis — 2026-05-29)

Re-deepen executado dentro da Fase 7 (absorveu a Fase 8 do roadmap-arch-deepening). `hooks/` e `components/` reorganizados em sub-pastas por sub-conceito, cada uma com **sub-barril privado** (`index.ts`, não cross-module):

```
src/modules/pipelines/
├── hooks/
│   ├── legacy/     # usePipe* (views pipe_* — status=stage_key slug) + index.ts
│   ├── model/      # usePipeline* (pipeline_entries + pipeline_stages — stage_id uuid) + index.ts
│   ├── config/     # display config + metrics + dispatch + distribution + index.ts
│   ├── custom/     # useCustomPipelines + funnels + members + index.ts
│   └── perf/       # usePrefetchPipes + index.ts
├── components/
│   ├── kanban/     # KanbanBoard, list/table views, filtros + index.ts
│   ├── shared/     # settings dialog, dispatch/distribution sections + index.ts
│   ├── custom/     # custom pipeline kanban + modais + index.ts
│   ├── funis/      # creators (CreateFunilOuCampanha, CreateTemporaryFunnel) + index.ts
│   └── legacy/confirmacao/   # confirmação standalone (cards, meeting modais) + index.ts
├── pages/          # deep-import only (React.lazy) — NÃO no barrel público
└── index.ts        # BARREL PÚBLICO — 19 export statements (cross-module only)
```

**Métricas (medidas 2026-05-29):** 68 arquivos `.ts/.tsx` / 19 export-statements = **files-per-export 3.58** (era 0.85 — interface antes maior que implementação). Sub-barris são privados ao módulo: cross-module continua entrando **só** pelo barrel raiz. Imports internos usam caminho relativo curto (`./hooks/legacy`, `./components/kanban`, etc.).

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
- Display config: `usePipelineDisplayConfig`, `useAvailableSystemPipes`, `useEnabledSystemPipeTypes`, `useEnableSystemPipe`, `useTogglePipeVisibility`, `SYSTEM_PIPE_CATALOG`
- Exclusão de funil (qualquer espécie, por id — SCRUM-626/636): `usePipelineDeleteImpact`, `useDeletePipelineById` (`hooks/config/usePipelineDelete.ts`) + `DeletePipelineDialog` (impacto medido, bloqueio por cards invasores, substituto do funil padrão da org antes do delete)

> 🚨 **`pipeline_display_config` é o REGISTRO de quais funis de sistema a org tem** (migration `20270902000000`).
> Linha ausente = a org **não tem** aquele funil. Não há default e não há fallback: lista vazia é resposta legítima.
>
> Antes, quatro torneiras de auto-semeadura no caminho de LEITURA recriavam tudo, o que tornava a exclusão
> impossível — apagar as linhas e recarregar a página trazia o funil de volta. As quatro estão fechadas:
> `ensure_pipeline_display_config` (virou no-op), `create_default_pipelines` (consulta o registro),
> `buildFallbackStages` (gateada por `lerTiposHabilitados`; só render-only em erro/sem-org) e
> `ensureDefaultStagesInDb` (REMOVIDA — SCRUM-618: o seed é 100% server-side via
> `enable_system_pipeline` → `create_default_pipeline_stages`, migration `20270906003000`;
> funil habilitado sem etapa renderiza VAZIO, não fallback). Etapas da Carteira (resíduo
> `upsell_*`, fora de `PipelineType` desde SCRUM-618) são lidas pelo módulo carteira via
> `useCarteiraStages`.
>
> **Ao mexer aqui:** nunca reintroduza um default em memória para funil de sistema, e nunca semeie tipo que
> não esteja no registro. `tests/unit/hooks-sprint2-pipeline-stages.test.ts` trava os dois sentidos.
> Criar funil de sistema é ato explícito: RPC `enable_system_pipeline`.
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
- `PipelineListView` (`PipeTableView` morreu no flip da 637 — sem consumidor)
- `CreateOpportunityModal`, `ExportStageDialog`
- `StageWorkflowsBadge`, `StageWorkflowsBadgeWrapper`
- Helpers do filtro: `originLabels`, `ALL_ORIGIN_OPTIONS`, `countActiveFilters`

### Components — shared (configuração + dispatch)
- `PipeSettingsDialog`, `ManagePipelineStagesContent`, `ManagePipelineStagesModal`
- `FunnelIdentitySection` — identidade do funil (nome/ícone/cor, escreve em `pipelines` e sincroniza `display_name` do registro no sistema) + Zona de Perigo, na aba "Geral" dos DOIS diálogos de configurações (sistema e custom) desde SCRUM-636. Portão de exclusão: `pipeline.custom_delete`. A confirmação é o `DeletePipelineDialog` único (substituiu `DangerZoneSystemPipe`, demolido).
- `PipeDispatchRulesSection`, `PipeDistributionSection`

### Components — custom pipelines
- `CustomPipeSettingsDialog` (`CustomPipelineKanban` + `CustomPipeLeadCard` morreram na 637 — o board único é `FunilKanban` + `LeadCard`)
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
- `@/modules/pipelines/pages/CustomPipeline`
- `@/modules/pipelines/pages/FunisHub`

Pages NÃO são exportadas via `index.ts` — `App.tsx` faz deep-import para preservar code-splitting via `React.lazy()` + `lazyRetry`.

> `Negocios` **não existe mais**: a rota `/negocios` e a página saíram do `App.tsx` (ADR-0023 decisão 5 — eram o único leitor de `deals.pipeline_id`). O Negócio é lido pelos próprios funis e pela aba de Leads.

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

## Slice de migração

**Slice 5** — branch `feat/modularizacao/04-pipelines` (estimativa 6h impl + 1h dedup = 7h).

## Refs

- ADR: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Filtros do Kanban: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Filtros do Kanban.md`
- Pipe Confirmacao: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/06 — Features/Vendas/Pipe Confirmacao.md`
- Memory: `reference_pipe_views_compat.md`
- SPEC modularização: `.specs/features/modularizacao/SPEC.md`
- Slices roadmap: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/slices.md`
