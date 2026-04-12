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

# Dashboard Outbound

## O que faz

Dashboard simplificado para membros de orgs outbound. Greeting personalizado, metricas chave (leads recebidos, taxa resposta, reunioes agendadas, vendas) com setas mes-a-mes. Badges de milestone com gamificacao.

## Regras de negocio

- Visivel apenas para membros de orgs com tipo outbound
- Badges desbloqueiam automaticamente ao atingir criterios
- Metricas comparam mes atual vs anterior (setas up/down)
- Milestone auto-unlock roda no load da pagina

## Como o usuario usa

1. Membro de org outbound ve este dashboard ao logar
2. Greeting com nome do membro
3. Cards de metricas com comparacao mensal
4. Grid de badges (locked/unlocked) com progresso

---

## Como funciona (tecnico)

### Componentes

- `src/pages/DashboardOutbound.tsx` — Pagina
- `src/components/dashboard-outbound/OutboundMetricCards.tsx` — Cards de metricas
- `src/components/dashboard-outbound/MilestoneTracker.tsx` — Tracker de milestones
- `src/components/dashboard-outbound/BadgeGrid.tsx` — Grid de badges

### Hooks

- `useOutboundMetrics()` — Metricas atual + anterior
- `useBadges()` — Badges disponiveis da org
- `useUserBadges(teamMemberId)` — Badges do usuario
- `useMilestoneAutoUnlock()` — Auto-unlock no load

### Tabelas

- `badges` — criteria_type, criteria_value, icon, is_system
- `user_badges` — badge_id, team_member_id, unlocked_at
- `leads`, `pipe_confirmacao`, `pipe_propostas` — Metricas

---

## Historico de mudancas

## Links relacionados

- [[Dashboard]]
- [[Premiacoes]]
