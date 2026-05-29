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
} from "./hooks/usePipeWhatsapp";
export type {
  PipeWhatsapp,
  PipeWhatsappInsert,
  PipeWhatsappUpdate,
  PipeWhatsappStatus,
} from "./hooks/usePipeWhatsapp";

export {
  usePipeConfirmacao,
  useCreatePipeConfirmacao,
  useUpdatePipeConfirmacao,
  useDeletePipeConfirmacao,
} from "./hooks/usePipeConfirmacao";
export type {
  PipeConfirmacao,
  PipeConfirmacaoInsert,
  PipeConfirmacaoUpdate,
  PipeConfirmacaoStatus,
} from "./hooks/usePipeConfirmacao";

export {
  usePipePropostas,
  useCreatePipeProposta,
  useUpdatePipeProposta,
  useDeletePipeProposta,
} from "./hooks/usePipePropostas";
export type {
  PipeProposta,
  PipePropostaInsert,
  PipePropostaUpdate,
  PipePropostasStatus,
} from "./hooks/usePipePropostas";

// ── Hooks: pipe legacy — by leadId helpers + proposta items ──────────────
export { usePipeConfirmacaoByLeadId } from "./hooks/usePipeConfirmacaoByLeadId";
export type { PipeConfirmacaoRow } from "./hooks/usePipeConfirmacaoByLeadId";

export { usePipePropostaByLeadId } from "./hooks/usePipePropostaByLeadId";
export type { PipePropostaRow } from "./hooks/usePipePropostaByLeadId";

export {
  usePipePropostaItems,
  useCreatePipePropostaItem,
  useCreateManyPipePropostaItems,
  useUpdatePipePropostaItem,
  useDeletePipePropostaItem,
} from "./hooks/usePipePropostaItems";
export type {
  PipePropostaItem,
  PipePropostaItemInsert,
} from "./hooks/usePipePropostaItems";

// ── Hooks: pipeline modelo novo (pipeline_entries + pipeline_stages) ──────
export {
  usePipelines,
  usePipeline,
  usePipelineEntriesBySlug,
  useCreatePipelineEntry,
  useUpdatePipelineEntry,
  useMovePipelineEntry,
  useMigratePipeEntries,
} from "./hooks/usePipelines";
export type { Pipeline, PipelineEntry } from "./hooks/usePipelines";

export {
  usePipelineId,
  usePipelineEntries,
} from "./hooks/usePipelineEntries";

export {
  usePipelineStages,
  useAllPipelineStages,
  stagesToColumns,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  DEFAULT_STAGES,
} from "./hooks/usePipelineStages";
export type {
  PipelineType,
  PipelineStage,
  PipelineStageInsert,
} from "./hooks/usePipelineStages";

// ── Hooks: pipeline display config (per-org pipe visibility) ─────────────
export {
  usePipelineDisplayConfig,
  useHiddenDefaultPipes,
  useTogglePipeVisibility,
} from "./hooks/usePipelineDisplayConfig";
export type { PipelineDisplayConfig } from "./hooks/usePipelineDisplayConfig";

// ── Hooks: metrics ────────────────────────────────────────────────────────
export {
  usePipePropostasMetrics,
  usePipeConfirmacaoMetrics,
  usePipeWhatsappMetrics,
  computeConfirmacaoStats,
} from "./hooks/usePipeMetrics";
export type {
  PipePropostasMetrics,
  PipeConfirmacaoMetrics,
  PipeWhatsappMetrics,
  MetricsPeriod,
  DateRange,
  MetricsPeriodState,
} from "./hooks/usePipeMetrics";

// ── Hooks: dispatch + distribution rules ──────────────────────────────────
export {
  usePipeDispatchRules,
  usePipeDispatchRuleSteps,
  useCreatePipeDispatchRule,
  useUpdatePipeDispatchRule,
} from "./hooks/usePipeDispatchRules";
export type {
  PipeDispatchRule,
  PipeDispatchRuleStep,
  PipeDispatchRuleTriggerType,
  PipeDispatchRuleStepActionType,
  PipeDispatchRuleTimeoutAction,
  SdrAssignmentMode,
} from "./hooks/usePipeDispatchRules";

export {
  usePipeDistributionRule,
  useSavePipeDistribution,
} from "./hooks/usePipeDistribution";
export type {
  DistributionMode,
  PipeDistributionRule,
  PipeDistributionMember,
} from "./hooks/usePipeDistribution";

// ── Hooks: custom pipelines + temporary funnels ───────────────────────────
export {
  useCustomPipelines,
  usePermanentCustomFunnels,
  useTemporaryFunnels,
  TEMPORARY_FUNNEL_STAGES,
} from "./hooks/useCustomPipelines";
export type {
  CustomPipeline,
  CustomPipelineStage,
  CustomPipeEntry,
  LifecycleType,
  FunnelStatus,
  FunnelTemplateType,
} from "./hooks/useCustomPipelines";

export {
  usePipelineMembers,
  useAddPipelineMember,
  useUpdatePipelineMember,
  useRemovePipelineMember,
  useIncrementMemberAchieved,
} from "./hooks/useCustomPipelineMembers";
export type {
  MemberRole,
  CustomPipelineMember,
} from "./hooks/useCustomPipelineMembers";

// ── Hooks: prefetch (route-level perf optimization) ───────────────────────
export { usePrefetchPipes } from "./hooks/usePrefetchPipes";

// ── Components: kanban (drag-drop, list, table) ───────────────────────────
export { CreateOpportunityModal } from "./components/kanban/CreateOpportunityModal";
export { DraggableKanbanBoard } from "./components/kanban/DraggableKanbanBoard";
export type {
  DraggableItem,
  KanbanColumn,
} from "./components/kanban/DraggableKanbanBoard";
export { ExportStageDialog } from "./components/kanban/ExportStageDialog";
export { KanbanBoard } from "./components/kanban/KanbanBoard";
export { KanbanCard } from "./components/kanban/KanbanCard";
export type { Lead as KanbanCardLead, LeadTag as KanbanCardLeadTag } from "./components/kanban/KanbanCard";
export {
  KanbanFilterPanel,
  originLabels,
  ALL_ORIGIN_OPTIONS,
  countActiveFilters,
} from "./components/kanban/KanbanFilterPanel";
export type {
  FilterSectionConfig,
  KanbanFilterPanelProps,
} from "./components/kanban/KanbanFilterPanel";
export { PipelineListView } from "./components/kanban/PipelineListView";
export type { PipelineListViewProps } from "./components/kanban/PipelineListView";
export { PipeTableView } from "./components/kanban/PipeTableView";
export { StageWorkflowsBadge } from "./components/kanban/StageWorkflowsBadge";
export { StageWorkflowsBadgeWrapper } from "./components/kanban/StageWorkflowsBadgeWrapper";

// ── Components: shared (Ghost, MetricsPeriod, Manage/Dispatch/Distribution/Settings)
export { GhostLeadsBanner } from "./components/shared/GhostLeadsBanner";
export {
  ManagePipelineStagesContent,
  ManagePipelineStagesModal,
} from "./components/shared/ManagePipelineStagesModal";
export { MetricsPeriodSelector } from "./components/shared/MetricsPeriodSelector";
export { PipeDispatchRulesSection } from "./components/shared/PipeDispatchRulesSection";
export { PipeDistributionSection } from "./components/shared/PipeDistributionSection";
export { PipeSettingsDialog } from "./components/shared/PipeSettingsDialog";

// ── Components: custom pipelines ──────────────────────────────────────────
export { AddLeadToPipeModal } from "./components/custom/AddLeadToPipeModal";
export {
  CreatePipelineModal,
  PIPELINE_COLORS,
  PIPELINE_ICONS,
} from "./components/custom/CreatePipelineModal";
export { CustomPipeLeadCard } from "./components/custom/CustomPipeLeadCard";
export { CustomPipelineKanban } from "./components/custom/CustomPipelineKanban";
export { CustomPipeSettingsDialog } from "./components/custom/CustomPipeSettingsDialog";
export { ImportCustomPipelineContent } from "./components/custom/ImportCustomPipelineContent";

// ── Components: funis (creators) ──────────────────────────────────────────
export { CreateFunilOuCampanhaModal } from "./components/funis/CreateFunilOuCampanhaModal";
export { CreateTemporaryFunnelModal } from "./components/funis/CreateTemporaryFunnelModal";

// ── Components: legacy (confirmacao standalone — pre-modelo-novo) ─────────
export { AddMeetingModal } from "./components/legacy/confirmacao/AddMeetingModal";
// CompareceuModal movido para `leads` (inversão F7) — re-exportado dali para
// manter a API pública de pipelines estável p/ call sites legados.
export { CompareceuModal } from "@/modules/leads";
export { ConfirmacaoCard } from "./components/legacy/confirmacao/ConfirmacaoCard";
export { ConfirmacaoDetailModal } from "./components/legacy/confirmacao/ConfirmacaoDetailModal";
export { ConfirmacaoStats } from "./components/legacy/confirmacao/ConfirmacaoStats";
export { MeetingCountdown } from "./components/legacy/confirmacao/MeetingCountdown";
export { MeetingTimeline } from "./components/legacy/confirmacao/MeetingTimeline";
export { QuickAddDailyAction } from "./components/legacy/confirmacao/QuickAddDailyAction";
export { RescheduleModal } from "./components/legacy/confirmacao/RescheduleModal";
export type { ReschedulingMode } from "./components/legacy/confirmacao/RescheduleModal";
