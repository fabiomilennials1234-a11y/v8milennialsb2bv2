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
 * ⚠️ Compatibilidade em demolição:
 * - Hooks `usePipe{Whatsapp,Confirmacao,Propostas}*` ainda leem views legacy.
 * - Escrita frontend nas seis views é proibida desde SCRUM-673; as mutações
 *   passam pelas funções compartilhadas e chegam ao modelo canônico.
 * - Leitores restantes migram na SCRUM-639 antes do DROP das views.
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
// Funis da org COM o nome que ela usa. Prefira este a `usePipelines` em
// qualquer lugar que desenhe o funil na tela — `pipelines.name` é o seed
// congelado para funil de sistema (SCRUM-608).
export { useFunisDaOrg, useFunisAtivosDaOrg } from "./hooks/model/useFunisDaOrg";
export type { FunilDaOrg } from "./hooks/model/useFunisDaOrg";
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
  useEtapasDoFunil,
  stagesToColumns,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  FALLBACK_STAGES,
  useAllPipelineStageOptions,
  usePipelineStageOptions,
  getPipelineTypeName,
  useStageLeadIds,
  useFilteredLeadIds,
  useCustomFilteredLeadIds,
  useAllFunnelsLeadIds,
  // SCRUM-633 — blocos por pipeline_id (paridade W4)
  usePipelineLeadIds,
  useStagesDoFunil,
  useFunilFilters,
  createInitialFunilFilterState,
} from "./hooks/model";
export type {
  Pipeline,
  PipelineEntry,
  PipelineType,
  PipelineStage,
  PipelineStageInsert,
  FilteredLeadIdsParams,
  CustomFilteredLeadIdsParams,
  AllFunnelsLeadIdsParams,
  PipelineLeadIdsParams,
  StageDoFunil,
  FunilFilterState,
  FunilFiltersController,
} from "./hooks/model";

// ── Hooks: display config + metrics + dispatch + distribution ─────────────
export {
  usePipelineDisplayConfig,
  // `useHiddenDefaultPipes` virou `useAvailableSystemPipes` (20270902000000):
  // com a auto-semeadura morta, "não ter a linha" é o estado normal de org
  // nova, então a lista de ativáveis não pode ser só `is_visible = false`.
  useAvailableSystemPipes,
  useEnabledSystemPipeTypes,
  useEnableSystemPipe,
  useTogglePipeVisibility,
  SYSTEM_PIPE_CATALOG,
  usePipePropostasMetrics,
  usePipeConfirmacaoMetrics,
  usePipeWhatsappMetrics,
  useFunilMetrics,
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
  SystemPipeType,
  PipePropostasMetrics,
  PipeConfirmacaoMetrics,
  PipeWhatsappMetrics,
  FunilMetrics,
  FunilGenericMetrics,
  FunilMetricsKind,
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
  useCreateCustomPipeline,
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
  ManagePipelineStagesContent,
  ManagePipelineStagesModal,
  PipeDispatchRulesSection,
  PipeDistributionSection,
  PipeSettingsDialog,
  DeletePipelineDialog,
  FunnelIdentitySection,
  FunnelIdentityDialog,
} from "./components/shared";

// ── Components: custom pipelines ──────────────────────────────────────────
export {
  AddLeadToPipeModal,
  CreatePipelineModal,
  PIPELINE_COLORS,
  PIPELINE_ICONS,
  CustomPipeSettingsDialog,
  ImportCustomPipelineContent,
} from "./components/custom";

// ── Components: funis (creators) ──────────────────────────────────────────
export {
  CreateFunilOuCampanhaModal,
  CreateTemporaryFunnelModal,
  FunnelActionsMenu,
} from "./components/funis";

// ── Components: disparo (Quick Blast wizard — mass send) ──────────────────
// Cross-module surface so carteira can mount the unified wizard via the public
// barrel (module→module allowed by `boundaries`); deep-importing the private
// `./components/disparo` sub-barrel from outside would trip `boundaries/no-private`.
// In-module call sites (funnel pages) keep importing the sub-barrel directly.
export { DisparoWizard } from "./components/disparo";
export type {
  DisparoContext,
  DisparoBoardFilter,
  DisparoSource,
  SystemPipelineType,
} from "./components/disparo";
// Audience CONDITIONS controls (tags / qualification / origin) — shared with the
// standalone Disparos wizard in `campaigns` (#902). Pure-ish UI + option dicts.
export {
  AudienceConditionsControls,
  EMPTY_CONDITIONS,
  TIER_OPTIONS,
  ORIGIN_OPTIONS,
} from "./components/disparo";
export type { AudienceConditions } from "./components/disparo";

// ── Components: legacy (confirmacao standalone — pre-modelo-novo) ─────────
export {
  AddMeetingModal,
  ConfirmacaoCard,
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

// ── Stage Role (#990/#991 — ADR-0017 §1) ──────────────────────────────────
// Enum governado de etapa + classifier determinístico (twin do core Deno) +
// metadados de apresentação. Consumidos pelo modal de etapa (interno) e pela
// tela master de revisão won/lost em `identity` (cross-module via barrel).
export {
  classifyStageRole,
  classifyStageNameDeterministic,
  decideStageRoleAction,
  normalizeStageName,
} from "./lib/stage-role-classifier";
export type { StageRoleSuggestion, StageRoleAction } from "./lib/stage-role-classifier";
export { STAGE_ROLES, STAGE_ROLE_META, STAGE_ROLE_SOURCE_LABEL } from "./lib/stage-role";
export type { StageRoleMeta } from "./lib/stage-role";
export type {
  StageRole,
  SuggestableStageRole,
  StageRoleSuggestionSource,
} from "@/contracts/pipe";

// ── Mover negócio (ADR-0023 decisão 4: avançar é MOVER, não copiar) ───────
// Exportado pela API pública porque o drawer do lead (módulo `leads`) também faz
// a transição compareceu → Orçamentos, e cross-module só entra pelo barrel.
export { moverNegocio, invalidateAfterMove } from "./lib/moverNegocio";
export type { MoverNegocioParams } from "./lib/moverNegocio";

// ── Identidade visual do funil (SCRUM-637) ────────────────────────────────
// Cor/ícone de QUALQUER funil vêm de `pipelines`; a lateral (platform) resolve
// o ícone por aqui — mapa canônico único, sem cópias por tela.
export { FUNIL_ICON_MAP, funilIcon } from "./lib/funil-icons";
