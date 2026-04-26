---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
  - master
  - observability
created: 2026-04-26
last_updated: 2026-04-26
status: active
---

# Automation Health

## O que faz

Dashboard **master-only** em `/master/automation-health` que centraliza visibility de saúde das automações: dead-letter jobs, workflows falhados, actions órfãs, webhooks circuit-broken, system alerts, audit log de mutations service_role, e toggle de feature flag copilot engine v1/v2.

Entregue em **Onda 2 Fase E** (2026-04-26) como resposta à dívida técnica de baixa visibility — antes operador descobria bug só quando cliente reclamava.

## Regras de negocio

- Acesso **master-only** (`MasterRoute` + `useMasterAuth`)
- 5 summary cards refetch automático 30s
- 7 tabs: Dead-Letter | Workflows | Stuck | Webhooks | Alerts | Audit | Engine
- Reprocess de jobs via edge function `reprocess-job` (suporta `pending_ai_action`, `workflow_execution`, `automation_job`)
- System alerts auto-resolvíveis pelo master (UPDATE `resolved_at`+`resolved_by`)
- Audit log filtrável por `table_name` + `operation` (INSERT/UPDATE/DELETE)
- Toggle Engine flipa `organizations.copilot_engine_version` v1↔v2

## Como o usuario usa

1. Login como master (Milennials)
2. Navegar `/master/automation-health` (item "Automation Health" sidebar com ícone Heart)
3. Cards no topo mostram contadores (alerta se >threshold colore vermelho/âmbar)
4. Tabs detalham cada categoria
5. Botão "Retry" / "Force retry" / "Resolver" / "Ativar v2" inline em cada row

---

## Como funciona (tecnico)

### Componentes

- `src/pages/master/MasterAutomationHealth.tsx` — página principal (7 tabs + 5 cards)
- `src/components/system-alerts/AlertsBanner.tsx` — banner reusable (usado em `/configuracoes/webhooks` + `/automacoes/.../execucoes`)
- Rota em `src/App.tsx`: `/master/automation-health` (lazy)
- Item nav `MasterSidebar` (ícone Heart)

### Hooks (src/hooks/useAutomationHealth.ts — 8 hooks)

- `useAutomationHealth` — stats agregadas 4 categorias (refetch 30s)
- `useDeadLetterJobs` — pending_ai_actions dead_letter últimos 7d
- `useFailedWorkflows` — workflow_executions failed + workflow.name JOIN
- `useStuckActions` — pending órfãs >1h
- `useCircuitBrokenWebhooks` — webhooks is_active=false
- `useSystemAlerts` (filter + opts) + `useResolveAlert` mutation
- `useReprocessJob` — invoca edge function reprocess-job
- `useAuditLog` — filtros table/op/range
- `useOrgsCopilotEngine` + `useToggleCopilotEngine` (B3 feature flag)

### Edge Functions

- `reprocess-job` — master-only (Bearer token + master_users check). Suporta 3 tipos:
  - `pending_ai_action` → status='pending', retry_count=0, next_retry_at=null
  - `workflow_execution` → status='running', updated_at=null
  - `automation_job` → status='retrying', next_retry_at=now()

### Tabelas

- `system_alerts` (Onda 2) — severity, category, source_type, source_id, title, message, metadata, resolved_at/resolved_by
- `audit_log` (Onda 2) — table_name, operation, row_id, organization_id, actor_role, actor_function, changes (JSONB diff em UPDATE)
- `runtime_logs` (Onda 2 cols) — duration_ms, prompt_tokens, completion_tokens, llm_model

### Fluxo de dados

```
Edge function (cron/webhook) → INSERT/UPDATE em leads/conversations/etc
  → Trigger audit_table_change (4 triggers ativos)
    → INSERT em audit_log (apenas service_role mutations)
      → Visualizado em tab Audit do dashboard

Edge function processo (process-webhook-deliveries):
  → Detecta circuit breaker (10 falhas consecutivas)
    → INSERT em system_alerts categoria='webhook_circuit_breaker'
      → Banner no /configuracoes/webhooks + tab Alerts dashboard

Edge function processo (retry-dead-letter-jobs cron):
  → detectDeadLetterPatterns (>=5 dead_letter por org+action_type/24h)
    → INSERT em system_alerts categoria='dead_letter_pattern'
      → Tab Alerts dashboard
```

---

## Historico de mudancas

- **2026-04-26**: Criado em Onda 2 Fase E. Backend (schema + 6 edge functions instrumentadas) + frontend (página + 8 hooks + banner reusable) deployed prod.

## Links relacionados

- [[Workflow Builder]]
- [[Webhooks]]
- [[Master Admin]]
- [[Copilot]]
- [[ADR-2026-04-26-trilha-3-unificacao-engines-refactor-copilot]]
