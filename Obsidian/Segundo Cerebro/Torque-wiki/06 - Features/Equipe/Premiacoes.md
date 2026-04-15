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

# Premiacoes

## O que faz

Awards com thresholds metricas (ex: 100K receita = Bonus), badges gamificacao com celebration animations. Tipos: meta_mensal, campeonato, bonus, especial. Confetti animation ao desbloquear.

## Regras de negocio

- Awards podem ter month/year scope (null = permanente)
- Prize value e descricao opcionais
- Badge unlock automatico em Outbound orgs via milestone criteria
- Celebration com confetti animation no unlock
- Admin configura awards e badges

## Como o usuario usa

1. Performance → Tab Premiacoes
2. Ve awards disponiveis com progresso
3. Awards desbloqueados mostram com animacao
4. Admin pode criar/editar/deletar awards

---

## Como funciona (tecnico)

### Componentes

- `src/pages/Premiacoes.tsx` - Redirect para Performance
- `src/components/gamification/AchievementBadge.tsx` - Badge locked/unlocked
- `src/components/gamification/CelebrationEffect.tsx` - Confetti
- `src/components/gamification/ProgressRing.tsx` - Progresso circular
- `src/components/gamification/LeaderboardCard.tsx` - Top 3

### Hooks

- `useAwards(month?, year?)` - Awards com thresholds
- `useCreateAward()` / `useUpdateAward()` / `useDeleteAward()` - CRUD admin
- `useBadges()` - Badges da org (outbound)
- `useUserBadges()` - Badges do usuario
- `useMilestoneAutoUnlock()` - Auto-unlock no load

### Tabelas

- `awards` - name, type (meta_mensal/campeonato/bonus/especial), description, threshold, prize_description, prize_value, month, year, is_active
- `badges` - name, criteria_type, criteria_value, icon, is_system
- `user_badges` - badge_id, team_member_id, unlocked_at

---

## Historico de mudancas

## Links relacionados

- [[00 - INDEX]]
- [[MOC - Features]]

- [[Dashboard]]

- [[Performance]]
- [[Dashboard Outbound]]
- [[Ranking]]
