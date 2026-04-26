---
date: 2026-04-26
tags: [adr, architecture, copilot, workflows, refactor]
status: accepted
agents: [Architect, Backend, AI, DBA]
---

# ADR 2026-04-26 — Trilha 3: unificação engines (3.A) + refactor copilot (3.B)

## Contexto

Revisão arquitetural das automações revelou 2 dívidas estruturais:

1. **3 engines de automação paralelos** (workflows + pipe_rules + campaign_rules). Mesma capability triplicada. Bug fix em 3 lugares. UX confusa pro user.

2. **agent-engine.ts monolítico** (3314 LOC em 1 arquivo). Zero testes. Hot path complexo difícil de evoluir. Dev junior demora pra entender.

## Decisão

### 3.A — Unificação de engines (absorção, não big-bang)

Workflow engine vira **fonte única**. Pipe rules + campaign rules viram **macros visuais** que **internamente** geram workflows.

**Estratégia em 4 fases:**
- **A1** workflow engine ganha capabilities-equivalentes (auditadas em T3A-A1-AUDIT.md — 90% já cobertas)
- **A2** dispatchers (`pipe-rule-dispatch`, `campaign-rule-dispatch`) viram thin shims que cancelam items pendentes de rules com wrapper. Workflow engine assume processamento.
- **A3** migration converte rules ativas em wrapper workflows (idempotente, try/except por rule)
- **A4** após 30d soak: drop crons + tabelas legadas

**UI não muda pro user.** Continua criando "regra de pipe" do mesmo jeito. Backend persiste em `workflows` com flag `wrapper_for='pipe_rule'`.

### 3.B — Refactor copilot (cirúrgico, com feature flag)

Quebrar `agent-engine.ts` em **9 módulos** sob `_shared/copilot/`. Cada módulo com responsabilidade única, testável isoladamente.

**Estratégia em 5 fases:**
- **B1** extrair funções pure (loadCapabilities, determineNextState, buildIdempotencyKey, etc)
- **B2** test suite unit por módulo
- **B3** feature flag `organizations.copilot_engine_version` v1/v2
- **B4** piloto 1-2 orgs em v2 (quando v2 divergir)
- **B5** rollout 100% + cleanup v1

**Decisão arquitetural — buildDynamicPrompt + buildDynamicTools ficam em agent-engine.ts** como orchestrator methods. Dependem state interno (this.conversationContext, this.incomingMessageType, this.currentLeadId, this.supabase). Tornar pure aumentaria boilerplate sem ganho funcional.

## Alternativas consideradas

### A.1 — Big-bang unificação

Substituir pipe_rule_dispatch + campaign_rule_dispatch por workflow engine de uma vez, migrar todas rules em transação única.

**Rejeitado:** risco alto (toca path crítico envio em 30 orgs simultaneamente). Sem rollback fácil. Pequeno bug = todas as orgs paradas.

### A.2 — Manter 3 engines, apenas centralizar action handlers

Refatorar handlers comuns (`send_template`, `move_stage`, etc) em módulo compartilhado. 3 dispatchers continuam coexistindo.

**Rejeitado:** não resolve problema raiz (UX confusa, manutenção 3x, bugs latentes triplicados). Apenas mascara dívida.

### B.1 — Reescrever copilot do zero

Nova arquitetura limpa, mover dado/configuração de v1, deprecate v1 quando v2 estável.

**Rejeitado:** 30 orgs em produção com 6 meses de tribal knowledge (edge cases, ajustes finos). Reescrever = redescobrir tudo sofrendo em prod. 6-10 semanas de risco alto vs refactor cirúrgico de 4 sessões com risco zero.

### B.2 — Refactor mas manter monolito

Adicionar testes ao agent-engine.ts atual, sem extrair funções.

**Rejeitado:** testar funções com state interno requer mock AgentEngine inteira. Funções pure são fáceis de testar isoladas. Sem extração, cobertura permanece baixa.

## Consequências

### Positivas

- **47k+ erros/30d eliminados** (Onda 1 dependeu de RPCs/cols criadas pela Trilha 3)
- **Cache LRU em loadCapabilities** = 1 query Supabase economizada por mensagem em burst
- **17 funções pure testáveis** = cobertura 100% módulos pure (88 tests)
- **1 motor de execução** futuro (após A4 soak) = manutenção 3x → 1x
- **Feature flag preparada** = canary testing futuro sem redeploy
- **agent-engine.ts -14.7% LOC** com responsabilidades claras
- **Telemetria perf granular** (Onda 2) = visibility custo LLM por org

### Negativas

- **buildDynamic* (1210 LOC) permanecem em agent-engine** — não atinge target arbitrário <300 LOC orchestrator
- **A4 soak 30d obrigatório** — tabelas legadas e crons antigos coexistem com wrappers nesse período
- **Drift histórico migrations local↔prod** — 14 migrations remotas legítimas que precisam reconciliação futura via `db pull` + `migration repair`
- **45 cron 401 residual** pós-fix process-scheduled-user-messages (40% redução, débito separado)

### Métricas de sucesso pós 24h

| Métrica | Antes | Depois |
|---|---|---|
| Erros lead_origin web | 24.4k/30d | 0 ✅ |
| Erros outbound_dispatch_log | 11.7k/30d | 0 ✅ |
| Erros Tipo de ação desconhecido | 10.9k/30d | 0 ✅ |
| Drift transfer (Onda 1 P0.4) | 125 | 0 ✅ |
| pg_net 401 (Onda 1 fix) | 75/30min | 45/30min (-40%) |
| Wrapper workflows ativos | 0 | 1 (campaign rule) |
| audit_log mutations capturadas | tabela inexistente | 146/30min ✅ |
| Test coverage copilot | 0 | 88 tests (100% pure functions) |

## Implementação

13 migrations (`20260426000000` → `20260426050000` + Onda 2 `20260426010000-2` + flag `20260426030000` + Trilha 3.A `20260426040000-50000`).

9 edge functions deployed (`agent-message`, `process-ai-actions`, `process-workflow-executions`, `outbound-trigger`, `process-webhook-deliveries`, `retry-dead-letter-jobs`, `pipe-rule-dispatch`, `campaign-rule-dispatch`, `reprocess-job`).

8 RPCs novas + 4 triggers audit + 2 tabelas + 11 cols agregados.

Frontend: 1 página `/master/automation-health` (7 tabs) + 8 hooks + 1 component banner reusable.

## Status

✅ **A1+A2+A3+B1+B2+B3 deployados em prod 2026-04-26.** Sistema operando normal. 30 orgs servidas sem incidente. Stress test em org isolada confirmou comportamento sob carga real (200 paralelas race idempotency, 500 wf execs per-org cap, etc).

⏳ **A4 cleanup** após 30d soak natural.
⏳ **B4 piloto + B5 rollout** quando v2 divergir funcionalmente de v1 (hoje idênticos).

## Links relacionados

- [[2026-04-26-trilha-3-completa]] — changelog detalhado
- `.specs/features/automations-trilha-3/T3A-A1-AUDIT.md` — audit capabilities workflow vs pipe/campaign
- `.specs/features/automations-trilha-3/T3B-EXECUTION-LOG.md` — plano sessões refactor
- `.specs/features/automations-trilha-3/T3B-FINAL-REPORT.md` — relatório final B1
