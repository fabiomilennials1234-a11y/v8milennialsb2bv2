# Module — engagement

**Status:** 🟡 Skeleton (slice 11 popula)
**BC:** engagement
**Entidade primária:** Checklist + Activity + Follow-up + Agenda Event + Gamification
**Owner:** ops / vendas

## Escopo

Engajamento dos vendedores com o sistema. Inclui:

- **Checklists** — itens repetitivos por vendedor (ex. revisar leads abandonados)
- **Activities** — log de atividade (ligações, msgs, reuniões)
- **Follow-ups** — agendamento de toque futuro
- **Agenda** — calendário unificado (reuniões + follow-ups + msgs agendadas + confirmações)
- **Call Logs** — registro de ligações (manual ou via API telefonia)
- **Gamification** — badges, awards, competitions, ranking, premiações, comissões
- **Daily Priorities** — fila do dia ("ações do dia")
- **Coaching Suggestions** — IA sugere áreas de melhoria pro vendedor
- **Performance** — KPIs por vendedor (closer + SDR)

## Não-escopo

- Performance da org como um todo → `analytics`
- Configuração de quotas/seats da org → `identity`
- Comissões = engajamento financeiro do vendedor (incluir aqui), mas folha de pagamento NÃO existe no Torque

## API pública (`index.ts`) — TBD slice 11

Provável superfície:
- Hooks: `useChecklists`, `useChecklistTemplates`, `useActivities`, `useFollowUps`, `useAgendaEvents`, `useMeetings`, `useCallLogs`, `useAcoesDoDia`, `useDailyPriorities`, `useNextBestActions`, `useCoachingSuggestions`, `useAwards`, `useBadges`, `useCompetitions`, `useCommissions`, `useGoals`, `useMilestoneAutoUnlock`, `useRecentActivity`, `useRecentItems`, `useSellerActivity`, `useCloserPerformance`, `useSDRPerformance`, `useVendedorRanking`, `useRankingTransitions`
- Components: `<AgendaCalendar>`, `<ActivityFeed>`, `<ChecklistPage>`, `<BadgeShowcase>`
- Types: `Activity`, `FollowUp`, `Badge`, `Competition`
- Eventos (post slice 19): `activity.logged`, `followup.scheduled`, `meeting.created`, `badge.earned`

## Áreas frágeis

- Agenda timezone — operações multi-timezone
- Activity log: explosão de eventos por lead
- Gamification: regras de unlock — quando exatamente dispara badge?

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/agenda/`, `activities/`, `followups/`, `checklists/`, `calls/`
- `src/components/gamification/`, `badges/`, `ranking/`, `comissoes/`
- `src/hooks/useChecklist*.ts`, `useActivities.ts`, `useFollowUps.ts`, `useAgendaEvents.ts`, `useMeetings.ts`, `useCallLogs.ts`
- `src/hooks/useAcoesDoDia.ts`, `useDailyPriorities.ts`, `useNextBestActions.ts`, `useCoachingSuggestions.ts`
- `src/hooks/useAwards.ts`, `useBadges.ts`, `useCompetitions.ts`, `useCommissions.ts`, `useGoals.ts`, `useMilestoneAutoUnlock.ts`
- `src/hooks/useRecentActivity.ts`, `useRecentItems.ts`, `useSellerActivity.ts`, `useCloserPerformance.ts`, `useSDRPerformance.ts`, `useVendedorRanking.ts`, `useRankingTransitions.ts`
- `src/pages/Agenda.tsx`, `ChecklistPage.tsx`, `Premiacoes.tsx`, `Ranking.tsx`, `Comissoes.tsx`

Backend:
- `supabase/functions/get-daily-priorities/`
- `supabase/functions/meeting-webhook/` (auditar — duplica `webhook-calcom`?)

## Slice de migração

**Slice 11** — `feat/modularizacao/10-engagement` (5h)

## Dedup pendente

- 8 pastas em components → consolidar em `components/{agenda,activities,followups,checklists,calls,gamification}/`
- `meeting-webhook` vs `webhook-calcom` → auditar

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Agenda Interna: `Obsidian/.../06 — Features/Vendas/Agenda Interna.md`
