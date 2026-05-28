# Module — copilot

**Status:** 🟢 Active (slice 7 + cleanup longtail slice 16 — 2026-05-28). Backend: doc-only mapping (slice 15).
**BC:** copilot
**Entidade primária:** Copilot Agent + Human Pause + Oraculo Comercial
**Owner:** IA / produto

## Escopo

Agentes IA que conversam com leads via canais (WhatsApp, Meta). Tipos:
- **Qualificador** — qualifica lead, agenda discovery
- **SDR** — sales development, follow-up cadence
- **Followup** — re-engagement de leads frios
- **Agendador** — agenda reunião direto
- **Prospectador** — outbound cold
- **Custom** — agente customizado pelo CTO da org

Inclui:
- Configuração de agente (personalidade, capabilities, kanban rules, business context)
- Conversação multi-turn (`conversation_messages`)
- Human pause (CTO pausa IA quando humano assume)
- RAG / business context / FAQ embeddings
- Oraculo Comercial (analytics IA das conversas)
- Metrics + reasoning logs

## Não-escopo

- Workflow execution (Copilot é action no workflow, mas executor → `workflows`)
- Envio bruto de mensagem → `communication.MessageSender`
- UI de chat humano → `communication`

## API pública (`index.ts`)

### Hooks

- **Agent CRUD**: `useCopilotAgents`, `useCopilotAgent`, `useDefaultCopilotAgent`, `useCreateCopilotAgent`, `useUpdateCopilotAgent`, `useDeleteCopilotAgent`, `useToggleCopilotAgent`, `useSetDefaultCopilotAgent`, `useUpdateCopilotAgentPipeline`
- **Docs/Audios**: `useAgentDocuments`, `useUploadAgentDocument`, `useDeleteAgentDocument`, `useReprocessDocument`, `fetchAgentDocumentSummaries`, `useCopilotAgentAudios`, `useUploadCopilotAgentAudio`, `useDeleteCopilotAgentAudio`, `useUpdateCopilotAgentAudio`
- **Rules / Metrics**: `useAgentFollowupRules` + CRUD, `useAgentKanbanRules`, `useUpsertKanbanRules`, `useAgentMetrics`, `useAgentPendingTasks`
- **Pause + Toggle suite**: `useCopilotPause`, `useCopilotToggle`, `useCopilotToggleStatus`, `useCopilotToggleMutation`, `useCopilotToggleAudit`, `useCopilotToggleDrift`, `useCopilotToggleRealtime`, `copilotToggleQueryKey`
- **Prompt + Analysis + Reasoning**: `useCopilotPromptBuilder`, `generatePrompt`, `saveCopilotSystemPrompt`, `regenerateAndSavePrompt`, `computePromptHash`, `useCopilotReasoning`, `usePromptAnalysisHistory`, `useRunPromptAnalysis`, `useAcceptSuggestion`, `useDismissSuggestion`, `useQuickPromptAnalysis`
- **Subscription / Oraculo / Tool logs**: `useCopilotSubscription`, `useOraculoChat`, `useToolCallLogs`

### Components

`<AgentFollowupRulesTab>`, `<AgentKanbanRulesTab>`, `<AgentMetricsTab>`, `<AgentTasksTab>`, `<PromptPreviewSheet>`, `<BehaviorWindowsEditor>` (+ `createDefaultBehaviorWindow`), `<CopilotPlayground>`, `<OraculoComercial>` (`components/oraculo/` — slice 16 longtail)

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy:
- `@/modules/copilot/pages/Copilot`
- `@/modules/copilot/pages/CopilotMetrics`

### Types

Re-exportados via index.ts: `UpdatePipelinePayload`, `AgentDocument`, `KanbanRuleForm`, `AgentMetrics`, `AgentMetricsTrend`, `AgentMetricsWithTrends`, `CopilotPauseState`, `CopilotToggleStatus`, `CopilotToggleAuditEntry`, `CopilotToggleAuditFilters`, `CopilotDriftRow`, `DocumentSummary`, `CopilotReasoningRow`, `CopilotReasoningFilters`, `PromptSuggestion`, `PromptAnalysis`, `OraculoChatMessage`, `ToolCallLog`, `BehaviorEnforcement`, `BehaviorDayKey`, `BehaviorWindow`

### Eventos (post slice 19)

`human_pause.requested`, `human_pause.released`, `agent.turn_completed`

## Áreas frágeis

🔴 **Área frágil declarada em CLAUDE.md raiz.** Fluxo mais frágil do produto.

Edge cases conhecidos:
- Agente sem `business_context` → fallback genérico
- Lead sem telefone → não pode iniciar conversa
- Conversation sem messages → primeiro turno especial
- Loop detection (`bot-loop-detector.ts`) — quando IA responde IA

Sub-CLAUDE.md raiz: `supabase/functions/agent-message/CLAUDE.md`.

## Origem (slice 7 — frontend migrado em 2026-05-27)

Frontend (✅ migrado pra cá):
- ~~`src/components/copilot/`~~ → `./components/`
- ~~`src/hooks/useCopilot*.ts`~~ (10 hooks) → `./hooks/`
- ~~`src/hooks/useAgent*.ts`~~ (4 hooks) → `./hooks/`
- ~~`src/hooks/{useOraculoChat, usePromptAnalysis, useQuickPromptAnalysis, useToolCallLogs}.ts`~~ (3 hooks) → `./hooks/`
- ~~`src/pages/Copilot.tsx`, `CopilotMetrics.tsx`~~ → `./pages/`

Backend (próximas slices):
- `supabase/functions/agent-message/` (Copilot turn 🔴)
- `supabase/functions/analyze-copilot-prompt/`
- `supabase/functions/copilot-batch-processor/`
- `supabase/functions/evaluate-agent-conversation/`
- `supabase/functions/generate-agent-examples/`
- `supabase/functions/generate-business-context/`
- `supabase/functions/generate-custom-instructions/`
- `supabase/functions/generate-faqs/`
- `supabase/functions/generate-faq-embeddings/`
- `supabase/functions/oraculo-comercial/`
- `supabase/functions/process-agent-document/`
- `supabase/functions/process-copilot-followups/`
- `supabase/functions/reembed-all/`
- `supabase/functions/test-copilot-chat/` (dev — auditar)
- `supabase/functions/_shared/copilot/` (já agrupado)
- `supabase/functions/_shared/copilot-batch-maturity.ts`, `ai-queue.ts`, `ai-action-executor.ts`, `bot-loop-detector.ts`

## Slice de migração

**Slice 7** — `feat/modularizacao/06-copilot` — completado 2026-05-27. 42 renames + 36 import rewrites + 3 tests path-fix.

## Dedup — análise (slice 7)

- `useCopilotToggle` + `useCopilotToggleAudit` + `useCopilotToggleRealtime` → **mantidos como 3 hooks**.
  - Análise: 3 responsabilidades distintas — mutation + status (toggle), audit query + drift, realtime subscription. Sinaturas, query keys e ciclos de vida divergem. Consolidação forçada quebraria callers (CopilotReasoning master page usa apenas audit; toggle hook usa apenas status+mutation; realtime monta uma vez no AppShell). API pública unificada via `index.ts` da camada copilot — chamadores cross-module veem como um único contrato.
  - Follow-up potencial slice 17/19 (event-bus): unificar os 3 sob um `useCopilotToggleSuite()` opt-in. Não é débito real.

## Dedup pendente (próximas slices)

- `_shared/copilot/` parcial (slice 16) — mover `copilot-batch-maturity.ts`, `ai-queue.ts`, `ai-action-executor.ts`, `bot-loop-detector.ts` pra dentro
- `test-copilot-chat` (slice 15) → deletar ou mover pra `tests/`

## Refs

- ADR refactor agent engine: `Obsidian/.../04 — Decisões/ADR-2026-04-27-refactor-agent-engine-modular.md`
- Copilot feature: `Obsidian/.../06 — Features/IA/Copilot.md`
- Sub-CLAUDE.md raiz: `supabase/functions/agent-message/CLAUDE.md`
