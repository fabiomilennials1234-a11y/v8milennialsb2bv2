# Module — copilot

**Status:** 🟡 Skeleton (slice 7 popula — `_shared/copilot/` já agrupado parcialmente)
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

## API pública (`index.ts`) — TBD slice 7

Provável superfície:
- Hooks: `useCopilotAgents`, `useCopilotPause`, `useCopilotToggle`, `useCopilotPromptBuilder`, `useCopilotReasoning`, `useAgentDocuments`, `useAgentFollowupRules`, `useAgentKanbanRules`, `useAgentMetrics`, `useOraculoChat`
- Components: `<CopilotAgentEditor>`, `<CopilotMetrics>`, `<CopilotPauseBanner>`, `<OraculoChat>`
- Types: `CopilotAgent`, `AgentType`, `HumanPause`
- Eventos (post slice 19): `human_pause.requested`, `human_pause.released`, `agent.turn_completed`

## Áreas frágeis

🔴 **Área frágil declarada em CLAUDE.md raiz.** Fluxo mais frágil do produto.

Edge cases conhecidos:
- Agente sem `business_context` → fallback genérico
- Lead sem telefone → não pode iniciar conversa
- Conversation sem messages → primeiro turno especial
- Loop detection (`bot-loop-detector.ts`) — quando IA responde IA

Sub-CLAUDE.md raiz: `supabase/functions/agent-message/CLAUDE.md`.

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/copilot/`
- `src/hooks/useCopilot*.ts` (10 hooks: useCopilotAgents, useCopilotAgentAudios, useCopilotPause, useCopilotPromptBuilder, useCopilotReasoning, useCopilotSubscription, useCopilotToggle, useCopilotToggleAudit, useCopilotToggleRealtime, useOraculoChat, usePromptAnalysis, useQuickPromptAnalysis, useToolCallLogs)
- `src/hooks/useAgent*.ts` (useAgentDocuments, useAgentFollowupRules, useAgentKanbanRules, useAgentMetrics)
- `src/pages/Copilot.tsx`, `CopilotMetrics.tsx`

Backend:
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

**Slice 7** — `feat/modularizacao/06-copilot` (5h + 1h dedup = 6h)

## Dedup pendente

- `useCopilotToggle` + `useCopilotToggleAudit` + `useCopilotToggleRealtime` → 1 hook composable
- `_shared/copilot/` parcial — mover `copilot-batch-maturity.ts`, `ai-queue.ts`, `ai-action-executor.ts`, `bot-loop-detector.ts` pra dentro
- `test-copilot-chat` → deletar ou mover pra `tests/`

## Refs

- ADR refactor agent engine: `Obsidian/.../04 — Decisões/ADR-2026-04-27-refactor-agent-engine-modular.md`
- Copilot feature: `Obsidian/.../06 — Features/IA/Copilot.md`
- Sub-CLAUDE.md raiz: `supabase/functions/agent-message/CLAUDE.md`
