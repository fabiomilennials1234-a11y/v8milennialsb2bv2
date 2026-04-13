---
tags:
  - claude-code
  - feature
  - torque-crm
  - admin
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Master Admin

## O que faz

Super-panel (master only) com 5 views: Orgs dashboard, Users management, Audit Logs, Operations Center (runtime logs, job status, error rates), Features toggle. Governa todo o sistema.

## Regras de negocio

- Apenas usuarios com registro em `users_master`
- Invisivel para clientes
- Pode criar/editar/desativar orgs e usuarios cross-org
- Audit log filtravel por user/org/action/date
- Operations Center monitora edge functions, cron jobs, e uso por org

## Como o usuario usa

1. Login com conta master
2. Dashboard mostra KPIs gerais (total orgs, users, revenue)
3. Organizacoes: lista, busca, edita, desativa
4. Users: gestao cross-org
5. Audit Logs: historico de acoes
6. Operations: runtime logs, job status, usage by org
7. Features: toggle features globais ou por org

---

## Como funciona (tecnico)

### Componentes

- `src/pages/master/MasterDashboard.tsx` — Overview
- `src/pages/master/MasterOrganizations.tsx` — Orgs
- `src/pages/master/MasterUsers.tsx` — Users
- `src/pages/master/MasterAuditLogs.tsx` — Audit
- `src/pages/master/MasterFeatures.tsx` — Feature flags
- `src/pages/master/MasterOperations.tsx` — 3 tabs (Overview, Runtime Logs, Usage by Org)
- `src/components/master/ApiStatusTab.tsx` — Health status

### Hooks

- `useMasterAuth()` — Verifica master status
- `useMasterOperations()`:
  - `useOperationsOverview(interval)` — Stats 24h/7d/30d
  - `useRuntimeLogs()` — Logs de edge functions
  - `useUsageByOrg()` — Uso por org
  - `useJobsOverview()` / `useAutomationJobs()` — Status de jobs
  - `useRetryDeadLetter()` — Retry jobs falhos
- `useMasterPlans()` — CRUD de planos
- `useMasterAuditLogs()` — Query audit logs
- `useMasterOrganizations()` — CRUD orgs

### Tabelas

- `users_master` — Registros master admin
- `organizations` — Todas as orgs
- `team_members` — Todos os membros
- `runtime_logs` — module, action, status, error_message, payloadSnapshot
- `organization_audit_logs` — Audit trail por org
- `subscription_plans` — Gestao de planos

---

## Historico de mudancas

## Links relacionados

- [[Permissoes Sistema]]
- [[Configuracoes]]
