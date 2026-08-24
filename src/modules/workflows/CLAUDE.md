# Module — workflows

**Status:** 🟢 Active (slice 8 — frontend completo. Backend `_shared/workflow-*`, `_shared/actions/`, `_shared/action-handlers/` no slice 16; edge functions no slice 15)
**BC:** workflows
**Entidade primária:** Workflow DAG + Trigger + Condition + Action Handler
**Owner:** ops / automações

## Nó incompleto não ativa

Regra única em `src/contracts/workflows/node-requirements.ts`. Duas portas de ativação
passam por ela — `AutomacoesEditor.handleSave` e `useToggleWorkflow` (lista). Fechar só
uma tornaria o gate contornável por um clique.

- **Salvar rascunho incompleto é permitido.** Só ATIVAR é bloqueado.
- **Nó culpado é marcado no canvas** (anel âmbar + o que falta). Recusar sem apontar
  qual nó entre vinte seria trocar um defeito por outro.
- **`actionType` sem regra passa.** Gate que bloqueia o que não entende trava o produto
  a cada feature nova, e o time aprende a contorná-lo.
- **Falso positivo é pior que gate nenhum.** Por isso `assign_responsible` com rodízio
  não exige responsável, e funil sem etapas cadastradas não acusa etapa inválida — os
  dois espelham o que o executor faz.

A fonte da verdade é o executor (`supabase/functions/_shared/`), onde cada regra é um
`if (!x) return erro` inline em 6 arquivos. `tests/unit/workflow-node-requirements.test.ts`
falha se a mensagem ou a chave sumir de lá — a âncora é teste, não comentário.

**Referência podre** (etapa renomeada/apagada depois) é outra classe: o workflow era
válido quando salvou. Gate de ativação não pega. Sai na aba Configuração de
`/master/automation-health`, que roda as MESMAS funções sobre os dados vivos.


## Escopo

Automações via DAG (Directed Acyclic Graph). Workflows reagem a eventos do produto e executam steps em sequência/paralelo.

Triggers: `lead_created`, `stage_changed`, `tag_added`, `cron`, `manual`, `deal_created`.

Node types (15, união `WorkflowNodeType` em `@/types/workflow`): `trigger`, `action`, `condition`, `delay`, `copilot`, `end`, `wait_response`, `split_ab`, `webhook_call`, `goto`, `wait_business_window`, `assign_responsible`, `code_json`, `code_javascript`, `code_https`.

⚠️ **Um tipo novo tem 8 pontos de registro** e só 3 quebram o build. Os que falham **calados**: `nodeTypes` do `WorkflowCanvas` (nó vira o cinza default do React Flow), o `switch` de `renderPanel` do `WorkflowSidebar` (`default: return null` → sidebar vazio) e `ADD_NODE_GROUPS` do `WorkflowToolbar` (nó inalcançável). Os que quebram: `NODE_COLORS`, `NODE_LABELS` (ambos `Record<WorkflowNodeType, …>`) e `createDefaultNodeData` (`switch` sem `default`). Fora do front, `_shared/workflow-schema/enums.ts` tem um teste de paridade que lê o **texto** de `src/types/workflow.ts` e só roda em `npm run test:edge`.

**Nós de código** (`code_json`, `code_javascript`, `code_https`) — cada um tem **um único campo de código escrito à mão**, mais variável de saída e política de erro. Não há anexo de arquivo nem geração por IA: o usuário escreve, e só. Escrevem o resultado em `context[outputVariable]`, consumido depois via `{{variavel}}` (caso de uso nº 1: o `bodyTemplate` de um `webhook_call`).

**`code_https`** — a requisição HTTP inteira é escrita como **UM JSON** no campo de código (`method`, `url`, `headers`, `body`, `timeoutMs`), com `{{variaveis}}` em qualquer valor. Runtime: resolve variáveis com `jsonEscape` → `JSON.parse` → valida a forma → dispara → grava a resposta em `context[outputVariable]`. A `url` **precisa começar com `https://`** — `http://` é recusado com mensagem explícita (é o que dá nome ao nó) e depois disso ainda passa por `validateExternalUrl` de `_shared/url-validator.ts`. Defaults: `method` `"GET"`, `timeoutMs` 15000 com teto de 30000. Um nó novo já nasce com um JSON de exemplo no campo — é o que ensina o formato, já que não há doc na tela.

🚨 **`code_javascript` NÃO executa nesta fase.** O executor grava o step como `skipped` e segue o fluxo (fail-open deliberado — um nó não executável nunca mata um workflow de produção). Motivo: não há sandbox — `new Function` + shadowing de globais escapa por 4 vetores medidos e exfiltra o `SUPABASE_SERVICE_ROLE_KEY`, e a Web Worker API não existe no runtime da Supabase. A execução isolada (QuickJS em WASM, numa edge function dedicada) é a fase 2. Enquanto isso o item fica **oculto na toolbar** atrás da flag `workflow_code_js` (`CODE_JS_NODE_FLAG`) — **não ligar para nenhum cliente**.

🚨 **O passo do `code_https` não pode vazar segredo.** `workflow_execution_steps` é legível por **qualquer membro da org**, então o `input_data` do passo NUNCA carrega `headers` (levam `Authorization`), nem o `code`, nem a query string da `url` (pode levar token). Grava só `{ method, url_host, url_path, has_body, output_variable, bytes }`; o `output_data` fica em `{ status, bytes, preview }`, com o preview cortado em 500 chars.

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

Internals (não re-exportados — usados apenas via Pages do próprio módulo): WorkflowCanvas, WorkflowSidebar, WorkflowToolbar, WorkflowAnalytics, WorkflowImportDialog, WorkflowTemplates, EnrollmentCriteria, ReenrollmentConfig, SplitAbAnalytics, TemplateTextarea, VariableInserter, CodeField + subpastas `action-configs/`, `edges/`, `nodes/`, `sidebar-panels/`.

`CodeField` (textarea `font-mono` com inserção no cursor + drop de chips `{{…}}`) é compartilhado pelos 3 painéis de código. **Não há editor com realce de sintaxe** — o repo não tem Monaco/CodeMirror e trazer um para um sidebar de 360 px é desproporcional.

### Lib interna

- `lib/instance-routing.ts` — **Instance Routing Policy** (ADR-0025): de qual Instance o nó de mensagem envia. `readRoutingPolicy` (resolve o legado: `whatsappInstanceId` preenchido = `fixed`, vazio = `conversation`), `buildPolicyChange`/`buildFixedInstanceChange`/`buildFallbackChange` (patches de `data`), `isInstanceRoutedAction` (quais actionTypes declaram política — inclui `send_campaign_message`). Um único `POLICY_SPECS` guarda rótulo, frase de apoio e necessidade de recuo. Pura, testada (`tests/unit/instance-routing.test.ts`). UI: `sidebar-panels/InstanceRoutingSelector.tsx`. **Entrar em `fixed` preserva o recuo** — apagá-lo destruiria o valor semeado (#1333).
- `lib/codeNodes.ts` — regras dos **nós de código**. `codeNodeBytes` (bytes UTF-8 do `code`, não `.length`), `isValidOutputVariable` (o prefixo `_` é reservado para as chaves internas do executor: `_retry_counts`, `_wait_resolved`, `_last_error`, …) e `validateCodeNodes(nodes): string[]` (validação pré-save, mensagens em PT-BR). Pura, testada. É o **primeiro precedente de validação por-nó** no `handleSave` do editor, que antes só checava nome e trigger; os limites de tamanho (`CODE_SOURCE_MAX_BYTES`, 64 KB por nó; `CODE_WORKFLOW_MAX_BYTES`, 192 KB por automação) são **advisory** — a RLS de `workflows` deixa qualquer membro escrever `definition` direto pelo PostgREST.
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
- **`deal_created` ↔ `create_deal`** — laço em potencial. Cortado por `metadata.workflow_execution_id` (vira parent execution → chain_depth) + `dealSkipIfOpenExists`. Feature doc: `06 — Features/automacoes/negocio-criado.md`.
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
