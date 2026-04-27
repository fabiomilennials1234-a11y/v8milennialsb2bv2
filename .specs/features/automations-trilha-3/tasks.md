# Tasks — Trilha 3

Notação: `[P]` paralelo | `→ T#` depende | tasks de alto nível, granular durante execução

---

## Sub-feature 3.A — Unificação engines

### Fase A1 — Workflow engine ganha capabilities (~2 semanas)

#### T3A.1 [P] — Spec dos novos nodes especializados
- **What:** Definir nodes `pipe_send_template_with_response`, `campaign_cadence_step` (ou reusar nodes existentes mappeados)
- **Where:** `.specs/features/automations-trilha-3/notes/node-spec.md`
- **Done when:** doc revisado por Architect agent
- **Estimativa:** 4h

#### T3A.2 — Implementar conversor `convert_pipe_rule_to_workflow(rule_id)` PL/pgSQL
- **Where:** `supabase/migrations/<ts>_pipe_rule_workflow_converter.sql`
- **Done when:** function aceita rule_id e retorna workflow_id; verificar que JSONB definition é válido
- **Test:** pgTAP - converter regra de fixture, comparar campos esperados
- **Depends on:** T3A.1
- **Estimativa:** 8h

#### T3A.3 — Implementar conversor `convert_campaign_rule_to_workflow(rule_id)` PL/pgSQL
- **Estimativa:** 6h
- **Depends on:** T3A.1

#### T3A.4 — Adicionar coluna `wrapper_for` + `wrapper_source_id` em workflows
- **Where:** migration
- **Estimativa:** 1h

#### T3A.5 — Workflow executor suporta nodes especializados se necessário
- **What:** Validar que nodes existentes (action send_template, wait_response, action move_stage) cobrem todos os casos. Adicionar novos só se gap real.
- **Where:** `_shared/workflow-executor.ts`
- **Estimativa:** ~8h (incerto — depende de gaps)

### Fase A2 — Shim (~1 semana)

#### T3A.6 — `pipe-rule-dispatch` vira shim que enfileira workflow_executions
- **Where:** `supabase/functions/pipe-rule-dispatch/index.ts`
- **Done when:** quando rule dispara, em vez de processar próprio engine, cria workflow_execution para wrapper workflow
- **Test:** dev — disparar pipe rule + observar workflow_execution criada
- **Depends on:** T3A.2, T3A.4
- **Estimativa:** 6h

#### T3A.7 — `campaign-rule-dispatch` vira shim análogo
- **Estimativa:** 4h
- **Depends on:** T3A.3, T3A.4

### Fase A3 — Migration de dados (~1 semana)

#### T3A.8 — Migration converte 100% das rules existentes em wrapper workflows
- **Where:** `supabase/migrations/<ts>_migrate_pipe_campaign_rules.sql`
- **Done when:** todas pipe_dispatch_rules + campanha_dispatch_rules ativas têm wrapper workflow correspondente
- **Test:** dev primeiro, validar 100%, depois prod com transação + rollback ready
- **Depends on:** T3A.6, T3A.7
- **Estimativa:** 8h

#### T3A.9 — Hook usePipeDispatchRules lê via workflows wrappers
- **Where:** `src/hooks/usePipeDispatchRules.ts`
- **Done when:** UI continua funcionando lendo da nova fonte
- **Test:** Playwright + verify UI inalterada
- **Depends on:** T3A.8
- **Estimativa:** 6h

#### T3A.10 — Idem para hooks de campanha rules
- **Estimativa:** 4h
- **Depends on:** T3A.8

### Fase A4 — Cleanup (~1 semana, +30d soak)

#### T3A.11 — Após 30d sem incidente, remover crons legados + functions
- **Where:** migration drop pg_cron jobs + Bash supabase functions delete
- **Estimativa:** 2h
- **Depends on:** 30d de soak passados

#### T3A.12 — Atualizar Obsidian features Pipe Rules + Campanhas + Workflow Builder
- **Where:** Obsidian vault
- **Estimativa:** 2h

---

## Sub-feature 3.B — Refactor Copilot

### Fase B1 — Split (~2 semanas)

#### T3B.1 [P] — Mover sanitizer + criar estrutura `_shared/copilot/`
- **Where:** `supabase/functions/_shared/copilot/sanitizer.ts` (mover de `_shared/message-sanitizer.ts`)
- **Done when:** import path atualizado, agent-engine continua funcionando
- **Estimativa:** 2h

#### T3B.2 [P] — Extrair `context-loader.ts`
- **What:** loadCapabilities + loadConversationContext + cache LRU stub (sem lógica nova)
- **Where:** `supabase/functions/_shared/copilot/context-loader.ts`
- **Done when:** agent-engine.ts importa loader, comportamento idêntico
- **Estimativa:** 6h

#### T3B.3 [P] — Extrair `prompt-builder.ts`
- **What:** buildDynamicPrompt + buildDynamicTools (sem mudanças funcionais)
- **Estimativa:** 8h

#### T3B.4 [P] — Extrair `llm-client.ts`
- **What:** OpenRouter wrapper (mover lógica de chamada)
- **Estimativa:** 4h

#### T3B.5 [P] — Extrair `state-machine.ts` (determineNextState + transições)
- **Estimativa:** 4h

#### T3B.6 [P] — Extrair `dispatcher.ts` (enqueueToolAction)
- **Estimativa:** 4h

#### T3B.7 [P] — Extrair `search-knowledge.ts` + `rag.ts` + `followup.ts`
- **Estimativa:** 8h

#### T3B.8 — agent-engine.ts vira orchestrator <300 LOC importando módulos
- **Done when:** agent-message smoke test em dev passa
- **Depends on:** T3B.1-T3B.7
- **Estimativa:** 6h

### Fase B2 — Testes + correções (~2 semanas)

#### T3B.9 [P] — Test suite context-loader
- **Where:** `__tests__/context-loader.test.ts`
- **Estimativa:** 6h

#### T3B.10 [P] — Test suite prompt-builder + size limits auditados
- **Estimativa:** 8h

#### T3B.11 [P] — Test suite llm-client com timeout + retry + token tracking
- **Estimativa:** 8h

#### T3B.12 [P] — Test suite state-machine + dispatcher
- **Estimativa:** 6h

#### T3B.13 [P] — Test suite search-knowledge + rag (mock embeddings)
- **Estimativa:** 6h

#### T3B.14 — Implementar Zod schemas para validação tool_calls
- **Where:** `_shared/copilot/tool-schemas.ts`
- **Done when:** todos 23 tools têm schema; LLM recebe erro estruturado se args inválidos
- **Estimativa:** 8h

#### T3B.15 — LRU cache real em context-loader (5min TTL, max 100 agents)
- **Estimativa:** 4h

### Fase B3 — Feature flag (~1 semana)

#### T3B.16 — Migration adiciona `organizations.copilot_engine_version`
- **Where:** migration
- **Estimativa:** 1h

#### T3B.17 — agent-message edge function roteia v1/v2 baseado em flag
- **Where:** `supabase/functions/agent-message/index.ts`
- **Done when:** flag controla qual engine processa
- **Test:** flip flag em dev → comportamento muda
- **Depends on:** T3B.16, T3B.8
- **Estimativa:** 4h

#### T3B.18 — UI master toggle por org
- **Where:** `src/pages/master/CopilotEngineToggle.tsx`
- **Estimativa:** 4h

### Fase B4 — Piloto (~2 semanas)

#### T3B.19 — Selecionar 1-2 orgs piloto + ativar flag
- **Where:** decisão CTO
- **Estimativa:** —

#### T3B.20 — Dashboard `/master/copilot-engine-comparison`
- **Where:** `src/pages/master/CopilotEngineComparison.tsx`
- **Done when:** lê runtime_logs (com cols Onda 2) + plota deltas v1 vs v2
- **Depends on:** Onda 2 deployada
- **Estimativa:** 8h

#### T3B.21 — Monitoramento por 14d, ajustes finos baseado em métricas reais
- **Estimativa:** ongoing

### Fase B5 — Rollout + cleanup (~1 semana, +60d soak)

#### T3B.22 — Flip flag para 100% das orgs
- **Estimativa:** 1h

#### T3B.23 — Após 30d sem regressão, marcar v1 como deprecated em código
- **Estimativa:** 1h

#### T3B.24 — Após 60d, remover v1
- **Estimativa:** 4h

#### T3B.25 — Atualizar Obsidian Copilot.md
- **Estimativa:** 2h

---

## Resumo

| Sub-feature | Fases | Tasks | Tempo total |
|---|---|---|---|
| 3.A Unificação | A1-A4 | 12 | ~7 semanas (incluindo 30d soak) |
| 3.B Refactor copilot | B1-B5 | 25 | ~8 semanas (incluindo piloto + soak) |

## Critério de fechamento

### 3.A
- pipe_dispatch_rules + campanha_dispatch_rules tabelas read-only ou removidas
- Crons legados removidos
- 0 incidente em 30d pós-cutover
- Métricas de fechamento da spec atingidas

### 3.B
- agent-engine.ts orchestrator < 500 LOC
- Cobertura unit copilot > 70%
- 100% das orgs em v2
- Latência p95 -30% vs baseline
- 0 regressão por 60d
- v1 removida do codebase
