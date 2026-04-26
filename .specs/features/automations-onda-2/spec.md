# Onda 2 — Visibility (observabilidade operacional)

**Created:** 2026-04-26
**Scope:** Large
**Owner:** Backend + Frontend + DBA
**Estimate:** ~25h (3-4 dias úteis 1 dev)
**Source:** Revisão arquitetural automações 2026-04-26
**Depends on:** Onda 1 deve estar deployada (precisa dos logs estruturados)

## Contexto

Hoje o user só descobre que algo quebrou quando o cliente reclama. `runtime_logs` é populado mas sem dashboard. `automation_jobs.dead_letter` invisível. `workflow_executions.failed` enterrado em SQL. Sem alert, sem trend, sem latência.

Onda 2 transforma o dado já coletado em telemetria operacional acessível ao user e ao admin master.

## Goals

- Master admin enxerga em 1 tela: dead_letter pendentes, workflows falhando, copilots com fail rate alto
- Org admin enxerga por que workflow específico falhou em UI (não SQL)
- Latência + tokens LLM logados em runtime_logs → habilita análise de custo + performance
- Webhook circuit breaker dispara alert ao admin quando endpoint morre
- Mutações via service_role auditadas (compliance + debug)

## Non-goals

- Alert externo (Slack/email/PagerDuty) — apenas in-app
- APM completo (Datadog/Sentry tracing) — ficar com Sentry atual
- Métricas de produto (handled by analytics existente)

## Requisitos rastreáveis

**REQ-O2.1** — Master admin tem página `/master/automation-health` que lista:
- Top dead_letter por action_type (últimos 7d)
- Workflows com fail_rate > 20% (últimos 7d) por org
- pending_ai_actions órfãs > 1h
- Webhooks com `consecutive_failures >= 5`
- Botão "reprocess" em cada item

**REQ-O2.2** — Cada `runtime_logs` entry de operação custosa (LLM call, edge function long) tem `duration_ms`, `prompt_tokens`, `completion_tokens` em `payload_snapshot`.

**REQ-O2.3** — Org admin tem aba "Erros" em `/automacoes` que lista `workflow_executions` failed, com:
- Nome do workflow, lead afetado, timestamp
- Step que falhou + error message
- Botão "retry" (re-claim execution)

**REQ-O2.4** — Quando webhook atinge `consecutive_failures = 10`, sistema marca `is_active = false` automaticamente e cria entry em `system_alerts` (tabela nova) visível em `/configuracoes/webhooks` com banner.

**REQ-O2.5** — Toda mutação (INSERT/UPDATE/DELETE) feita por role `service_role` em tabelas críticas (`leads`, `conversations`, `pending_ai_actions`, `workflow_executions`) é registrada em `audit_log` (tabela nova) com timestamp + edge function name + diff.

## Métricas de sucesso

| Métrica | Target |
|---|---|
| Tempo médio para detectar bug em produção | <2h (hoje: dias) |
| % de tickets com diagnóstico antes do dev tocar código | >50% |
| dead_letter sendo reprocessadas | >70% recuperadas em 7d |

## Riscos

- **R1:** Audit log em hot tables gera carga (4 tabelas × insert/update). Mitigar: trigger leve com `pg_notify` opcional, batch async.
- **R2:** Auto-disable webhook pode mascarar bug real. Mitigar: alert visível + log obrigatório, não silencioso.
