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

# Performance

## O que faz

Pagina unificada com 4 tabs: Ranking (leaderboard realtime), Metas (progresso individual/time), Premiacoes (badges e awards), Gestao de Metas (CRUD admin). Combina gamificacao, tracking de metas, e ranking num unico lugar.

## Regras de negocio

- Ranking atualiza via realtime subscription em pipe_propostas
- Metas tem expected progress (dia atual / dias no mes * target)
- Awards desbloqueiam ao atingir threshold
- Gestao de Metas visivel apenas para admins
- Competicoes tem periodo, participantes, e premios

## Como o usuario usa

1. Performance no menu lateral
2. Tab Ranking → ve leaderboard (vendas ou reunioes)
3. Tab Metas → ve progresso individual e do time
4. Tab Premiacoes → ve awards ganhos com animacao
5. Tab Gestao → admin cria/edita metas e awards

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Performance.tsx` — Pagina com 4 tabs
- `CompetitionPodiumV2.tsx` — Top 3 com icones (Crown, Medal, Award)
- `CompetitionRankingListV2.tsx` — Lista completa do ranking
- `GoalProgress.tsx` — Barra de progresso com expected vs actual
- `AchievementBadge.tsx` — Badge locked/unlocked
- `CelebrationEffect.tsx` — Confetti animation
- `ProgressRing.tsx` — Progresso circular

### Hooks

- `useRankingData(month, year)` — RPC `get_ranking_data`
- `useTeamGoals()` / `useIndividualGoals()` — Metas
- `useAwards()` — Awards com thresholds
- `useCompetitions()` — Competicoes ativas
- CRUD: `useCreateGoal()`, `useUpdateGoal()`, `useDeleteGoal()`, `useCreateAward()`, `useUpdateAward()`, `useDeleteAward()`

### Tabelas

- `goals` — type, target_value, current_value, month, year, team_member_id
- `awards` — type (meta_mensal/campeonato/bonus/especial), threshold, prize_value, month, year
- `competitions` — metric_type, start_date, end_date, status
- `competition_participants` — competition_id, team_member_id

---

## Historico de mudancas

## Links relacionados

- [[Dashboard]]
- [[Ranking]]
- [[Metas]]
- [[Premiacoes]]
