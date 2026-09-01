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
  useUpdateAgentDocument,
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

// ────────────────────────────────────────────────────────────────────────
// Oráculo Comercial (SCRUM-594) — domínio próprio, não um tipo de agente
// Copilot (ADR-0032 §1). A página não é re-exportada: App.tsx faz deep-import
// via React.lazy, como as demais.
// ────────────────────────────────────────────────────────────────────────
export { useOraculoTurno, type OraculoMensagem } from "./hooks/useOraculoTurno";
// A conversa em coluna estreita. O painel da lateral a monta por caminho
// fundo, com `lazy`, para não puxar este barril inteiro no pedaço da lateral.
export { OraculoConversa } from "./components/oraculo/OraculoConversa";
export {
  useOraculoConversas,
  useOraculoTurnos,
  type OraculoConversaResumo,
} from "./hooks/useOraculoConversas";
