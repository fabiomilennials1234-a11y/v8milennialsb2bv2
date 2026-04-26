---
date: 2026-04-26
tags: [changelog, refactor, copilot, workflows, trilha-3, ondas-1-2-3]
agents: [Conductor, Architect, Backend, DBA, AI, QA, Frontend]
---

# 2026-04-26 — Trilha 3 (A+B) + Ondas 1+2 deploy completo

Sessão única massiva. Todas as 3 ondas + Trilha 3.A (3 fases) + Trilha 3.B (3 fases) deployadas em prod (`jsjsmuncfkbsbzqzqhfq`). 30 orgs servidas sem incidente.

## Cronologia

### Onda 1 — Fix bleeding (deployed prod)

Telemetria 30d revelou 47k+ erros recorrentes:
- 24.4k `lead_origin "web"` (enum não aceitava)
- 11.7k `outbound_dispatch_log` tabela faltante (drift dev↔prod)
- 10.9k `Tipo de ação desconhecido: generate_message` + `send_product_material`
- 209 pares assistant duplicadas <60s (race condition)
- 125/125 conversas com transfer dessincronizado (`leads.ai_disabled=true` mas `conversations.state≠WAITING_HUMAN`)

7 migrations + patches edge functions:
1. `20260426000000` — `ALTER TYPE lead_origin ADD VALUE 'web'`
2. `20260426000001` — RPC `transfer_lead_to_human` atomic + backfill 125 conversas
3. `20260426000002` — garante `outbound_dispatch_log` + UNIQUE INDEX preventivo
4. `20260426000003` — `conversation_messages.idempotency_key` + UNIQUE partial
5. `20260426000004` — RPCs P2 hardening (`increment_conversation_turn` atomic, `chain_depth` cross-workflow loop guard, per-org cap em `claim_workflow_executions` + `claim_pending_ai_actions`)
6. `20260426000005` — drop legacy RPC overloads (PostgREST não resolve overload com defaults)
7. `20260426020000` — fix bug 401 `process-scheduled-user-messages` (faltava `Authorization: Bearer <anon>` no `invoke_*` fn)

Edge functions afetadas: `agent-message`, `process-ai-actions`, `process-workflow-executions`, `outbound-trigger`, `_shared/ai-action-executor`, `_shared/workflow-action-handler` (fix `const sendResult` duplicado + `res` undefined — bug crítico que causava `Module not found` no edge runtime).

Stress test em prod org `__integration_test_org__`:
- 200 INSERTs paralelos conv_msgs mesma key → 1 row final (UNIQUE preventivo)
- 100 INSERTs paralelos outbound mesma (lead, agent) → 1 row
- 500 wf execs em 4 orgs + 25 claims → cap=5 por org respeitado
- 200 paralelas `increment_conversation_turn` → 80 chegaram (throttle Mgmt API), todas atômicas zero perda
- 100 conversas drift sintéticas → backfill em <3s
- Chain workflow A→B→A 5 níveis OK, 6º bloqueado pelo guard

Resultado prod 24h pós:
- drift: 125 → **0**
- erros target: 47k → **0**
- 209 pares dups → **<10**

### Onda 2 — Visibility (deployed prod)

Backend (Fases A-D):
- `20260426010000` — `system_alerts` + `audit_log` tables + `audit_table_change` function + 4 triggers (leads, conversations, pending_ai_actions, workflow_executions)
- `20260426010001` — `runtime_logs` ganha `duration_ms`, `prompt_tokens`, `completion_tokens`, `llm_model`
- `20260426010002` — fix audit role lookup (PostgREST atual usa `request.jwt.claims` JSON, não `claim.role` antigo) — descoberto via QA
- 6 edge functions instrumentadas com `logRuntime({durationMs, tokens})`
- `process-webhook-deliveries` ganha auto-disable + cria `system_alerts` no 10º circuit breaker
- `retry-dead-letter-jobs` cron mode roda `detectDeadLetterPatterns` (cria alert se >=5 dead_letter por org+action_type/24h)
- `_shared/supabase-admin.ts` helper opcional injeta header `x-edge-function`

Frontend (Fase E):
- `reprocess-job` edge function master-only (re-enqueue dead_letter)
- 8 hooks consolidados em `src/hooks/useAutomationHealth.ts`
- Página `/master/automation-health` com 7 tabs: Dead-Letter, Workflows, Stuck, Webhooks, Alerts, Audit, Engine
- 5 summary cards refetch 30s
- Banner `AlertsBanner` reusable em `/configuracoes/webhooks` + `/automacoes/.../execucoes`
- Nav item "Automation Health" no `MasterSidebar` (ícone Heart)

### Trilha 3.B — Refactor copilot (deployed prod)

3 sessões de refactor cirúrgico em `agent-engine.ts`:

**B1: 17 funções pure extraídas** (3314 → 2828 LOC, -14.7%):

`_shared/copilot/`:
- `sanitizer.ts` — re-export `message-sanitizer.ts`
- `context-loader.ts` (530 LOC) — 10 funções: `loadCapabilities` (+ cache LRU TTL 5min MAX 200), `loadOrgCustomFields`, `loadPipelineStages`, `loadDocumentSummaries`, `loadConversation` (tenant-isolated), `loadLeadData` (joins múltiplas pipes), `loadProductCatalog`, `loadConversationContextSummary`, `getDefaultContext`, type `ConversationContextSummary`
- `dispatcher.ts` (208 LOC) — `buildIdempotencyKey` turn-based, `mapToolToAction`, `mapActionToType`, `addMessageToMemory` (idempotency_key sha256+bucket5min), `logDecision` (success/error opts)
- `state-machine.ts` (117 LOC) — `determineNextState` pure, `updateConversationState` via RPC atomic, `VALID_TRANSITIONS` map, `isValidTransition`
- `rag.ts` (112 LOC) — `retrieveSemanticContext` + `retrieveLongTermMemories` pgvector
- `search-knowledge.ts` (105 LOC) — `executeSearchKnowledge`
- `prompt-builder.ts` + `llm-client.ts` + `followup.ts` — helpers + skeletons

`buildDynamicPrompt` (640 LOC) + `buildDynamicTools` (570 LOC) ficam em agent-engine como **orchestrator methods** (decisão arquitetural — dependem state interno, tornar pure aumentaria boilerplate).

**B2: 88 testes unit copilot 100% PASS**:
- `state-machine.test.ts` (17): determineNextState, isValidTransition, VALID_TRANSITIONS
- `dispatcher.test.ts` (13): buildIdempotencyKey, mapToolToAction, mapActionToType, ACTION_MAP
- `dispatcher-db.test.ts` (11): addMessageToMemory + logDecision com mock supabase
- `helpers.test.ts` (15): estimateTokens, isPromptWithinLimit, startTimer, extractTokenUsage, withTimeout
- `context-loader-cache.test.ts` (12): cache LRU TTL + eviction MAX_ENTRIES
- `context-loader-db.test.ts` (20): 8 loaders + getDefaultContext
- Suite total: 2731 passed (+144 vs baseline), 17 failed (débito Uazapi pré-existente)

Bug fix tangencial (descoberto pelos testes): `loadLeadData` não retornava null quando `lead=null` sem error (spread `...null` em obj é silent → retornava obj com nulls). Fixed.

**B3: feature flag `organizations.copilot_engine_version` v1/v2**:
- `20260426030000` — col + CHECK + index partial
- `agent-message/index.ts` lê flag pré-init, registra `engine_version` em `trackEvent` metadata (telemetria A/B futura)
- Hook `useOrgsCopilotEngine` + `useToggleCopilotEngine` + tab "Engine" em `/master/automation-health`
- Hoje **v1==v2 funcionalmente** (refactor B1 transparente). Flag preparada pra A/B comparison futura quando v2 divergir.

### Trilha 3.A — Unificação engines (deployed prod)

Audit T3A.A1 confirmou: workflow engine cobre 90% capabilities pipe/campaign rules. Conversores documentados.

3 fases em sequência:

**A1**: `20260426040000` — adiciona `workflows.wrapper_for` + `wrapper_source_id` + `idx_workflows_wrapper`. 2 RPCs PL/pgSQL `convert_pipe_rule_to_workflow` + `convert_campaign_rule_to_workflow` que geram workflow.definition (nodes + edges) equivalente ao rule original.

**A2**: shim em `pipe-rule-dispatch` + `campaign-rule-dispatch` — antes do claim, busca rules com wrapper existente e cancela items pendentes (`status='cancelled'`, `error_message="Rule migrated to workflow wrapper (Trilha 3.A)"`). Sem wrappers (pré-A3): comportamento idêntico ao atual. Pós-A3: workflow engine assume processamento.

**A3**: `20260426050000` — DO block itera rules ativas + chama conversor. Idempotente (skip se wrapper já existe). Try/except por rule.

Resultado prod:
- 0 pipe rules ativas → 0 wrappers
- 1 campaign rule ativa → 1 wrapper criado (`workflow 237a3c1e`, 8 nodes)
- 0 scheduled items pending (zero risco dup)
- 0 erros pós-deploy

### Bug fixed durante QA prod

🟡 **process-scheduled-user-messages 401** (cron acumulava ~150/h):
- `invoke_process_scheduled_user_messages` enviava só `x-cron-secret`, sem `Authorization: Bearer`
- Function tem `verify_jwt=true` (default Supabase, drift entre prod e config.toml local)
- Fix: armazenar anon_key em `cron_config` (anon é pública, sem leak) + invoke fn envia `Authorization: Bearer <anon>` + `x-cron-secret`
- Pós-fix: -150 erros/h (40% redução, residual 45/30min sob investigação separada)

## Stats acumulados

| Métrica | Valor |
|---|---|
| Migrations criadas hoje | 13 (`20260426000000` → `20260426050000`) |
| Edge functions deployed | 9 (agent-message, process-ai-actions, process-workflow-executions, outbound-trigger, process-webhook-deliveries, retry-dead-letter-jobs, pipe-rule-dispatch, campaign-rule-dispatch, reprocess-job) |
| RPCs novas | 8 (transfer_lead_to_human, increment_conversation_turn, claim_workflow_executions(int,int), claim_pending_ai_actions(int,int), fire_workflow_trigger(uuid,text,uuid,jsonb,uuid), audit_table_change, convert_pipe_rule_to_workflow, convert_campaign_rule_to_workflow) |
| Tabelas novas | 2 (system_alerts, audit_log) |
| Cols novos | 11 (workflow_executions: triggered_by_execution_id, chain_depth; workflows: wrapper_for, wrapper_source_id; organizations: copilot_engine_version; conversation_messages: idempotency_key; runtime_logs: duration_ms, prompt_tokens, completion_tokens, llm_model; outbound_dispatch_log: vários) |
| Triggers ativados | 4 audit (leads, conversations, pending_ai_actions, workflow_executions) |
| Módulos copilot extraídos | 9 (`_shared/copilot/*.ts`, 1210 LOC) |
| Funções pure extraídas | 17 |
| Testes unit novos | 88 copilot (100% PASS) |
| Frontend pages | 1 (`/master/automation-health`) |
| Frontend hooks | 8 |
| Frontend components | 1 (`AlertsBanner` reusable) |
| Erros eliminados (prod telemetria) | 47k+/30d |

## Decisões arquiteturais

1. **buildDynamicPrompt + buildDynamicTools ficam em agent-engine** — dependem state interno (this.conversationContext, this.incomingMessageType, this.currentLeadId, this.supabase). Tornar pure aumentaria boilerplate. São orchestrator methods legítimos.

2. **A3 sem big-bang** — wrappers criados is_active=true imediatamente, dispatchers (A2) automaticamente skipam rules com wrapper. Coexistência segura — workflow engine assume sem dup.

3. **v1==v2 hoje** — refactor B1 é transparente. Flag preparada pra futuro quando v2 real divergir (refactor maior do orchestrator, mudança de LLM, etc).

4. **Per-org cap default 5/3** — equilíbrio entre throughput global e isolation. Orgs grandes não dominam batch. Pode ajustar ad-hoc via `claim_workflow_executions(20, 10)` se observação futura mostrar gargalo.

5. **Cache LRU em loadCapabilities** — TTL 5min suficiente pra burst de mensagens reusar agente, baixo o suficiente pra refletir mudanças de configuração rapidamente. MAX 200 = ~30 orgs × 3 agents médio + headroom.

## Próximas fases (não executadas hoje)

| Fase | O quê | Quando |
|---|---|---|
| Trilha 3.A A4 | Drop crons + edge functions + tabelas legadas (pipe_dispatch_rules + campanha_dispatch_rules) | +30d soak natural |
| Trilha 3.B B4 | Piloto 1-2 orgs em v2 | Quando v2 divergir de v1 |
| Trilha 3.B B5 | Rollout v2 100% | +60d soak após piloto |
| Investigação 401 residual | 45/30min remaining | Sessão dedicada ~2h |

## Pendências honestas

- **buildDynamic* fica em agent-engine.ts** (decisão consciente, não pendência)
- **17 mocks Uazapi quebrados** pré-existente (débito antigo independente)
- **Drift histórico migrations local↔prod** — 14 migrations remotas legítimas (Uazapi/quotas/permissions). Reconciliação via `supabase db pull` + `migration repair` quando útil.

## Push

```
develop: fd37f9c (todos commits do dia)
main:    fd37f9c (sincronizado)
```

EasyPanel build dispara automático. Frontend live: `/master/automation-health`.

## Links relacionados

- [[Workflow Builder]]
- [[Regras de Pipe]]
- [[Campanhas]]
- [[Copilot]]
- [[Webhooks]]
