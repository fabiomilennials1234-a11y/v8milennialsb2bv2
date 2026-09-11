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

🚨 **`code_javascript` NÃO executa nesta fase.** O executor grava o step como `skipped` e segue o fluxo (fail-open deliberado — um nó não executável nunca mata um workflow de produção). Motivo: não há sandbox — `new Function` + shadowing de globais escapa por 4 vetores medidos e exfiltra o `SUPABASE_SERVICE_ROLE_KEY`, e a Web Worker API não existe no runtime da Supabase. A execução isolada (QuickJS em WASM, numa edge function dedicada) é a fase 2. Enquanto isso o item fica **sempre oculto na toolbar**. Definitions antigas continuam renderizando para não corromper dados, mas ninguém cria um node inerte pela UI.

🚨 **O passo do `code_https` não pode vazar segredo.** `workflow_execution_steps` é legível por **qualquer membro da org**, então o `input_data` do passo NUNCA carrega `headers` (levam `Authorization`), nem o `code`, nem a query string da `url` (pode levar token). Grava só `{ method, url_host, url_path, has_body, output_variable, bytes }`; o `output_data` fica em `{ status, bytes, preview }`, com o preview cortado em 500 chars.

Track: `workflow_executions` + `workflow_execution_steps`.

### Condição por mensagem do gatilho

`message.trigger.text` avalia uma linha persistida identificada, nunca o texto livre de `workflow_executions.context`. A regra escolhe a conversa do gatilho ou fixa `storage + boxId + provider`; o participante sempre é o lead da execução. Runtime exige o localizador `context.message_context` com o UUID da linha, caixa, provider e participante. Outra caixa, provider ou chip não substitui a identidade.

O avaliador consome somente `condition_text` ou uma transcrição já persistida com provider e instante. Mídia sem fonte textual é erro `message_text_unavailable`; registro removido é `context_unavailable`. O texto legado em `context.message` permanece porque o gatilho antigo `contains_text` ainda depende dele.

`message.search.text` reutiliza essas fontes persistidas para mensagem do gatilho, última recebida ou período `[from,to)`. Caixa/provider/participante continuam fixos. `all` exige todas as expressões na mesma linha; resultado negativo em histórico exige cobertura completa. Máximo: 20 regras de busca por avaliação, 20 expressões por regra, 120 caracteres cada e 1.000 caracteres normalizados totais. Nenhuma avaliação gera transcrição.

`message.waiting.elapsed` mede relógio corrido desde a primeira mensagem da sequência atual ainda sem resposta. `waitingFor=lead` começa em mensagem recebida; `waitingFor=company` começa em mensagem enviada. Complementos do mesmo lado preservam a âncora; mensagem válida do lado oposto encerra a sequência. Recebidas contam com `status=received`; enviadas contam somente em `sent`, `delivered` ou `read`. `pending`, `failed`, receipts, reações e eventos de sistema não contam. Mídia conta sem depender de texto. Sem sequência ativa, o valor é ausente, nunca zero. Cobertura não completa bloqueia a decisão.

Falha temporária de condição publicada retoma o mesmo node com dados atuais. Somente `temporarily_unavailable` e `history_sync_in_progress` recebem retries em 30s, 90s e 270s. A execução permanece `running`, usa `next_run_at` e guarda estado em `guided_condition_retry_*`; nenhuma saída é escolhida durante a espera. Sucesso limpa o estado antes do ramo. Falha permanente termina imediatamente; esgotamento grava `guided_condition_retry_exhausted:<code>`. Retry de condição não incrementa loop nem reexecuta nodes anteriores.

### Condição por produto

`product.relationship` mantém três relações distintas. `trigger_business_item` lê
`deal_items.product_id` pelo `deal_id` da entrada exata do gatilho.
`lead_association` lê somente `lead_products` manual e ativo.
`won_deal_history` lê o agregado criado por negócio ganho; não representa pagamento.
Toda regra persiste UUID de produto ativo da organização. Nome é dica visual e item
avulso nunca casa por texto. Grants separados: `product.trigger_business_item`,
`product.lead_association` e `product.won_deal_history`.

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
- **Portability**: `useExportWorkflow`, `useImportWorkflow`. Árvores guiadas usam o draft atual. Export/import limpa toda referência de tenant, remapeia IDs internos recursivamente e importa como shell inativo + draft sem grants; o destino exige remapeamento explícito antes de publicar.
- **Revisão legada**: `legacy-condition-review.ts` inventaria diferenças sem escrever ao abrir. Ação explícita cria o primeiro draft na mesma automação; definição ativa, execuções sem versão e `time_window` pausante permanecem legados até publicação/reconstrução deliberada.
- **Templates**: `useWorkflowTemplates`, `useCloneWorkflowTemplate`
- **Stage <-> Workflow bindings** (consumido por `pipelines` e `campaigns`): `useStageWorkflows`, `useStageWorkflowCounts`, `useCustomPipeStageWorkflows`, `useCustomPipeWorkflowCounts`, `useCampaignStageWorkflows`, `useCampaignWorkflowCounts`
- **Automation Health** (dashboard master): `useAutomationHealth`, `useDeadLetterJobs`, `useFailedWorkflows`, `useStuckActions`, `useCircuitBrokenWebhooks`, `useSystemAlerts`, `useResolveAlert`, `useReprocessJob`, `useOrgsCopilotEngine`, `useToggleCopilotEngine`, `useAuditLog`
- **Server-side trigger** (chamada de `pipelines`/`campaigns`): `triggerFollowUpAutomation`

### Components

Internals (não re-exportados — usados apenas via Pages do próprio módulo): WorkflowCanvas, WorkflowSidebar, WorkflowToolbar, WorkflowAnalytics, WorkflowImportDialog, WorkflowTemplates, ReenrollmentConfig, SplitAbAnalytics, TemplateTextarea, VariableInserter, CodeField + subpastas `action-configs/`, `edges/`, `nodes/`, `sidebar-panels/`.

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

## Condição Tag — seleção do catálogo

`ConditionPanel` usa `useTags` (escopo da organização) e grava `field: "tags"`,
valor = nome da tag, operador `has_tag`/`not_has_tag`. Sem criação por texto livre.
Valores legados fora do catálogo permanecem visíveis; editar a escolha normaliza
o campo singular `tag`. Executor aceita ambos os nomes e compara associação por
nome inteiro, sem dividir tags que contêm vírgula. Operadores textuais salvos
preservam semântica anterior. Edição não renomeia nem cria tags.

Publicação desta correção requer frontend + `process-workflow-executions`
(helper compartilhado `workflow-condition-evaluator.ts`). Sem migration.

### Controles guiados do nó Condição — 2026-09-08

Operadores e tipo de valor são definidos em `lib/condition-field-controls.ts`.

| Campo | Controle |
| --- | --- |
| Nome, empresa, email, telefone | Texto com operadores textuais; placeholders específicos |
| Origem | Catálogo de origens por slug |
| UTMs | Combobox com valores observados; permite texto novo |
| Segmento, urgência, faturamento | Combobox com valores de leads visíveis da org; não inventa enum/faixas |
| Tag | Catálogo de tags; associação exata |
| Etapa | Dropdown com funil + etapa, salvo por UUID |
| Responsáveis | Catálogo de membros; seleção indisponível preservada e sinalizada |
| Avaliação | Dropdown de 1 a 5 estrelas |
| Pontuação, valor do negócio, dias na etapa | Input numérico com unidade/limites pertinentes |
| Tem negócio aberto | Sim/Não; operadores booleanos não pedem valor |
| Campo personalizado | Nome cadastrado; valor respeita text/number/date/select/boolean e field_options |
| Horário | Dias selecionáveis por teclado, horários nativos e fuso |

Última mensagem, quantidade de mensagens e dias sem contato não são resolvidos
pelo avaliador atual nem colunas de `leads`. Não são oferecidos a novas regras;
configurações legadas ficam visíveis com aviso, sem alteração automática.

Operadores incompatíveis salvos ficam identificados como antigos. Trocas de domínio
limpam valor e ajustam operador incompatível; papéis de responsável e UTMs preservam
valores compartilhados. Data oferece igualdade/vazio: o executor legado não implementa
comparação cronológica. Sugestões de campos livres leem amostra limitada a 1000 leads
sob RLS + filtro de org e nunca são tratadas como catálogo exaustivo.
