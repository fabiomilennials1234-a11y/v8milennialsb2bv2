---
tags:
  - claude-code
  - feature
  - torque-crm
  - analytics
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Dashboard

## O que faz

Dashboard principal com 4 tabs: Visao Geral (KPIs), Performance (metricas individuais), Inteligencia (Oraculo IA chat), Analytics (comercial avancado, master only). KPIs: total leads, reunioes, receita, conversao, no-show. Filtro por mes/ano e membro.

## Regras de negocio

- Admin ve org inteira, membro ve so seus dados
- Oraculo IA chat na tab Inteligencia com rate limiting
- Tab Analytics visivel apenas para master admins
- Metricas via RPC `get_dashboard_metrics` (server-side aggregation)

## Como o usuario usa

1. Dashboard e a pagina inicial apos login
2. Seleciona mes/ano no header
3. Navega entre tabs: Visao Geral, Performance, Inteligencia, Analytics
4. Admin pode filtrar por membro especifico

## Edge cases

- Org nova sem dados mostra KPIs zerados
- Oraculo rate-limited mostra mensagem amigavel
- Membro sem leads atribuidos ve metricas vazias

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Dashboard.tsx` - Pagina principal com tabs
- `src/components/dashboard/TabVisaoGeral.tsx` - KPI cards
- `src/components/dashboard/TabPerformance.tsx` - Metricas individuais
- `src/components/dashboard/TabInteligencia.tsx` - Chat Oraculo IA
- `src/components/dashboard/TabAnalyticsV2.tsx` - Analytics avancado
- `src/components/dashboard/DashboardHeader.tsx` - Seletor mes/ano
- `src/components/dashboard/KPICard.tsx`, `MetricCard.tsx`, `SpeedometerGauge.tsx`, `FunnelChart.tsx`

### Hooks

- `useDashboardMetrics(month, year, filterMemberId?)` - RPC `get_dashboard_metrics`
- `useOraculoChat()` - Estado do chat IA
- `useTeamGoals(month, year)` - Metas do time

### Edge Functions

- `oraculo-comercial` - IA para tab Inteligencia

### Tabelas

- `goals` - Metas time/individual
- `leads`, `pipe_propostas`, `pipe_confirmacao` - Dados de vendas
- `oraculo_usage` - Rate limiting Oraculo

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Master Admin]]

- [[Metas]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Analytics Comercial]]
- [[Oraculo Comercial]]
- [[Performance]]
- [[Dashboard Outbound]]
