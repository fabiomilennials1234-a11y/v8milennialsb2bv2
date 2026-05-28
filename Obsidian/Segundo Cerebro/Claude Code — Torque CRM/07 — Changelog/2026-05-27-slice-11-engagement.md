# 2026-05-27 — Slice 11 engagement

Slice 11 da modularização (`feat/modularizacao/10-engagement`, stacked sobre slice 10). Frontend do BC engagement migrado para `src/modules/engagement/`. Backend (`get-daily-priorities`, `meeting-webhook` + `_shared/`) continua fora — slices 14/16. Moves mecânicos sem alteração de comportamento; zero pixel, zero schema.

## Mudanças

- **engagement**: 10 pastas de components migradas (32 arquivos): `agenda/` (8), `activities/` (1), `approvals/` (3), `badges/` (2), `checklists/` (4), `comissoes/` (1), `followups/` (5), `gamification/` (6), `ranking/` (1), `revisao/` (1); 25 hooks migrados; 8 pages migradas; 10 pastas root de `src/components/` deletadas (vazias após move)
- **App.tsx**: lazy imports atualizados — Agenda, ChecklistPage, Comissoes, Revisao agora resolvem em `@/modules/engagement/pages/...` (4 pages órfãs também movidas mesmo sem registro em App.tsx: Premiacoes, Ranking, Metas, GestaoMetas — preservam history pra reativação futura)
- **API pública**: `src/modules/engagement/index.ts` populado — hooks de activities/agenda/meetings/follow-ups/call-logs/checklists/approvals/badges/awards/competitions/milestone/ranking/goals/daily-priorities/coaching/performance/commissions (via `export *` por arquivo + named para evitar colisão `Activity` entre `useActivities` e `useRecentActivity`)
- **Status**: módulo marcado Active no `src/modules/engagement/CLAUDE.md`. `src/modules/CLAUDE.md` mapa atualizado (linha engagement Skeleton → Active)
- **Codemod**: `scripts/rewrite-engagement-imports.mjs` — 86 arquivos, 132 substituições (components paths + hook paths + page paths absolutos + paths relativos do App.tsx)
- **Fix relative imports**: `scripts/fix-engagement-relative-imports.mjs` — 10 substituições em hooks movidos que ainda importavam siblings via `./` para hooks NÃO migrados (`useRealtimeSubscription`, `useAvatarMap`, `useOutboundMetrics`) — agora apontam via `@/hooks/...`. Também 2 imports cross-engagement (`./useBadges`, `./useChecklists`) reescritos via `@/modules/engagement/hooks/...`
- **Fix imports em hooks NÃO migrados**: `src/hooks/useTVKPIs.ts` e `src/hooks/useTVDashboardData.ts` referenciavam siblings (`./useSDRPerformance`, `./useCloserPerformance`, `./useGoals`) que foram para engagement; atualizados para `@/modules/engagement/hooks/...`
- **Obsidian feature map**: `scripts/obsidian-feature-map.json` atualizado com paths novos (8 entradas remapeadas — followups, ranking, comissoes/Metas/Premiacoes, agenda)

## Decisões — hooks/pages adjacentes auditados

Brief pediu análise caso a caso de `useTVKPIs`, `Metas.tsx`, `GestaoMetas.tsx`.

- **`useTVKPIs.ts`** → **NÃO migrado**. Consumido apenas por `src/pages/TVDashboard.tsx` (analytics BC). Já documentado em `src/modules/analytics/CLAUDE.md` como pertencente a analytics. Cross-domain (TV é dashboard org-level, não vendedor-perspective). Migra na slice 12 (analytics).
- **`Metas.tsx` + `GestaoMetas.tsx`** → **engagement** (esta slice). Consomem `useGoals`/`useTeamGoals`/`useIndividualGoals` que tratam **vendedor goals** (mensal/individual). Conceitualmente vendedor-perspective: cada vendedor tem suas metas, gestão é interface admin pra setá-las. Decisão: vendedor goals = engagement; quotas org-level (subscription_plans, seat caps) = identity.
- **`useNextBestActions.ts` + `useCoachingSuggestions.ts`** → mantidos em engagement (IA helpers consumidos por UI de engajamento), não em copilot. Copilot trata agente IA conversacional; estes são prompts/sugestões pro vendedor humano.
- **Pages órfãs (`Premiacoes`, `Ranking`, `Metas`, `GestaoMetas`)** → movidas mesmo sem registro em `App.tsx`. Motivo: (a) preservar history via `git mv`, (b) se reativadas (deep-link, redirect, ou rota nova), o lugar correto já é o módulo, (c) custo zero. Decisão final (reativar vs deletar) em slice 17+.

## Arquivos tocados (resumo)

- `src/modules/engagement/{components,hooks,pages,index.ts,CLAUDE.md}` — populados via 65 renames (`git mv`)
- `src/App.tsx` — 4 imports engagement reescritos (lazy)
- `src/components/{agenda,activities,approvals,badges,checklists,comissoes,followups,gamification,ranking,revisao}/` — removidos (vazios após move)
- 25 hooks soltos `src/hooks/use{Activities,AgendaEvents,Approvals,Awards,Badges,Checklists,ChecklistTemplates,CoachingSuggestions,Commissions,FollowUps,RankingTransitions,RecentActivity,RecentItems,SellerActivity,VendedorRanking,AcoesDoDia,CallLogs,CloserPerformance,SDRPerformance,Competitions,DailyPriorities,Goals,Meetings,MilestoneAutoUnlock,NextBestActions}` — removidos (movidos)
- 8 pages soltas `src/pages/{Agenda,ChecklistPage,Comissoes,Premiacoes,Ranking,Revisao,Metas,GestaoMetas}.tsx` — removidas (movidas)
- 2 hooks externos com relative `./` atualizados: `src/hooks/useTVKPIs.ts`, `src/hooks/useTVDashboardData.ts`
- `scripts/rewrite-engagement-imports.mjs` — codemod (utility, preservado)
- `scripts/fix-engagement-relative-imports.mjs` — post-fix (utility, preservado)
- `scripts/obsidian-feature-map.json` — paths atualizados

## QA (output literal)

- **Lint**: `npm run lint` → **0 errors, 2448 warnings** (baseline warnings inalterado, sem regressões)
- **Typecheck**: `npx tsc --noEmit` → **exit 0** (sem erros)
- **Build**: `npm run build` → **exit 0** (construiu 2618 modules, PWA precache 279 entries)
- **Test:unit full**: aguardando re-run pós-fix (corrida prévia capturou estado intermediário do fix relative imports). Report literal será adicionado pelo arquiteto após confirmar.

## Decisões

- **Backend (edge functions + `_shared/`) fora deste slice** — vão para slices 14/16 conforme planejamento original
- **Pages NÃO em index.ts** — padrão dos slices 4-10 (App.tsx faz deep-import via React.lazy)
- **Pages órfãs movidas mesmo sem rota** — custo zero, history preservada

## Refs

- ADR: `04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md`
- Slice anterior: 10 carteira (`07 — Changelog/2026-05-27-slice-10-carteira.md` — se existir)
- SPEC: `.specs/features/modularizacao/SPEC.md`
- Módulo CLAUDE: `src/modules/engagement/CLAUDE.md`
