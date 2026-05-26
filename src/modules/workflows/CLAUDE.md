# Module — workflows

**Status:** 🟡 Skeleton (slice 8 popula)
**BC:** workflows
**Entidade primária:** Workflow DAG + Trigger + Condition + Action Handler
**Owner:** ops / automações

## Escopo

Automações via DAG (Directed Acyclic Graph). Workflows reagem a eventos do produto e executam steps em sequência/paralelo.

Triggers: `lead_created`, `stage_changed`, `tag_added`, `cron`, `manual`.

Node types: `trigger`, `action`, `condition`, `delay`, `wait_response`, `split_ab`, `copilot`, `webhook_call`, `wait_business_window`.

Track: `workflow_executions` + `workflow_execution_steps`.

Inclui:
- Editor visual (xyflow/react)
- Execução assíncrona (worker `process-workflow-executions`)
- Action handlers (handle-*.ts)
- Condition evaluator
- Dedup (mesma execução não dispara 2x)
- Health monitoring + dead letter
- Portability (export/import workflow definition)
- Templates

## Não-escopo

- Envio de mensagem (workflow chama `MessageSender` do `communication`)
- Mudança de stage (workflow chama RPC do `pipelines`)
- Notificações UI → `platform`

## API pública (`index.ts`) — TBD slice 8

Provável superfície:
- Hooks: `useWorkflows`, `useWorkflowAnalytics`, `useWorkflowPortability`, `useWorkflowTemplates`, `useStageWorkflows`, `useAutomationHealth`
- Components: `<WorkflowEditor>`, `<WorkflowExecutionList>`
- Types: `Workflow`, `WorkflowNode`, `WorkflowExecution`, `ActionType`
- Eventos (post slice 19): `workflow.step_executed`, `workflow.completed`, `workflow.failed`

## Áreas frágeis

- **`triggerStageChangedWorkflows` chamado em 3 lugares** — bug `08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`. Fix em slice 19 event-bus (piloto migra `lead.stage_changed`).
- **Dedup obrigatório** — mesma trigger não dispara workflow 2x (memória `workflow-trigger-dedup.ts`)
- **`actions/` vs `action-handlers/`** — split ambíguo em `_shared/`. Slice 8 audita + consolida.
- **wait_response** + **wait_business_window** — workflow pausado por tempo indefinido. Cron retoma.

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/automacoes/`
- `src/hooks/useWorkflow*.ts` (useWorkflows, useWorkflowAnalytics, useWorkflowPortability, useWorkflowTemplates, useStageWorkflows)
- `src/hooks/useAutomationHealth.ts`, `useAutoFollowUp.ts`
- `src/pages/Automacoes.tsx`, `AutomacoesEditor.tsx`, `AutomacoesExecucoes.tsx`

Backend:
- `supabase/functions/process-workflow-executions/`
- `supabase/functions/process-ai-actions/`
- `supabase/functions/process-followup-automations/`
- `supabase/functions/get-automation-jobs/`
- `supabase/functions/test-workflow-system/` (dev — auditar)
- `supabase/functions/_shared/workflow-*.ts` (executor, action-handler, condition-evaluator, trigger, trigger-dedup)
- `supabase/functions/_shared/actions/` (a auditar)
- `supabase/functions/_shared/action-handlers/` (a auditar)

## Slice de migração

**Slice 8** — `feat/modularizacao/07-workflows` (6h + 2h dedup = 8h)

## Dedup pendente

- `_shared/actions/` vs `_shared/action-handlers/` — nomenclatura consolidada
- `test-workflow-system` → deletar ou mover pra `tests/`

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Runbook cron+webhooks: `Obsidian/.../06 — Features/Infra/Runbook — Cron e Webhooks.md`
- Event-bus piloto: `Obsidian/.../10 — Remodelagem/02-solucao/event-bus.md`
