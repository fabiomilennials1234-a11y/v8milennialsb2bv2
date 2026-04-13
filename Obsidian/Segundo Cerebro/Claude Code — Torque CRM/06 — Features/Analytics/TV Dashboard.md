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

# TV Dashboard

## O que faz

Dashboard fullscreen para TV de escritorio. Metricas grandes, ranking simplificado, funil de vendas, AI Coach, competicao ativa com premios. Auto-refresh e toggle fullscreen.

## Regras de negocio

- Designed para TVs grandes (fontes grandes, layout limpo)
- Auto-refresh periodico
- Fullscreen toggle
- AI Coach powered by Oraculo
- Competicao ativa com premios e participantes

## Como o usuario usa

1. Acessa /tv no browser
2. Clica fullscreen para tela cheia
3. TV mostra metricas, ranking, funil, competicao em tempo real
4. Auto-atualiza sem intervencao

---

## Como funciona (tecnico)

### Componentes

- `src/pages/TVDashboard.tsx` — Pagina fullscreen
- `src/components/tv/TVMetricsGrid.tsx` — KPI cards grandes
- `src/components/tv/TVRankingSimple.tsx` — Ranking simplificado
- `src/components/tv/SalesFunnel.tsx` — Funil de vendas visual
- `src/components/tv/AICoachSection.tsx` — Insights IA
- `src/components/tv/TVCompetitionBlockV2.tsx` — Competicao ativa

### Hooks

- `useTVDashboardData()` — Agrega todos os dados em paralelo
- `useActiveCompetition(month, year)` — Competicao atual
- `useCompetitionParticipants()` / `useCompetitionPrizes()` — Detalhes
- `useRankingData()` — Leaderboard

### Tabelas

Todas as core: leads, pipe_propostas, pipe_confirmacao, goals, competitions, team_members

---

## Historico de mudancas

## Links relacionados

- [[Dashboard]]
- [[Ranking]]
- [[Performance]]
