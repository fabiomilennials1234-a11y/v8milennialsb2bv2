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

# Ranking

## O que faz

Leaderboard realtime por vendas (MRR/Projeto) ou reunioes agendadas. Top 3 com icones (Crown, Medal, Award). Atualiza via realtime subscription em pipe_propostas.

## Regras de negocio

- Duas metricas: vendas (receita) e reunioes (confirmadas)
- Top 3 tem icones especiais e destaque visual
- Atualiza em tempo real quando proposal muda de status
- Filtro por mes/ano

## Como o usuario usa

1. Performance → Tab Ranking (ou /ranking redireciona)
2. Seleciona mes/ano
3. Ve podio (top 3) + lista completa
4. Pode ver historico de ranking

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Ranking.tsx` - Redirect para /performance
- `src/components/ranking/RankingHistoryChart.tsx` - Tendencias historicas

### Hooks

- `useRankingData(month, year)` - RPC `get_ranking_data`, retorna salesRanking[] e meetingsRanking[]
- `useDashboardMetrics()` - Progresso individual
- `useAvatarMap()` - Avatares dos membros

### Tabelas

- `pipe_propostas`, `pipe_confirmacao`, `leads`, `goals`

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Metas]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[Performance]]
- [[Dashboard]]
