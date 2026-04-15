---
tags:
  - claude-code
  - feature
  - torque-crm
  - equipe
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Metas

## O que faz

Goals mensais de time e individuais (faturamento, novos clientes, reunioes, conversao). Progress bars com expected vs actual baseado no dia do mes.

## Regras de negocio

- Goals podem ser team-level (team_member_id null) ou individual
- Expected progress = (dia atual / dias no mes) * target_value
- Tipos de meta: faturamento, novos clientes, reunioes confirmadas, taxa de conversao
- Admin configura no tab Gestao de Metas da pagina Performance

## Como o usuario usa

1. Performance → Tab Metas
2. Ve metas do time com progress bars
3. Ve metas individuais com comparacao expected vs actual
4. Top 3 tem icones de posicao (Crown, Medal, Award)

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Metas.tsx` / `src/pages/GestaoMetas.tsx` - Paginas (redirect para Performance)
- `src/components/dashboard/GoalProgress.tsx` - Barra de progresso

### Hooks

- `useTeamGoals(month, year)` - Metas do time
- `useIndividualGoals(month, year)` - Metas por membro
- `useGoals(month?, year?)` - Query generica
- `useCreateGoal()` / `useUpdateGoal()` / `useDeleteGoal()` - CRUD admin
- `useDashboardMetrics(month, year)` - Current values para calculo de progresso

### Tabelas

- `goals` - name, type, target_value, current_value, month, year, team_member_id (null=team), organization_id

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Performance]]
- [[Dashboard]]
- [[Gestao de Time]]
