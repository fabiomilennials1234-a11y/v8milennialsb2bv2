/**
 * Module copilot — API pública.
 *
 * Public surface do bounded context. Tudo cross-module passa por aqui.
 * Internals (subpastas) são privados — ESLint `boundaries` impede import direto.
 *
 * Status: Active (populado em slice 7 — feat/modularizacao/06-copilot).
 * Ver `./CLAUDE.md` para escopo (agentes IA, Human Pause, Oraculo Comercial),
 * entidade primária (Copilot Agent), e áreas frágeis 🔴 (agent-message turn,
 * loop detection, RAG). Sub-CLAUDE.md raiz: `supabase/functions/agent-message/`.
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-6).
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────────────────────────────

// Agent CRUD
export {
  useCopilotAgents,
  useCopilotAgent,
  useDefaultCopilotAgent,
  useCreateCopilotAgent,
  useUpdateCopilotAgent,
  useDeleteCopilotAgent,
  useToggleCopilotAgent,
  useSetDefaultCopilotAgent,
  useUpdateCopilotAgentPipeline,
  type UpdatePipelinePayload,
} from "./hooks/useCopilotAgents";

// Agent docs / audios
export {
  useAgentDocuments,
  useUploadAgentDocument,
  useDeleteAgentDocument,
  useReprocessDocument,
  fetchAgentDocumentSummaries,
  type AgentDocument,
} from "./hooks/useAgentDocuments";

export {
  useCopilotAgentAudios,
  useUploadCopilotAgentAudio,
  useDeleteCopilotAgentAudio,
  useUpdateCopilotAgentAudio,
} from "./hooks/useCopilotAgentAudios";

// Agent rules / metrics
export {
  useAgentFollowupRules,
  useCreateFollowupRule,
  useUpdateFollowupRule,
  useDeleteFollowupRule,
  useToggleFollowupRule,
  useReorderFollowupRules,
  followupRuleToDB,
} from "./hooks/useAgentFollowupRules";

export {
  useAgentKanbanRules,
  useUpsertKanbanRules,
  type KanbanRuleForm,
} from "./hooks/useAgentKanbanRules";

export {
  useAgentMetrics,
  useAgentPendingTasks,
  type AgentMetrics,
  type AgentMetricsTrend,
  type AgentMetricsWithTrends,
} from "./hooks/useAgentMetrics";

// Pause + toggle (suite — 3 hooks, 3 responsabilidades)
export {
  useCopilotPause,
  type CopilotPauseState,
} from "./hooks/useCopilotPause";

export {
  useCopilotToggle,
  useCopilotToggleStatus,
  useCopilotToggleMutation,
  copilotToggleQueryKey,
  type CopilotToggleStatus,
} from "./hooks/useCopilotToggle";

export {
  useCopilotToggleAudit,
  useCopilotToggleDrift,
  type CopilotToggleAuditEntry,
  type CopilotToggleAuditFilters,
  type CopilotDriftRow,
} from "./hooks/useCopilotToggleAudit";

export { useCopilotToggleRealtime } from "./hooks/useCopilotToggleRealtime";

// Prompt builder + analysis + reasoning
export {
  useCopilotPromptBuilder,
  generatePrompt,
  saveCopilotSystemPrompt,
  regenerateAndSavePrompt,
  computePromptHash,
  type DocumentSummary,
} from "./hooks/useCopilotPromptBuilder";

export {
  useCopilotReasoning,
  type CopilotReasoningRow,
  type CopilotReasoningFilters,
} from "./hooks/useCopilotReasoning";

export {
  usePromptAnalysisHistory,
  useRunPromptAnalysis,
  useAcceptSuggestion,
  useDismissSuggestion,
  type PromptSuggestion,
  type PromptAnalysis,
} from "./hooks/usePromptAnalysis";

export { useQuickPromptAnalysis } from "./hooks/useQuickPromptAnalysis";

// Subscription + Oraculo + tool logs
export { useCopilotSubscription } from "./hooks/useCopilotSubscription";

export {
  useOraculoChat,
  type ChatMessage as OraculoChatMessage,
} from "./hooks/useOraculoChat";

export {
  useToolCallLogs,
  type ToolCallLog,
} from "./hooks/useToolCallLogs";

// ────────────────────────────────────────────────────────────────────────
// Components
// ────────────────────────────────────────────────────────────────────────

export { AgentFollowupRulesTab } from "./components/AgentFollowupRulesTab";
export { FollowupSituationsTab } from "./components/FollowupSituationsTab";
export {
  useFollowupSituationConfig,
  useUpsertFollowupSituationConfig,
  type FollowupSituationConfig,
  type SituationId as FollowupSituationId,
} from "./hooks/useFollowupSituationConfig";
export { AgentKanbanRulesTab } from "./components/AgentKanbanRulesTab";
export { AgentMetricsTab } from "./components/AgentMetricsTab";
export { AgentTasksTab } from "./components/AgentTasksTab";
export { PromptPreviewSheet } from "./components/PromptPreviewSheet";
export {
  BehaviorWindowsEditor,
  createDefaultBehaviorWindow,
  type BehaviorEnforcement,
  type BehaviorDayKey,
  type BehaviorWindow,
} from "./components/BehaviorWindowsEditor";

export { CopilotPlayground } from "./components/playground/CopilotPlayground";

// Copilot v2 wizard (Slice 8) — typed-slot authoring surface (replaces the
// Playground for v2 agents). Hook + contract for the config save/read.
export { CopilotV2Wizard, type CopilotV2WizardProps } from "./components/v2-wizard/CopilotV2Wizard";
export { useCopilotV2Config, useSaveCopilotV2Config } from "./hooks/useCopilotV2Config";
export * as copilotV2Config from "./lib/copilot-v2-config";

// Copilot v2 wizard route (Slice 12b) — get-or-create agent list + v1→v2 prefill.
export {
  useCopilotV2Agents,
  useCreateCopilotV2Agent,
  usePrefillCandidates,
  usePrefillFromV1,
  type CopilotV2AgentRow,
  type PrefillCandidate,
  type PrefillSeed,
} from "./hooks/useCopilotV2Agents";

// Copilot v2 simulator + eval-suite (Slice 9) — dry-run authoring test surface.
export { SimulatorPanel } from "./components/v2-wizard/SimulatorPanel";
export { useSimulateTurn, useRunEvalSuite } from "./hooks/useCopilotV2Simulator";

// Copilot v2 cost governance + kill-switch (W10) — org-wide pause banner + control.
export { CopilotOrgKillSwitch } from "./components/governance/CopilotOrgKillSwitch";
export {
  useCopilotV2OrgPause,
  ORG_PAUSE_REASON_LABEL,
  type OrgPauseReason,
} from "./hooks/useCopilotV2OrgPause";
