# Module — workflows

**Status:** 🟢 Active (slice 8 — frontend completo. Backend `_shared/workflow-*`, `_shared/actions/`, `_shared/action-handlers/` no slice 16; edge functions no slice 15)
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

## API pública (`index.ts`)

### Hooks

- **Workflow CRUD + execuções**: `useWorkflows`, `useWorkflow`, `useCreateWorkflow`, `useUpdateWorkflow`, `useDeleteWorkflow`, `useToggleWorkflow`, `useWorkflowExecutions`, `useWorkflowExecutionSteps`, `useRetryWorkflowExecution`, `useWorkflowStats`
- **Analytics**: `useWorkflowNodeStats`
- **Portability**: `useExportWorkflow`, `useImportWorkflow`
- **Templates**: `useWorkflowTemplates`, `useCloneWorkflowTemplate`
- **Stage <-> Workflow bindings** (consumido por `pipelines` e `campaigns`): `useStageWorkflows`, `useStageWorkflowCounts`, `useCustomPipeStageWorkflows`, `useCustomPipeWorkflowCounts`, `useCampaignStageWorkflows`, `useCampaignWorkflowCounts`
- **Automation Health** (dashboard master): `useAutomationHealth`, `useDeadLetterJobs`, `useFailedWorkflows`, `useStuckActions`, `useCircuitBrokenWebhooks`, `useSystemAlerts`, `useResolveAlert`, `useReprocessJob`, `useOrgsCopilotEngine`, `useToggleCopilotEngine`, `useAuditLog`
- **Server-side trigger** (chamada de `pipelines`/`campaigns`): `triggerFollowUpAutomation`

### Components

Internals (não re-exportados — usados apenas via Pages do próprio módulo): WorkflowCanvas, WorkflowSidebar, WorkflowToolbar, WorkflowAnalytics, WorkflowImportDialog, WorkflowTemplates, EnrollmentCriteria, ReenrollmentConfig, SplitAbAnalytics, TemplateTextarea, VariableInserter + subpastas `action-configs/`, `edges/`, `nodes/`, `sidebar-panels/`.

### Lib interna

- `lib/clipboard.ts` — copy/paste de nós no editor. `extractSelection` (seleção copiável + edges internas) + `cloneSelection` (remap IDs/edges/goto, preserva splitAb `sourceHandle`, filtra trigger). Pura, testada (`clipboard.test.ts`). Consumida só por `AutomacoesEditor`. Feature doc: `06 — Features/automacoes/copy-paste-nodes.md`.

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy:
- `@/modules/workflows/pages/Automacoes`
- `@/modules/workflows/pages/AutomacoesEditor`
- `@/modules/workflows/pages/AutomacoesExecucoes`

### Types

Re-exportados via index.ts: `WorkflowNodeStats`, `WorkflowTemplate`, `HealthStats`, `SystemAlert`, `UseSystemAlertsOpts`, `ReprocessType`, `OrgEngineRow`, `AuditLogFilter`.

Tipos de domínio (`Workflow`, `WorkflowExecution`, `WorkflowExecutionStep`, `WorkflowInsert`, `WorkflowUpdate`, `TriggerConfigStageChanged`, etc.) seguem em `@/types/workflow` (consolidação no slice 16 shared-cleanup).

### Eventos (post slice 19)

`workflow.step_executed`, `workflow.completed`, `workflow.failed`

## Áreas frágeis

🟠 **Área frágil declarada em CLAUDE.md raiz.** Um dos 4 maiores (Copilot, WhatsApp, Permissões, Workflows).

- **Stage_changed fan-out** — consumido via event-bus `lead.stage_changed` (slice 19 + fase 3 event-bus dev). Handler `_shared/events/handlers/lead-stage-changed.ts` chama `fireTrigger` no executor.
- **Dedup obrigatório** — mesma trigger não dispara workflow 2x (memória `workflow-trigger-dedup.ts`).
- **`actions/` vs `action-handlers/`** — split ambíguo em `_shared/`. Slice 16 audita + consolida.
- **wait_response** + **wait_business_window** — workflow pausado por tempo indefinido. Cron retoma.

## Origem (slice 8 — frontend migrado em 2026-05-27)

Frontend (✅ migrado pra cá):
- ~~`src/components/automacoes/`~~ (43 files) → `./components/`
- ~~`src/hooks/useWorkflows.ts`~~ → `./hooks/useWorkflows.ts`
- ~~`src/hooks/useWorkflowAnalytics.ts`~~ → `./hooks/useWorkflowAnalytics.ts`
- ~~`src/hooks/useWorkflowPortability.ts`~~ → `./hooks/useWorkflowPortability.ts`
- ~~`src/hooks/useWorkflowTemplates.ts`~~ → `./hooks/useWorkflowTemplates.ts`
- ~~`src/hooks/useStageWorkflows.ts`~~ → `./hooks/useStageWorkflows.ts`
- ~~`src/hooks/useAutomationHealth.ts`~~ → `./hooks/useAutomationHealth.ts`
- ~~`src/hooks/useAutoFollowUp.ts`~~ → `./hooks/useAutoFollowUp.ts`
- ~~`src/pages/Automacoes.tsx`~~ → `./pages/Automacoes.tsx`
- ~~`src/pages/AutomacoesEditor.tsx`~~ → `./pages/AutomacoesEditor.tsx`
- ~~`src/pages/AutomacoesExecucoes.tsx`~~ → `./pages/AutomacoesExecucoes.tsx`

Backend (próximas slices):
- `supabase/functions/process-workflow-executions/` (slice 15)
- `supabase/functions/process-ai-actions/` (slice 15)
- `supabase/functions/process-followup-automations/` (slice 15)
- `supabase/functions/get-automation-jobs/` (slice 15)
- `supabase/functions/test-workflow-system/` (dev — auditar, slice 15)
- `supabase/functions/_shared/workflow-*.ts` (executor, action-handler, condition-evaluator, trigger, trigger-dedup) (slice 16)
- `supabase/functions/_shared/actions/` (a auditar, slice 16)
- `supabase/functions/_shared/action-handlers/` (a auditar, slice 16)

## Slice de migração

**Slice 8** — `feat/modularizacao/07-workflows` — completado 2026-05-27. 54 renames (43 components + 7 hooks + 3 pages + 1 codemod script) + 43 arquivos com imports atualizados (65 substituições).

## Decisão — hooks adjacentes não migrados

- **`useAutoAdminAssignment.ts`** → permanece em `src/hooks/`. Bootstrap de identity (atribui role admin ao primeiro usuário). Sem dependência de workflow APIs/triggers. Possivelmente migra pra `identity` em slice futura.
- **`useAutoMoveUpsellClients.ts`** → permanece em `src/hooks/`. Orquestração leads/carteira pura — calcula dias desde última venda e movimenta clientes `upsell_clients` baseado em regras de pipeline. Sem dependência de workflow APIs/triggers. Migra pra `carteira` no slice 10.

## Dedup pendente (próximas slices)

- `_shared/workflow-*` consolidação (slice 16)
- `_shared/actions/` vs `_shared/action-handlers/` — nomenclatura consolidada (slice 16)
- `test-workflow-system` → deletar ou mover pra `tests/` (slice 15)
- Tipos `Workflow*` em `@/types/workflow` → considerar movê-los pra módulo (slice 16)

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Runbook cron+webhooks: `Obsidian/.../06 — Features/Infra/Runbook — Cron e Webhooks.md`
- Event-bus piloto: `Obsidian/.../10 — Remodelagem/02-solucao/event-bus.md`
- Slice de referência: slice 7 copilot (commit cf8c2163)
