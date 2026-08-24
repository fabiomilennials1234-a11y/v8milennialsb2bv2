/**
 * Module campaigns — API pública.
 *
 * Public surface do bounded context. Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * Status: Active (populado em slice 9 — feat/modularizacao/08-campaigns).
 * Ver `./CLAUDE.md` para escopo (Campaign + Mass Send + Sequence + Templates),
 * áreas frágeis (mass-send rate limit, sequence delays, dispatch queue).
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-8).
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Campanhas CRUD + stages + members + leads
// ────────────────────────────────────────────────────────────────────────

export {
  // Constants + helpers de objetivo
  OBJECTIVE_TARGET_MAP,
  OBJECTIVE_LABELS,
  OBJECTIVE_DESCRIPTIONS,
  OBJECTIVE_METRIC_LABELS,
  OBJECTIVE_SUCCESS_STAGE_LABELS,
  OBJECTIVE_DEFAULT_STAGES,
  getObjectiveMetricLabel,
  getObjectiveSuccessStageLabel,
  resolveExtractionTarget,
  // Campanha CRUD
  useCampanhas,
  useCampanha,
  useCreateCampanha,
  useUpdateCampanha,
  useDeleteCampanha,
  useUpdateCampanhaInvestimento,
  useUpdateCampanhaMktConfig,
  // Stages
  useCampanhaStages,
  useAllCampanhaStages,
  useCreateCampanhaStage,
  useUpdateCampanhaStage,
  useDeleteCampanhaStage,
  useReorderCampanhaStages,
  // Members
  useCampanhaMembers,
  useUpdateCampanhaMember,
  // Leads na campanha
  useCampanhaLeads,
  useAddCampanhaLead,
  useUpdateCampanhaLead,
  useDeleteCampanhaLead,
  // Viewers
  useCampanhaViewers,
  useAddCampanhaViewer,
  useRemoveCampanhaViewer,
  // Pipe automations
  useCampanhaPipeAutomations,
  useCreateCampanhaPipeAutomation,
  useDeleteCampanhaPipeAutomation,
  // Dispatch rules
  useCampanhaDispatchRules,
  useCampanhaDispatchRuleSteps,
  useCreateCampanhaDispatchRule,
  useUpdateCampanhaDispatchRule,
  useDeleteCampanhaDispatchRule,
  useCreateCampanhaDispatchRuleStep,
  useUpdateCampanhaDispatchRuleStep,
  useDeleteCampanhaDispatchRuleStep,
  // Extract lead → pipe
  useExtractLeadToPipe,
} from "./hooks/useCampanhas";

export type {
  CampaignObjective,
  TargetPipe,
  CampaignType,
  AutoConfig,
  LeadDistributionMode,
  Campanha,
  CampanhaStage,
  CampanhaMemberRole,
  CampanhaMember,
  CampanhaLead,
  CampanhaInsert,
  CampanhaStageInsert,
  CampanhaPipeAutomationTarget,
  CampanhaPipeAutomation,
  CampanhaDispatchRuleTriggerType,
  CampanhaDispatchRuleStepActionType,
  CampanhaDispatchRuleTimeoutAction,
  SdrAssignmentMode,
  CampanhaDispatchRule,
  CampanhaDispatchRuleStep,
  CampanhaViewer,
  ExtractLeadToPipeTarget,
} from "./hooks/useCampanhas";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Campaign templates + dispatch batches
// ────────────────────────────────────────────────────────────────────────

export {
  TEMPLATE_VARIABLES,
  getTimeBasedVariables,
  replaceVariablesWithExamples,
  replaceVariablesWithLeadData,
  useCampaignTemplates,
  useCampaignTemplatesByType,
  useCampaignTemplate,
  useCreateCampaignTemplate,
  useUpdateCampaignTemplate,
  useDeleteCampaignTemplate,
  useCampanhaTemplates,
  useAddTemplateToCampanha,
  useRemoveTemplateFromCampanha,
  useDispatchBatches,
  useCreateDispatchBatch,
  useCancelDispatchBatch,
  useDispatchLog,
  useDispatchStats,
} from "./hooks/useCampaignTemplates";

export type {
  CampaignTemplateMessageType,
  CampaignTemplate,
  CampaignTemplateInsert,
  CampanhaTemplate,
  DispatchBatch,
  LeadFilter,
  DispatchBatchInsert,
} from "./hooks/useCampaignTemplates";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Mass Send (Uazapi /sender/* one-shot dispatch)
// ────────────────────────────────────────────────────────────────────────

export {
  useMassSendJobs,
  useCreateMassSend,
  useControlMassSend,
  useRefreshMassSendStatus,
} from "./hooks/useMassSendJobs";

export type { UazapiSenderJob } from "./hooks/useMassSendJobs";

// ── Blast Plans (auto-batched Mass Send — ADR-0003 / #707) ────────────────
export {
  useCreateBlastPlan,
  useBlastPlans,
  useBlastPlanProgress,
  useBlastPlanControl,
} from "./hooks/useBlastPlans";
export type {
  BlastPlan,
  BlastPlanStatus,
  BlastPlanLotBreakdown,
  CreateBlastPlanInput,
  CreateBlastPlanResult,
  BlastPlanProgress,
  BlastPlanAction,
} from "./hooks/useBlastPlans";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Dispatch queue (cross-module: pipelines + campaigns)
// ────────────────────────────────────────────────────────────────────────

export {
  useCampaignQueueItems,
  usePipeQueueItems,
  useRetryDispatchItems,
} from "./hooks/useDispatchQueueItems";

export type { QueueItem } from "./hooks/useDispatchQueueItems";

// ────────────────────────────────────────────────────────────────────────
// Disparo — o módulo ÚNICO de números, com regime (#1722)
// ────────────────────────────────────────────────────────────────────────
// Público por necessidade: o Disparo Rápido vive em `leads` e precisa OFERECER
// o mesmo conjunto que o wizard. Duas telas, uma decisão (ADR-0028 §6).

export {
  instancesToNumbers,
  isBlastableInstance,
  isConnectedInstance,
  regimeDaInstancia,
  rotuloDaInstancia,
  NEW_NUMBER_WINDOW_DAYS,
} from "./lib/disparo-numbers";

export type {
  InstanceLike,
  DisparoNumber,
  RegimeDeDisparo,
} from "./lib/disparo-numbers";
