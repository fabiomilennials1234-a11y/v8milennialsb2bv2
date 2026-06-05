/**
 * Module pipelines — API pública.
 *
 * Tudo que outros módulos consomem deve estar exportado aqui.
 * Internals (subpastas, hooks privados, componentes de detalhe) são privados —
 * ESLint `boundaries` impede import direto de fora.
 *
 * Boundary enforcement: warn agora (slice 1), error em slice 17.
 * Pages NÃO são exportadas daqui — App.tsx faz deep-import via
 * `@/modules/pipelines/pages/X` para preservar code-splitting via React.lazy().
 *
 * Ver `./CLAUDE.md` deste módulo para escopo, áreas frágeis e dual model legacy/novo.
 *
 * ── Organização interna (slice 7.3-bis: re-deepen) ────────────────────────
 * Hooks agrupados por domínio em sub-pastas com sub-barris:
 *   - `hooks/legacy/`  → views `pipe_*` (status=stage_key slug)  → `usePipe*`
 *   - `hooks/model/`   → `pipeline_entries`/`pipeline_stages`     → `usePipeline*`
 *   - `hooks/config/`  → display config, métricas, dispatch, distribution, loss
 *   - `hooks/custom/`  → custom pipelines + members
 *   - `hooks/perf/`    → prefetch
 * Components agrupados em sub-barris por pasta (`kanban`, `shared`, `custom`,
 * `funis`, `legacy/confirmacao`). Os paths legados `hooks/useX` permanecem como
 * shims de re-export para não quebrar deep-imports externos.
 *
 * ⚠️ Dual model crítico:
 * - Hooks `usePipe{Whatsapp,Confirmacao,Propostas}*` operam **views legacy** `pipe_*`
 *   (coluna `status` = stage_key slug)
 * - Hooks `usePipeline{s,Entries,Stages}*` operam **modelo novo** `pipeline_entries`
 *   (coluna `stage_id` uuid)
 * - NÃO unificar agora — cleanup futuro (out-of-scope slice 5)
 *
 * Realtime: subscriptions em `pipeline_entries`, NUNCA em `pipe_*` views.
 */

// ── PipeOpsProvider: inversão de dependência leads↔pipelines (arch F7) ─────
// Monta-se no App acima das rotas; injeta a impl de PipeOpsPort (definido em
// leads) via context. Único ponto onde pipelines→leads é intencional.
export { PipeOpsProvider } from "./PipeOpsProvider";

// ── Hooks: pipe legacy (views pipe_whatsapp/confirmacao/propostas) ────────
export {
  usePipeWhatsapp,
  useCreatePipeWhatsapp,
  useUpdatePipeWhatsapp,
  useDeletePipeWhatsapp,
  usePipeConfirmacao,
  useCreatePipeConfirmacao,
  useUpdatePipeConfirmacao,
  useDeletePipeConfirmacao,
  usePipePropostas,
  useCreatePipeProposta,
  useUpdatePipeProposta,
  useDeletePipeProposta,
  usePipeConfirmacaoByLeadId,
  usePipePropostaByLeadId,
  usePipePropostaItems,
  useCreatePipePropostaItem,
  useCreateManyPipePropostaItems,
  useUpdatePipePropostaItem,
  useDeletePipePropostaItem,
} from "./hooks/legacy";
// statusColumns por pipe — nomes distintos (colisão no sub-barrel `legacy`, cada
// hook exporta `statusColumns` com valores diferentes). Reexporta-se aqui com
// nome explícito vindo de `@/contracts/pipe` (fonte canônica).
export {
  whatsappStatusColumns,
  confirmacaoStatusColumns,
  propostasStatusColumns,
} from "@/contracts/pipe";
export type {
  PipeWhatsapp,
  PipeWhatsappInsert,
  PipeWhatsappUpdate,
  PipeWhatsappStatus,
  PipeConfirmacao,
  PipeConfirmacaoInsert,
  PipeConfirmacaoUpdate,
  PipeConfirmacaoStatus,
  PipeProposta,
  PipePropostaInsert,
  PipePropostaUpdate,
  PipePropostasStatus,
  PipeConfirmacaoRow,
  PipePropostaRow,
  PipePropostaItem,
  PipePropostaItemInsert,
} from "./hooks/legacy";

// ── Hooks: pipeline modelo novo (pipeline_entries + pipeline_stages) ──────
export {
  usePipelines,
  usePipeline,
  usePipelineEntriesBySlug,
  useCreatePipelineEntry,
  useUpdatePipelineEntry,
  useMovePipelineEntry,
  useMigratePipeEntries,
  usePipelineId,
  usePipelineEntries,
  findOrCreatePipelineEntry,
  usePipelineStages,
  useAllPipelineStages,
  stagesToColumns,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  DEFAULT_STAGES,
  useAllPipelineStageOptions,
  usePipelineStageOptions,
  getPipelineTypeName,
  useStageLeadIds,
  useFilteredLeadIds,
  useCustomFilteredLeadIds,
} from "./hooks/model";
export type {
  Pipeline,
  PipelineEntry,
  PipelineType,
  PipelineStage,
  PipelineStageInsert,
  FilteredLeadIdsParams,
  CustomFilteredLeadIdsParams,
} from "./hooks/model";

// ── Hooks: display config + metrics + dispatch + distribution ─────────────
export {
  usePipelineDisplayConfig,
  useHiddenDefaultPipes,
  useTogglePipeVisibility,
  usePipePropostasMetrics,
  usePipeConfirmacaoMetrics,
  usePipeWhatsappMetrics,
  computeConfirmacaoStats,
  usePipeDispatchRules,
  usePipeDispatchRuleSteps,
  useCreatePipeDispatchRule,
  useUpdatePipeDispatchRule,
  usePipeDistributionRule,
  useSavePipeDistribution,
  useLossReasons,
} from "./hooks/config";
export type {
  PipelineDisplayConfig,
  PipePropostasMetrics,
  PipeConfirmacaoMetrics,
  PipeWhatsappMetrics,
  MetricsPeriod,
  DateRange,
  MetricsPeriodState,
  PipeDispatchRule,
  PipeDispatchRuleStep,
  PipeDispatchRuleTriggerType,
  PipeDispatchRuleStepActionType,
  PipeDispatchRuleTimeoutAction,
  SdrAssignmentMode,
  DistributionMode,
  PipeDistributionRule,
  PipeDistributionMember,
} from "./hooks/config";

// ── Hooks: custom pipelines + temporary funnels + members ─────────────────
export {
  useCustomPipelines,
  useCustomPipelineStages,
  useAddLeadToCustomPipe,
  useMoveLeadInCustomPipe,
  useRemoveLeadFromCustomPipe,
  usePermanentCustomFunnels,
  useTemporaryFunnels,
  useActiveTemporaryFunnels,
  TEMPORARY_FUNNEL_STAGES,
  usePipelineMembers,
  useAddPipelineMember,
  useUpdatePipelineMember,
  useRemovePipelineMember,
  useIncrementMemberAchieved,
} from "./hooks/custom";
export type {
  CustomPipeline,
  CustomPipelineStage,
  CustomPipeEntry,
  LifecycleType,
  FunnelStatus,
  FunnelTemplateType,
  MemberRole,
  CustomPipelineMember,
} from "./hooks/custom";

// ── Hooks: prefetch (route-level perf optimization) ───────────────────────
export { usePrefetchPipes } from "./hooks/perf";

// ── Components: kanban (drag-drop, list, table) ───────────────────────────
export {
  CreateOpportunityModal,
  DraggableKanbanBoard,
  ExportStageDialog,
  KanbanBoard,
  KanbanCard,
  KanbanFilterPanel,
  originLabels,
  ALL_ORIGIN_OPTIONS,
  countActiveFilters,
  PipelineListView,
  PipeTableView,
  StageWorkflowsBadge,
  StageWorkflowsBadgeWrapper,
} from "./components/kanban";
export type {
  DraggableItem,
  KanbanColumn,
  KanbanCardLead,
  KanbanCardLeadTag,
  FilterSectionConfig,
  KanbanFilterPanelProps,
  PipelineListViewProps,
} from "./components/kanban";

// ── Components: shared (Ghost, MetricsPeriod, Manage/Dispatch/Distribution/Settings)
export {
  GhostLeadsBanner,
  ManagePipelineStagesContent,
  ManagePipelineStagesModal,
  MetricsPeriodSelector,
  PipeDispatchRulesSection,
  PipeDistributionSection,
  PipeSettingsDialog,
} from "./components/shared";

// ── Components: custom pipelines ──────────────────────────────────────────
export {
  AddLeadToPipeModal,
  CreatePipelineModal,
  PIPELINE_COLORS,
  PIPELINE_ICONS,
  CustomPipeLeadCard,
  CustomPipelineKanban,
  CustomPipeSettingsDialog,
  ImportCustomPipelineContent,
} from "./components/custom";

// ── Components: funis (creators) ──────────────────────────────────────────
export {
  CreateFunilOuCampanhaModal,
  CreateTemporaryFunnelModal,
} from "./components/funis";

// ── Components: legacy (confirmacao standalone — pre-modelo-novo) ─────────
export {
  AddMeetingModal,
  ConfirmacaoCard,
  ConfirmacaoDetailModal,
  ConfirmacaoStats,
  MeetingCountdown,
  MeetingTimeline,
  QuickAddDailyAction,
  RescheduleModal,
} from "./components/legacy/confirmacao";
export type { ReschedulingMode } from "./components/legacy/confirmacao";
// CompareceuModal movido para `leads` (inversão F7) — re-exportado dali para
// manter a API pública de pipelines estável p/ call sites legados.
export { CompareceuModal } from "@/modules/leads";
