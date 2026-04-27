# Trilha 3 — Estratégica: unificação engines + refactor copilot

**Created:** 2026-04-26
**Scope:** Complex
**Owner:** Architect + Backend + DBA + AI + Frontend
**Estimate:** 4-8 semanas (2 sub-features paralelas)
**Depends on:** Onda 1 + Onda 2 deployadas e estáveis
**Source:** Revisão arquitetural automações 2026-04-26

## Contexto

Após estabilizar com Ondas 1 + 2, atacamos as 2 dívidas estruturais:

1. **3 engines de automação paralelos** (workflows + pipe_rules + campaign_rules) — 3 codebases, 3 cron, UX confusa "qual usar?"
2. **Copilot monolítico de 3314 LOC** em 1 arquivo (`agent-engine.ts`) sem testes isolados, com hot path complexo difícil de evoluir

Reescrita do zero rejeitada (~6-10 semanas, alto risco de regressão, 30 orgs em produção). Caminho: **refactor cirúrgico em fases com feature flag** + **unificação por absorção** (não big-bang).

## Sub-features

### Sub-feature 3.A — Unificação de engines

Transformar workflow engine em **única fonte de execução**. Pipe rules e campaign rules viram **macros visuais** que compilam para workflows internamente.

### Sub-feature 3.B — Refactor copilot em 5 fases

Quebrar `agent-engine.ts` em módulos testáveis. Introduzir `agent_engine_v2` com feature flag por org. Validar com 1-2 orgs piloto antes de rollout completo.

## Goals (Sub-feature 3.A)

- 1 engine de execução (workflow_executor) processa pipe sequences + campaign cadences
- UI de pipe rules e campaign rules **mantém UX simples** (não força user a aprender DAG)
- Migration converte regras existentes em workflows equivalentes (idempotente, reversível)
- `pipe-rule-dispatch` e `campaign-rule-dispatch` cron jobs **deprecados** após validação
- Bug fix em send_template = 1 lugar, não 3

## Goals (Sub-feature 3.B)

- `agent-engine.ts` < 500 LOC por módulo
- Cobertura de teste unit > 70% nos módulos novos
- Latência p95 do agent-message reduz ≥30%
- Custo LLM monitorado por org/agent (com Onda 2 já habilitando isso)
- Bugs identificados em revisão (race, validação fraca, sem timeout) eliminados estruturalmente

## Non-goals

- Mudar modelo LLM (continua OpenRouter + Gemini)
- Reescrever RAG (pgvector + HNSW está OK)
- Mudar provider WhatsApp (mantém adapter Uazapi/Evolution)
- Migração big-bang sem rollback

## Requisitos rastreáveis

### Sub-feature 3.A — Unificação

**REQ-T3A.1** — `workflow_executor` deve suportar nodes especializados de pipe sequences (`send_template + wait_response + change_stage + assign_sdr + cancel_sequence`) e campaign cadences (`send_template + delay`).
- Aceitação: workflow definido com esses nodes executa equivalente ao engine atual

**REQ-T3A.2** — UI de pipe rules e campaign rules deve **gerar workflows internamente** sem expor builder visual.
- Aceitação: user cria/edita pipe rule via UI atual; backend persiste em `workflows` (com flag `wrapper_for: pipe_rule`); `pipe_dispatch_rules` continua existindo apenas como view ou cache

**REQ-T3A.3** — Migration converte 100% das regras existentes (`pipe_dispatch_rules` + `campanha_dispatch_rules`) em workflows funcionais.
- Aceitação: query verifica que cada regra tem workflow correspondente; smoke test dispara cada um sem erro

**REQ-T3A.4** — Cron `pipe-rule-dispatch` e `campaign-rule-dispatch` removidos após 30 dias de validação.
- Aceitação: jobs ausentes em `cron.job` em prod

**REQ-T3A.5** — Documentação atualizada (Obsidian features Pipe Rules + Campanhas + Workflow Builder) reflete arquitetura única.

### Sub-feature 3.B — Refactor Copilot

**REQ-T3B.1** — `agent-engine.ts` decomposto em módulos:
- `_shared/copilot/context-loader.ts` — loadConversationContext + loadCapabilities + cache
- `_shared/copilot/prompt-builder.ts` — buildDynamicPrompt + buildDynamicTools + size limits
- `_shared/copilot/llm-client.ts` — chamadas OpenRouter com retry + timeout + token tracking
- `_shared/copilot/sanitizer.ts` — message sanitization + recovery (já existe parcial)
- `_shared/copilot/dispatcher.ts` — enqueue actions + state transitions
- `_shared/copilot/state-machine.ts` — determineNextState + transições
- Aceitação: cada módulo < 500 LOC, exporta interface clara

**REQ-T3B.2** — Cada módulo tem suíte de teste unit (Vitest com mock supabase).
- Aceitação: `npm run test:unit` passa com cobertura >70% nos módulos novos

**REQ-T3B.3** — `agent_engine_v2` rodando em paralelo via feature flag `organizations.copilot_engine_version` (default `v1`).
- Aceitação: 1 org piloto roda v2 sem regressão por 2 semanas

**REQ-T3B.4** — v2 elimina bugs estruturais identificados:
- Cache de capabilities (não 1 query/msg)
- Timeout duro em loadConversationContext
- buildDynamicPrompt com truncagem auditada (max tokens configurável)
- Tool calls validados via Zod
- updateConversationState via RPC atomic (Onda 1 já fez parcial)
- Aceitação: code review confirma cada item

**REQ-T3B.5** — Métricas v2 vs v1 lado a lado:
- Latência p50/p95/p99 do processMessage
- Tokens consumidos por mensagem
- % de mensagens com erro
- Aceitação: dashboard `/master/copilot-engine-comparison` mostra deltas

**REQ-T3B.6** — Rollout 100% após 30 dias de validação. v1 mantida por mais 30 dias como fallback. Removida no dia 60.

## Métricas de sucesso

### 3.A
| Métrica | Baseline | Target |
|---|---|---|
| Engines de automação | 3 | 1 |
| Cron jobs de execução | 3 (1min cada) | 1 (1min) |
| LOC duplicada (estimativa: action handlers) | ~800 | <100 |
| Tempo médio de fix em pipe rule bug | ~8h | <2h |

### 3.B
| Métrica | Baseline | Target |
|---|---|---|
| LOC `agent-engine.ts` | 3314 | < 500 (entry point apenas) |
| Cobertura teste unit copilot | <10% | >70% |
| Latência p95 agent-message | ? (medir Onda 2) | -30% |
| Bugs estruturais ativos | 6 (C2, C3, A1, A3, A4, A6 antes Onda 1) | 0 |

## Riscos

- **R1 (3.A):** Migration de regras existentes pode quebrar automações ativas em 30 orgs. Mitigar: dry-run em dev, validação por org, kill-switch `force_legacy_engine` por org.
- **R2 (3.A):** Workflow engine atual não suporta wait_response com timeout exato como pipe rules. Pode requerer nodes novos. Estimativa pode subir.
- **R3 (3.B):** Refactor introduz bug sutil em uma das 5 fases. Mitigar: feature flag por org, rollback instantâneo.
- **R4 (3.B):** Time pequeno (1 dev junior). Architect + AI agents devem dispatchar tasks, não delegar implementação inteira.
- **R5:** Trilha 3 longa (8 semanas) compete com features de produto. CTO define janela explícita ou aceita trabalho pausado.

## Decisão pendente CTO

Priorizar 3.A ou 3.B primeiro? Recomendação: **3.B primeiro** (copilot quebra mais, gera tickets), 3.A depois (engines duplicados são dívida silenciosa, não causam ticket diário).

Outra opção: **paralelo** (3.A e 3.B em trilhas separadas) se Architect + AI agents podem operar isolados com 1 dev cada.
