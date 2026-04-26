# T3B — Execution log Fase B1 (skeleton + sanitizer move)

**Data início:** 2026-04-26
**Status atual:** B1 SKELETON completa. Extração funções real pendente.

## Filosofia da Fase B1

Refactor de 3314 LOC em 1 arquivo é trabalho de 8h+ por módulo se feito com cuidado (validar build + smoke + commit por extração). Pra evitar half-done state em produção, escolhi 2 caminhos paralelos:

1. **T3B.1 done real** — sanitizer movido (re-export). Build passa. Commit limpo.
2. **T3B.2-T3B.7 skeletons** — arquivos criados com docstrings + interfaces + helpers + TODO markers. Não movem código ainda.

Skeletons servem como **placeholder organizacional** + **utilities pequenos** que adicionam valor imediato (LRU cache, VALID_TRANSITIONS map, ACTION_MAP, helpers token estimation).

## O que foi entregue

| Arquivo | Status | Conteúdo |
|---|---|---|
| `_shared/copilot/sanitizer.ts` | ✅ DONE | Re-export de message-sanitizer.ts |
| `_shared/copilot/context-loader.ts` | 🟡 SKELETON | LRU cache util (TTL 5min, max 200 agents) |
| `_shared/copilot/prompt-builder.ts` | 🟡 SKELETON | estimateTokens + isPromptWithinLimit helpers |
| `_shared/copilot/llm-client.ts` | 🟡 SKELETON | Constants timeout/retry + interface LlmCallResult |
| `_shared/copilot/state-machine.ts` | 🟡 SKELETON | VALID_TRANSITIONS map + isValidTransition |
| `_shared/copilot/dispatcher.ts` | 🟡 SKELETON | ACTION_MAP completo (LLM tool name → action_type) |
| `_shared/copilot/search-knowledge.ts` | 🟡 SKELETON | Constants thresholds + limits + max iterations |
| `_shared/copilot/rag.ts` | 🟡 SKELETON | Re-export embeddings + EMBEDDING_DIMENSIONS |
| `_shared/copilot/followup.ts` | 🟡 SKELETON | Re-export getNextSendTime |

Build pós-commit: ✅ 8.37s zero erros.

## Plano para extração real (sessões dedicadas)

Cada extração precisa de:
- Identificar funções alvo + dependências internas (`this.supabase`, `this.organizationId`)
- Mover funções como standalone (params explícitos)
- Atualizar callers em `agent-engine.ts`
- Build smoke (`npm run build`)
- Smoke functional dev (criar lead + simular mensagem)
- Commit atômico por módulo

### Sessão 1 (8h) — Context Loader
1. Mover `loadCapabilities` (~150 LOC) como standalone (params: `supabase`, `organizationId`, `agentId`, `leadId?`)
2. Integrar cache LRU (já infra pronta)
3. Mover `loadConversationContext`
4. Smoke: dev cria lead + agent-message → verify capabilities cached

### Sessão 2 (8h) — Prompt Builder
1. Mover `buildDynamicPrompt` (~300 LOC) — receber capabilities + leadData + ctx como params
2. Mover `buildDynamicTools`
3. Adicionar **truncagem auditada** (warning logRuntime se prompt > 8K)
4. Smoke

### Sessão 3 (4h) — LLM Client
1. Wrapper sobre `OpenRouterClient` com timeout 30s
2. Retry exponencial 1x em 5xx
3. Token tracking integrado (já feito em Onda 2 — mover pra cá)

### Sessão 4 (4h) — State Machine + Dispatcher
1. Mover `determineNextState`
2. Mover `enqueueToolAction` + `buildIdempotencyKey`
3. Smoke

### Sessão 5 (8h) — Search/RAG/Followup
1. Mover `executeSearchKnowledge`
2. Mover queries pgvector
3. Mover `generateFollowupMessage`
4. Smoke

### Sessão 6 (6h) — Orchestrator final
1. Limpar agent-engine.ts (apagar tudo movido)
2. Reescrever `processMessage()` chamando módulos em ordem
3. Smoke completo end-to-end
4. Target: < 300 LOC

**Total sessões dedicadas:** 38h (~5 dias úteis 1 dev).

## Cronograma sugerido

| Semana | Atividade |
|---|---|
| Esta semana | Onda 2 prod observação (não tocar copilot) |
| Sem 2 | Sessão 1 + 2 (context-loader + prompt-builder) |
| Sem 3 | Sessão 3 + 4 (llm-client + state + dispatcher) |
| Sem 4 | Sessão 5 + 6 (search/rag/followup + orchestrator) |
| Sem 5 | Fase B2 — testes unit por módulo |
| Sem 6 | Fase B3 — feature flag agent_engine_v2 |
| Sem 7-8 | Fase B4 — piloto 1-2 orgs |
| Sem 9-10 | Fase B5 — rollout 100% (+60d soak) |

## Riscos identificados durante audit

1. **Funções referenciam state interno** (`this.currentLeadId`, `this.conversationContext`, `this.organizationId`) — mover requer passar por params explícitos. Refactor não-trivial em 30+ pontos.

2. **agent-engine.ts não tem testes hoje** — refactor sem teste = regressão potencial silenciosa. Estratégia: smoke test funcional após cada extração (criar lead + invoke agent-message dev + verificar resposta).

3. **Cold start** — adicionar 9 imports novos pode aumentar tempo cold start. Medir com Sentry transactions pós-rollout.

## Decisão pendente CTO

- **Iniciar Sessão 1 quando?** Após 1-2 semanas observando Onda 2 prod (recomendado).
- **Feature flag pra rollout?** Sim, planejado em Fase B3 (`copilot_engine_version`).
- **Critério rollback?** Latência p95 piora >20% OU error rate aumenta >5%.
