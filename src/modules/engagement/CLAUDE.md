# Module — engagement

**Status:** 🟢 Active (slice 11 + cleanup longtail slice 16 — 2026-05-28). Backend: doc-only mapping (slice 15).
**BC:** engagement
**Entidade primária:** Checklist + Activity + Follow-up + Agenda Event + Gamification
**Owner:** ops / vendas

## Escopo

Engajamento dos vendedores com o sistema. Inclui:

- **Checklists** — itens repetitivos por vendedor (ex. revisar leads abandonados)
- **Activities** — log de atividade (call/email/meeting/note/task/whatsapp_msg/system)
- **Follow-ups** — agendamento de toque futuro (manual + automation rules)
- **Agenda** — calendário interno unificado (4 fontes: meetings + follow_ups + scheduled_messages + pipe_confirmacao)
- **Meetings** — reuniões via dialog + participants + status
- **Call Logs** — registro de ligações (manual ou via API telefonia)
- **Gamification** — badges, awards, competitions, levels, streak, celebration effects
- **Ranking** — vendedor ranking + history/transitions (`useVendedorRanking`/`useRankingTransitions`; UI consolidada em `analytics/pages/Performance.tsx` — aba Ranking)
- **Premiações** — prêmios/awards (`useAwards`; UI consolidada em `analytics/pages/Performance.tsx` — awards)
- **Comissões** — financial perf do vendedor (`Comissoes.tsx`, `useCommissions`)
- **Goals** — vendedor + team goals (`useGoals`/`useTeamGoals`; gestão de metas consolidada em `analytics/pages/Performance.tsx` — aba Gestão)
- **Daily Priorities** — fila do dia ("ações do dia")
- **Coaching Suggestions** — IA sugere áreas de melhoria por conversa
- **Performance** — KPIs por vendedor (closer + SDR perspective)
- **Approvals** — gates de aprovação para ações sensíveis (request/decide/pending)
- **Revisão** — fila de revisão (`Revisao.tsx` + `RevisionItem` — leads que precisam atenção)

## Não-escopo

- Performance da org como um todo → `analytics`
- Configuração de quotas/seats da org → `identity`
- TV Dashboard / `useTVKPIs` → `analytics` (slice 12) — não migrado nesta slice
- Folha de pagamento → não existe no Torque

## Estrutura

```
src/modules/engagement/
├── components/
│   ├── agenda/         # ex-src/components/agenda/         (8 files — AgendaTopBar, MonthView, TimeGrid, EventDetailPopover, ... + agenda-helpers.ts)
│   ├── activities/     # ex-src/components/activities/     (1 file — ActivityTimeline)
│   ├── ai/             # slice 16 — CoachingSidebar, NextBestActionsPanel
│   ├── approvals/      # ex-src/components/approvals/      (3 files — ApprovalRequestCard, ApprovalRulesConfig, PendingApprovals)
│   ├── badges/         # ex-src/components/badges/         (2 files — BadgeCard, BadgeGrid)
│   ├── calls/          # slice 16 — LogCallModal
│   ├── checklists/     # ex-src/components/checklists/     (4 files — ChecklistCard, ChecklistItemRow, ChecklistTemplatesManager, CreateChecklistDialog)
│   ├── comissoes/      # ex-src/components/comissoes/      (1 file — CommissionChart)
│   ├── followups/      # ex-src/components/followups/      (5 files — AcoesDoDia, AutomationSettings, FollowUpCard, ScheduleFollowUpButton, ScheduleFollowUpModal)
│   ├── gamification/   # ex-src/components/gamification/   (6 files — AchievementBadge, CelebrationEffect, LeaderboardCard, LevelBadge, ProgressRing, StreakCounter)
│   ├── ranking/        # ex-src/components/ranking/        (1 file — RankingHistoryChart)
│   └── revisao/        # ex-src/components/revisao/        (1 file — RevisionItem)
├── hooks/              # 25 hooks (ver lista abaixo)
├── pages/
│   ├── Agenda.tsx         # /agenda
│   ├── ChecklistPage.tsx  # /checklist
│   ├── Comissoes.tsx      # /comissoes
│   └── Revisao.tsx        # /revisao
│                          # Ranking/Premiacoes/Metas/GestaoMetas DELETADAS (órfãs) —
│                          # features consolidadas em analytics/pages/Performance.tsx (abas Ranking/Gestão + awards)
├── index.ts            # API pública
└── CLAUDE.md           # este arquivo
```

## API pública (`index.ts`)

### Hooks (re-exportados via barrel)

- **Activities**: `useActivities`, `useCreateActivity`, `useUpdateActivity`, `useCompleteActivity`, `useLogActivity`, `useMigrateFollowUps`, `useRecentActivity`, `useRecentItems`, `useSellerActivity`
- **Agenda & Meetings**: `useAgendaEvents`, `useMeetings`, `useMeeting`, `useCreateMeeting`, `useUpdateMeeting`, `useDeleteMeeting`, `useMeetingParticipants`, `useUpdateParticipantStatus`
- **Follow-ups**: `useFollowUps`, `useCreateFollowUp`, `useUpdateFollowUp`, `useCompleteFollowUp`, `useDeleteFollowUp`, `useArchiveFollowUp`, `useArchiveManyFollowUps`, `useFollowUpAutomations`, `useCreateFollowUpAutomation`, `useUpdateFollowUpAutomation`, `useDeleteFollowUpAutomation`, `useCreateAutomatedFollowUps`
- **Call Logs**: `useCallLogs`, `useLogCall`
- **Checklists**: `useChecklists`, `useChecklistItems`, `useCreateChecklist`, `useUpdateChecklist`, `useDeleteChecklist`, `useCreateChecklistItem`, `useToggleChecklistItem`, `useUpdateChecklistItem`, `useDeleteChecklistItem`, `useReorderChecklistItems`, `useChecklistTemplates`, `useApplyChecklistTemplate`
- **Approvals**: `useApprovalRules`, `usePendingApprovals`, `useRequestApproval`, `useDecideApproval`
- **Badges**: `useBadges`, `useUserBadges`, `useCreateBadge`, `useDeleteBadge`, `useUnlockBadge`
- **Awards**: `useAwards`, `useCreateAward`, `useUpdateAward`, `useDeleteAward`
- **Competitions**: `useCompetitions`, `useActiveCompetition`, `useCompetitionParticipants`, `useCompetitionPrizes`, `useCreateCompetition`, `useUpdateCompetition`, `useEndCompetition`
- **Milestone**: `useMilestoneAutoUnlock`
- **Ranking**: `useVendedorRanking`, `useRankingTransitions`
- **Goals**: `useGoals`, `useTeamGoals`, `useIndividualGoals`, `useCreateGoal`, `useUpdateGoal`
- **Daily Priorities / Ações do dia**: `useDailyPriorities`, `useCompleteFollowUpFromPriorities`, `useAcoesDoDia`, `useCreateAcaoDoDia`, `useCompleteAcaoDoDia`, `useUncompleteAcaoDoDia`, `useDeleteAcaoDoDia`, `useUpdateAcaoDoDiaPosition`, `useNextBestActions`, `useCompleteAction`, `useDismissAction`
- **Coaching**: `useCoachingSuggestions`, `useMarkSuggestionUsed`, `useDismissSuggestion`
- **Performance**: `useCloserPerformance`, `useSDRPerformance`
- **Commissions**: `useCommissions`, `useCommissionsByMember`, `useCreateCommission`, `useUpdateCommission`, `useCommissionSummary`, `calculateOTEBonus`

### Components (slice 16 longtail)

- `<LogCallModal>` — log de ligação manual (`components/calls/`)
- `<CoachingSidebar>` — sugestões de coaching IA (`components/ai/`)
- `<NextBestActionsPanel>` — próximas melhores ações IA (`components/ai/`)

### Components

Internals (não re-exportados — usados apenas pelas Pages do próprio módulo e por consumidores cross-module via deep-import legítimo, ex: `LeadDetailHeader` consumindo `ActivityTimeline`).

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy (padrão dos slices 4-10):
- `@/modules/engagement/pages/Agenda` (rota `/agenda`)
- `@/modules/engagement/pages/ChecklistPage` (rota `/checklist`)
- `@/modules/engagement/pages/Comissoes` (rota `/comissoes`)
- `@/modules/engagement/pages/Revisao` (rota `/revisao`)

> `Premiacoes`, `Ranking`, `Metas`, `GestaoMetas` foram **deletadas** (órfãs sem rota). Features migraram para `analytics/pages/Performance.tsx` (abas Ranking/Gestão + awards). Hooks subjacentes (`useGoals`, `useAwards`, `useVendedorRanking`, `useDashboardMetrics`) seguem vivos.

### Types

Tipos públicos re-exportados via barrel: `Activity`, `ActivityWithNames`, `ActivityInsert`, `ActivityType`, `ActivityOutcome`, `AgendaEvent`, `ApprovalRule`, `ApprovalRequest`, `ApprovalStatus`, `Award`, `Badge`, `UserBadge`, `CallLog`, `CallDirection`, `CallOutcome`, `LogCallInput`, `OUTCOME_LABELS`, `Checklist`, `ChecklistInsert`, `ChecklistUpdate`, `ChecklistItem`, `ChecklistItemInsert`, `ChecklistItemUpdate`, `ChecklistWithCounts`, `CloserPerformanceRow`, `CloserPerformanceData`, `CoachingSuggestion`, `SuggestionType`, `Commission`, `CommissionInsert`, `CommissionUpdate`, `CommissionSummary`, `Competition`, `CompetitionParticipant`, `CompetitionPrize`, `PriorityLead`, `PriorityFollowUp`, `DailyPrioritiesData`, `FollowUp`, `AcaoDoDia`, `CreateAcaoDoDiaInput`, `SellerActivity`, `Goal`.

> Nota: `Activity` em `useRecentActivity` é **um tipo distinto** (snapshot reduzido pro feed do dashboard). O barrel re-exporta apenas o hook (`useRecentActivity`), não o tipo. Consumidores que precisam do tipo do dashboard devem fazer deep-import: `@/modules/engagement/hooks/useRecentActivity`.

### Eventos (post slice 19)

`activity.logged`, `followup.scheduled`, `meeting.created`, `badge.earned`, `goal.completed`, `commission.calculated`.

## Áreas frágeis

🟠 **Agenda timezone** — operações multi-timezone. Componentes em `components/agenda/` lidam com 4 fontes de eventos com timezones potencialmente distintos. Não tocar lógica em `agenda-helpers.ts` sem auditar `getMonthGrid`, `getEventTop`, `getEventHeight`.

🟠 **Activity log: explosão** — log cresce N×N por lead. Paginação em `useActivities`/`useRecentActivity` é load-bearing. Throttle no realtime evita renders excessivos.

🟠 **Gamification triggers** — `useMilestoneAutoUnlock` dispara badges automáticos baseado em condições. Edge cases: badge race condition (2 milestones simultâneos), threshold mudou e badge precisaria re-trigger, novo vendedor não recebe legacy badges. Não tocar lógica sem testar todas as 3 trilhas.

🟠 **Revisão item — test baseline red** — `tests/unit/revision-item.test.tsx` falha no baseline pré-slice; foi atualizado pelo codemod pra novos paths mas falha continua por motivo distinto (mock incompleto / async timing). Reportar status: import correto após slice.

🟠 **Approval flow** — `usePendingApprovals` + `useRequestApproval` + `useDecideApproval`. Gates de permissão importam — teste com admin/membro/master separado se mudar lógica.

🟠 **Goal calculation** — `useGoals` calcula progresso baseado em metrics; consome `useDashboardMetrics` (analytics) — cross-module. UI (display + CRUD de metas) consolidada em `analytics/pages/Performance.tsx` (aba Gestão).

## Dependências cross-module

- `@/modules/identity` — `useOrganization`, `useAuth`, `useTeamMembers`, `useIdentity`, `useCanPerformAction`
- `@/modules/leads` — types `Lead` (Tables<"leads">), `useLeadById`
- `@/modules/communication` — `useOpenWhatsAppChat`, `ScheduleMessageModal`, `formatPhoneForWhatsApp`
- `@/modules/copilot` — (nenhuma direta no momento, mas `useNextBestActions` consume IA)
- `@/shared/realtime/useRealtimeSubscription` (movido em slice 16), `@/modules/analytics/useDashboardMetrics`
- `@/integrations/supabase/client`, `@/integrations/supabase/types`

### Consumidores cross-module (importam de `@/modules/engagement`)

- `@/modules/leads` — `LeadDetailHeader`, `LeadModalChecklist`, `LeadModalToolbar`, `LeadChecklistSection`, `LeadModal`, `gates-applied.test.tsx` — consomem `ActivityTimeline`, `useChecklists`, `useActivities`, `ScheduleFollowUpButton`
- `@/modules/pipelines` — `CustomPipelineKanban`, `CustomPipeSettingsDialog`, `QuickAddDailyAction`, `ManagePipelineStagesModal`, `PipeConfirmacao`, `PipePropostas`, `PipeWhatsapp` — consomem `useFollowUps`, `useAcoesDoDia`, `useApprovals`, `useChecklists`, `useAgendaEvents`
- `@/modules/workflows` — `ActionPanel` — consume `useApprovals`
- `src/pages/Configuracoes.tsx`, `src/pages/Performance.tsx`, `src/pages/DashboardOutbound.tsx`, `src/pages/TVDashboard.tsx` — consomem assorted engagement hooks (assets serão absorvidos por seus módulos respectivos em slices 12-14)

## Origem (slice 11 — frontend migrado em 2026-05-27)

Frontend (migrado pra cá):

- ~~`src/components/agenda/`~~ (8 files) → `./components/agenda/`
- ~~`src/components/activities/`~~ (1 file) → `./components/activities/`
- ~~`src/components/approvals/`~~ (3 files) → `./components/approvals/`
- ~~`src/components/badges/`~~ (2 files) → `./components/badges/`
- ~~`src/components/checklists/`~~ (4 files) → `./components/checklists/`
- ~~`src/components/comissoes/`~~ (1 file) → `./components/comissoes/`
- ~~`src/components/followups/`~~ (5 files) → `./components/followups/`
- ~~`src/components/gamification/`~~ (6 files) → `./components/gamification/`
- ~~`src/components/ranking/`~~ (1 file) → `./components/ranking/`
- ~~`src/components/revisao/`~~ (1 file) → `./components/revisao/`
- ~~`src/hooks/{useActivities,useAgendaEvents,useApprovals,useAwards,useBadges,useChecklists,useChecklistTemplates,useCoachingSuggestions,useCommissions,useFollowUps,useRankingTransitions,useRecentActivity,useRecentItems,useSellerActivity,useVendedorRanking,useAcoesDoDia,useCallLogs,useCloserPerformance,useSDRPerformance,useCompetitions,useDailyPriorities,useGoals,useMeetings,useMilestoneAutoUnlock,useNextBestActions}.ts`~~ (25 hooks) → `./hooks/`
- ~~`src/pages/{Agenda,ChecklistPage,Comissoes,Premiacoes,Ranking,Revisao,Metas,GestaoMetas}.tsx`~~ (8 pages) → `./pages/`

Backend (próximas slices):

- `supabase/functions/get-daily-priorities/` (slice 14)
- `supabase/functions/meeting-webhook/` (slice 14 — auditar duplicação com `webhook-calcom`)
- `_shared/` modules consumidos por engagement edge functions (slice 16 cleanup)

## Decisões — slice 11

- **`useTVKPIs.ts`** → **NÃO migrado**. Consumido apenas por `src/pages/TVDashboard.tsx` (analytics BC). Já documentado em `src/modules/analytics/CLAUDE.md` como pertencente a analytics. Cross-domain (TV é dashboard org-level, não vendedor-perspective).
- **`Metas.tsx` + `GestaoMetas.tsx`** → **engagement** (esta slice). Consomem `useGoals`/`useTeamGoals`/`useIndividualGoals` que tratam **vendedor goals** (mensal/individual). Conceitualmente vendedor-perspective: cada vendedor tem suas metas, gestão é interface admin pra setá-las. Decisão: vendedor goals = engagement; quotas org-level (subscription_plans, seat caps) = identity.
- **`useNextBestActions.ts` + `useCoachingSuggestions.ts`** → mantidos em engagement (IA helpers consumidos por UI de engajamento), não em copilot. Copilot trata agente IA conversacional; estes são prompts/sugestões pro vendedor humano.
- **Pages órfãs (`Premiacoes`, `Ranking`, `Metas`, `GestaoMetas`)** → movidas mesmo sem registro em `App.tsx`. Motivo: (a) preservar history via `git mv`, (b) se reativadas (deep-link, redirect, ou rota nova), o lugar correto já é o módulo, (c) custo zero.

## Dívidas técnicas

- 🟠 **`Activity` colide entre `useActivities` e `useRecentActivity`** — barrel exporta apenas o hook de `useRecentActivity`, não o tipo. Consumidor `src/components/dashboard/ActivityFeed.tsx` continua usando deep-import pro tipo. Em slice futura, considerar renomear pra `RecentActivityRow` ou unificar.
- 🟠 **Cross-module deep-imports residuais** — `src/components/dashboard/ActivityFeed.tsx`, `src/components/settings/*`, `src/pages/DashboardOutbound.tsx`, `src/pages/Performance.tsx`, `src/pages/TVDashboard.tsx`, `src/pages/Configuracoes.tsx` ainda fazem deep-import de `@/modules/engagement/hooks/*` em vez de via barrel. Em slice 12+ (quando absorvidos em seus BCs respectivos), deve trocar pro barrel.
- 🟠 **`tests/unit/revision-item.test.tsx` falha no baseline** — pré-existente (não causado pela slice). Imports atualizados pelo codemod. Reportar como dívida da slice 12+ ou de feature owner do RevisionItem.
- 🟠 **`useCoachingSuggestions`/`useNextBestActions` cross-domain** — pertencem a engagement por consumidores, mas a IA propriamente é copilot. Auditar slice 15 (refactor cross-module).
- ✅ **Pages órfãs** — `Premiacoes`, `Ranking`, `Metas`, `GestaoMetas` foram **deletadas** (eram órfãs sem rota). Features consolidadas em `analytics/pages/Performance.tsx` (abas Ranking/Gestão + awards); hooks subjacentes seguem vivos.

## Slice de migração

**Slice 11** — `feat/modularizacao/10-engagement` — completado 2026-05-27. **65 renames** (32 components + 25 hooks + 8 pages) + **86 arquivos** com imports atualizados (**132 substituições**).

## Refs

- ADR: `Obsidian/.../04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Slice de referência: slice 10 carteira (commit `c9d5d56e`)
- Agenda Interna: `Obsidian/.../06 — Features/Vendas/Agenda Interna.md`
