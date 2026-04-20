---
tags:
  - claude-code
  - feature
  - torque-crm
  - analytics
created: 2026-04-12
last_updated: 2026-04-17
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

### Semântica de receita (2026-04-17)

**Receita do mês / vendaTotal** = o que ENTROU no período, nunca o LTV contratado.

| Campo | Semântica | Fórmula |
|-------|-----------|---------|
| `vendaTotal` | Soma das vendas do período | `Σ sale_value` (sem multiplicar) |
| `vendaMRR` | MRR novo mensal no período | `Σ sale_value` WHERE `product_type='mrr'` |
| `vendaProjeto` | Valor de projetos no período | `Σ sale_value` WHERE `product_type='projeto'` |
| `vendaBaseAtiva` | Receita de clientes recorrentes | `Σ sale_value` WHERE is_repeat |
| `vendaPrimeiroPedido` | Receita de clientes novos | `Σ sale_value` WHERE NOT is_repeat |
| `ticketMedio` | Ticket médio das vendas do período | `vendaTotal / funnelVendas` |

**REGRA CRÍTICA**: NUNCA multiplicar `sale_value × contract_duration` em `vendaTotal`. Isso representa "valor total contratado" (LTV-like), semântica diferente. Se precisar desse campo, criar separado (ex.: `valorTotalContratado`).

**Contexto do bug**: migration `20260708000004` adicionou a multiplicação por engano confundindo LTV com receita do mês; `20260829400000` removeu; `20260911000000` regrediu; `20260417100000` corrige de vez.

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

- `src/pages/Dashboard.tsx` — Pagina principal com tabs
- `src/components/dashboard/TabVisaoGeral.tsx` — KPI cards
- `src/components/dashboard/TabPerformance.tsx` — Metricas individuais
- `src/components/dashboard/TabInteligencia.tsx` — Chat Oraculo IA
- `src/components/dashboard/TabAnalyticsV2.tsx` — Analytics avancado
- `src/components/dashboard/DashboardHeader.tsx` — Seletor mes/ano
- `src/components/dashboard/KPICard.tsx`, `MetricCard.tsx`, `SpeedometerGauge.tsx`, `FunnelChart.tsx`

### Hooks

- `useDashboardMetrics(month, year, filterMemberId?)` — RPC `get_dashboard_metrics`
- `useOraculoChat()` — Estado do chat IA
- `useTeamGoals(month, year)` — Metas do time

### Edge Functions

- `oraculo-comercial` — IA para tab Inteligencia

### Tabelas

- `goals` — Metas time/individual
- `leads`, `pipe_propostas`, `pipe_confirmacao` — Dados de vendas
- `oraculo_usage` — Rate limiting Oraculo

---

## Historico de mudancas

- **2026-04-17** — Fix "receita do mês" inflada: `vendaTotal`, `vendaBaseAtiva` e `vendaPrimeiroPedido` não multiplicam mais `sale_value × contract_duration` para MRR. Ver [[../../07 — Changelog/2026-04-17-receita-mes]] e migration `20260417100000_fix_receita_mes_mrr_contract_duration.sql`.

## Links relacionados

- [[Analytics Comercial]]
- [[Oraculo Comercial]]
- [[Performance]]
- [[Dashboard Outbound]]
