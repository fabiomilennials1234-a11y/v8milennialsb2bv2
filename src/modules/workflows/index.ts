/**
 * Module workflows — API pública.
 *
 * Public surface do bounded context. Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * Status: Active (populado em slice 8 — feat/modularizacao/07-workflows).
 * Ver `./CLAUDE.md` para escopo (Workflow DAG, triggers, conditions, action
 * handlers, executor), áreas frágeis (dedup obrigatório, actions vs
 * action-handlers, wait_response / wait_business_window).
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-7).
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Workflow CRUD + executions
// ────────────────────────────────────────────────────────────────────────

export {
  useWorkflows,
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useToggleWorkflow,
  useWorkflowExecutions,
  useWorkflowExecutionSteps,
  useRetryWorkflowExecution,
  useWorkflowStats,
} from "./hooks/useWorkflows";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Analytics
// ────────────────────────────────────────────────────────────────────────

export {
  useWorkflowNodeStats,
  type WorkflowNodeStats,
} from "./hooks/useWorkflowAnalytics";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Portability (export/import)
// ────────────────────────────────────────────────────────────────────────

export {
  useExportWorkflow,
  useImportWorkflow,
} from "./hooks/useWorkflowPortability";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Templates
// ────────────────────────────────────────────────────────────────────────

export {
  useWorkflowTemplates,
  useCloneWorkflowTemplate,
  type WorkflowTemplate,
} from "./hooks/useWorkflowTemplates";

// Templates-base de sistema por funil (auto-gerados das pastas Funil A/ e Funil B/).
// Mudaram de casa: viraram `@/contracts/workflows/funnel-templates`. `identity`
// os consome para semear automações ao criar uma org, e importá-los pelo barril
// daqui obrigava identity a arrastar os hooks de workflows — que por sua vez
// dependem de identity, fechando o ciclo. Não reexportamos de propósito.

// ────────────────────────────────────────────────────────────────────────
// Hooks — Stage <-> Workflow bindings (cross-module from pipelines/campaigns)
// ────────────────────────────────────────────────────────────────────────

export {
  useStageWorkflows,
  useStageWorkflowCounts,
  useCustomPipeStageWorkflows,
  useCustomPipeWorkflowCounts,
  useCampaignStageWorkflows,
  useCampaignWorkflowCounts,
} from "./hooks/useStageWorkflows";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Automation Health (dashboard master)
// ────────────────────────────────────────────────────────────────────────

export {
  useAutomationHealth,
  useDeadLetterJobs,
  useFailedWorkflows,
  useStuckActions,
  useCircuitBrokenWebhooks,
  useSystemAlerts,
  useResolveAlert,
  useReprocessJob,
  useOrgsCopilotEngine,
  useToggleCopilotEngine,
  useAuditLog,
  type HealthStats,
  type SystemAlert,
  type UseSystemAlertsOpts,
  type ReprocessType,
  type OrgEngineRow,
  type AuditLogFilter,
} from "./hooks/useAutomationHealth";

export {
  useWorkflowLagByOrg,
  useWorkflowLagByWorkflow,
  useWorkflowPoolState,
  formatLag,
  lagSeverity,
} from "./hooks/useWorkflowLag";
export type { LagByOrg, LagByWorkflow, PoolState } from "./hooks/useWorkflowLag";

// ────────────────────────────────────────────────────────────────────────
// Server-side trigger (follow-up automation — chamada de pipelines/campaigns)
// ────────────────────────────────────────────────────────────────────────

export { triggerFollowUpAutomation } from "./hooks/useAutoFollowUp";
