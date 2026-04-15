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

# Analytics Comercial

## O que faz

Analytics avancado para master admins. Member stats (leads handled, propostas, wins, receita, avg ticket), loss reasons distribution, origin quality (conversao e ticket por source). Filtros por data, membro, e origem.

## Regras de negocio

- Visivel apenas para master admins (TabAnalyticsV2)
- Dados via RPC `get_analytics_commercial_metrics` (server-side)
- Filtros persistem na URL para compartilhamento

## Como o usuario usa

1. Dashboard → Tab Analytics (master only)
2. Seleciona periodo, membro, origem nos filtros
3. Ve secoes: Receita, Equipe, Pipeline, Aquisicao
4. Drill-down por membro ou origem

---

## Como funciona (tecnico)

### Componentes

- `src/components/analytics/tabs/` - Tabs de analytics
- `src/components/analytics/AnalyticsFilters.tsx` - Filtros
- `src/components/analytics/sections/ReceitaSection.tsx` - Receita
- `src/components/analytics/sections/EquipeSection.tsx` - Performance do time
- `src/components/analytics/sections/PipelineSection.tsx` - Pipeline
- `src/components/analytics/sections/AquisicaoSection.tsx` - Aquisicao

### Hooks

- `useAnalyticsComercial()` - RPC `get_analytics_commercial_metrics`, retorna member_stats, loss_reasons, origin_quality
- `useAnalyticsFilters()` - Gerencia filtros (data, membro, origem)

### Tabelas

- `leads`, `pipe_propostas` - Dados core
- `team_members` - Stats por membro
- `products` - Tipo (MRR vs Projeto)

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Produtos]]

- [[Master Admin]]

- [[Gestao de Time]]

- [[Pipe Propostas]]

- [[Dashboard]]
- [[Analytics UTMs]]
