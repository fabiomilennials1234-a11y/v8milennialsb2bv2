# Module — analytics

**Status:** 🟢 Active (slice 12 — frontend completo. Backend `meta-ads-insights` + `_shared/` ficam em slices 14/16)
**BC:** analytics
**Entidade primária:** Dashboard + Metric + Cohort + TV Display
**Owner:** ops

## Escopo

Visão agregada do desempenho da org. Inclui:

- **Comando** (`/dashboard`) — aba default **Próximos passos** (fila de ação da operação) + KPIs (leads novos, conversão, ticket médio, receita), Performance, Saúde, Mapa
- **Estúdio de Métricas** (`/metricas`) — painel em branco + catálogo lateral; o usuário compõe as janelas que quer ver
- **Dashboard Outbound** — fila de envio, queue health
- **TV Dashboard** — display rotativo pra parede do escritório (period rotation)
- **Performance** — view por vendedor (cross-cut com `engagement`)
- **Analytics moderno** — 8 sub-domínios: comercial, engajamento, filtros, financeiro, overview, pipes/funis, utms, geral
- **Cohort Analysis** — coortes de lead/cliente
- **UTMs / Mkt por Origin** — performance de origens de tráfego
- **Segment Benchmark** — comparativo entre orgs (master only)
- **Split A/B Metrics** — consumido por workflows
- **Outbound Metrics** — queue health + envio histórico
- **Exchange Rates** — conversão multi-moeda

## Não-escopo

- Métricas individuais do vendedor → `engagement` (ranking, performance, daily priorities)
- Métricas IA do Copilot → `copilot.useCopilotMetrics`
- Dashboard de saúde da carteira → `carteira.usePortfolioKPIs`
- Páginas de Metas / GestaoMetas / Comissoes / Revisao / Ranking / Premiacoes / Checklist → `engagement` (já migradas slice 11)

## Estrutura

```
src/modules/analytics/
├── components/
│   ├── analytics/            # ex-src/components/analytics/        (14 files + charts/sections/tabs)
│   │   ├── charts/           # 33 charts especializados (Funnel, Cohort, UTM*, Revenue*, etc.)
│   │   ├── sections/         # 4 sections (Aquisicao, Equipe, Pipeline, Receita)
│   │   └── tabs/             # 1 tab (Utms)
│   ├── dashboard/            # ex-src/components/dashboard/        (27 files — KPI cards, Oraculo, Tabs, rankings)
│   ├── dashboard-outbound/   # ex-src/components/dashboard-outbound/ (4 files — Badge/Milestone/MetricCards)
│   ├── performance/          # ex-src/components/performance/      (7 files — Competition*, EmptyState)
│   └── tv/                   # ex-src/components/tv/               (17 files — TV blocks + Rotating slot)
├── hooks/                    # 18 hooks (ver API pública)
├── pages/
│   ├── Dashboard.tsx         # /dashboard
│   ├── DashboardOutbound.tsx # rota /dashboard-outbound (lazy via Dashboard)
│   ├── Performance.tsx       # /performance
│   └── TVDashboard.tsx       # /tv
├── lib/                      # placeholder
├── index.ts                  # API pública
└── CLAUDE.md                 # este arquivo
```

## API pública (`index.ts`)

### Hooks (re-exportados via barrel)

- **Analytics moderno**:
  - useAnalytics: `useFunnelConversion`, `usePipelineVelocity`, `useRevenueAttribution`, `useSalesCycleAnalysis`, `useWinLossAnalysis` (tipo `FunnelStage` é deep-import só)
  - `useAnalyticsComercial`, `useAnalyticsEngajamento`, `useAnalyticsFilters`, `useAnalyticsFinanceiro`
  - `useAnalyticsOverview` (tipo `CohortRow` é deep-import só, colide com `useCohortAnalysis`)
  - `useAnalyticsPipesFunis`, `useAnalyticsUtms`
- **Cohort**: `useCohortAnalysis`
- **Dashboard Metrics**: `useDashboardMetrics`, `useConversionRates`, `useFunnelData`, `useRankingData`
- **Exchange Rates**: `useExchangeRates`, `useConvertCurrency`, `SUPPORTED_CURRENCIES`
- **Marketing**: `useMktByOrigin`, `useMktOriginConfigs`, `useUpsertMktOriginConfig`, `useBatchUpsertMktOriginConfig`, `ALL_ORIGINS`, `ORIGIN_LABELS`, `ORIGIN_COLORS`, `useSegmentBenchmark`
- **Outbound**: `useOutboundMetrics`
- **Split A/B**: `useSplitAbMetrics`, `useSplitAbNodes`
- **TV**: `useTVDashboardData`, `useTVKPIs`

### Components

Internals (não re-exportados — usados apenas pelas Pages do próprio módulo). Deep-import legítimo permitido apenas quando consumidores estão em outros módulos e precisam de componente específico (ex.: split-ab analytics consumido por workflows).

### Pages

NÃO re-exportadas — App.tsx faz deep-import via React.lazy (padrão dos slices 4-11):
- `@/modules/analytics/pages/Dashboard` (rota `/dashboard`)
- `@/modules/analytics/pages/DashboardOutbound` (lazy via Dashboard.tsx → renderiza inline)
- `@/modules/analytics/pages/Performance` (rota `/performance`)
- `@/modules/analytics/pages/TVDashboard` (rota `/tv`)

### Types

Tipos públicos re-exportados via barrel: `PipelineVelocity`, `RevenueAttribution`, `SalesCycleStage`, `WinLossItem`, `MemberStat`, `LossReason`, `OriginQuality`, `CommercialMetrics`, `EngagementKPIs`, `ResponseByOriginRow`, `TeamResponseTimeRow`, `HourlyPatternRow`, `SpeedConversionRow`, `MonthlyTrendRow`, `CopilotHumanStats`, `CopilotVsHuman`, `DatePreset`, `AnalyticsFilters`, `RevenueByType`, `MRREvolutionPoint`, `SellerProfitability`, `CACByOrigin`, `TicketByType`, `FinancialMetrics`, `CohortRetentionPoint`, `UnitEconomics`, `AttributionRow`, `VelocityTransition`, `SalesVelocity`, `OverviewInsight`, `OverviewMetrics`, `PipelineSelectorType`, `StageAnalysis`, `PipelineAgingStage`, `WeightedForecastStage`, `ConversionTrendMonth`, `ConversionTrend`, `PipelineFunnelMetrics`, `UtmLevel`, `UtmGroupedRow`, `UtmLeadRow`, `MetaInsightRow`, `UtmCombinedRow`, `UtmKpis`, `UtmAnalyticsData`, `CohortRow` (do useCohortAnalysis), `ExchangeRate`, `OriginMetrics`, `MktSummary`, `LeadOrigin`, `MktOriginConfig`, `OutboundMetrics`, `SegmentBenchmarkData`, `TVDashboardMetrics`, `TVKPIKey`, `TVKPIValues`.

> Nota: `FunnelStage` colide entre `useAnalytics` e `useAnalyticsPipesFunis` — barrel não re-exporta o tipo; consumidor faz deep-import (`@/modules/analytics/hooks/useAnalyticsPipesFunis`).
>
> Nota: `CohortRow` colide entre `useAnalyticsOverview` e `useCohortAnalysis` — barrel re-exporta apenas a versão de `useCohortAnalysis` (mais usada); consumidor de `useAnalyticsOverview.CohortRow` faz deep-import.

### Eventos (post slice 19)

n/a — analytics é read-only (consome eventos via aggregation tables/RPCs).

## Estúdio de Métricas (`/metricas`) — SCRUM-11, MVP

Superfície nova. Comando vira **operação** (o que fazer agora), Estúdio vira **análise** (o que olhar). Portas cruzadas nas duas direções: botão "Ver métricas" na aba Próximos passos, botão "Comando" no header do Estúdio, item na top bar e no Command Palette.

| Peça | Arquivo |
|---|---|
| Página | `pages/MetricsStudio.tsx` (rota WIDE — ver `WIDE_LAYOUT_PATTERNS`) |
| Inventário do roadmap (29 métricas) | `lib/metrics-studio-catalog.ts` — NÃO é o que a UI lista |
| Mapa Estúdio→motor | `lib/metrics-studio-engine-map.ts` (+ `.test.ts`) |
| Período Estúdio→motor | `lib/metrics-studio-period.ts` (+ `.test.ts`) |
| Dado de uma janela | `hooks/useMetricWindowData.ts` |
| Estado do painel | `hooks/useMetricsStudio.ts` (cópia de trabalho em memória) |
| Persistência do painel | `hooks/useMetricsStudioPanel.ts` → tabela `metrics_studio_panels`, 1 por (org, membro) |
| Trava de rollout | `hooks/useMetricsStudioEnabled.ts` → `organizations.metrics_studio_enabled` |
| Lista lateral | `components/metrics-studio/MetricsStudioSidebar.tsx` |
| Canvas / janela | `components/metrics-studio/{MetricsCanvas,MetricWindow}.tsx` |
| Gráficos | `components/metrics-studio/charts/Studio{Line,Pie}Chart.tsx` (Candle existe e está DESLIGADO — G3) |

**Estado, após o grill de 2026-08-11** (13 decisões em `.specs/features/metricas-v2/SPEC.md` §1.7):

1. ✅ **Números vêm do motor** `fn_metric_measure`, via `useMetricWindowData`. A amostra foi deletada.
2. ✅ **A lista mostra só o que tem número real** (G1): 7 medidas + 3 razões. O inventário de 29 continua em `metrics-studio-catalog.ts` como mapa do roadmap, não como fonte da UI.
3. ✅ **O corte é escolha do usuário** (G2) — o seletor da janela oferece só os cortes que aquela medida aceita, conferidos contra prod.
4. ✅ **Cortes por pessoa reusam `performance.view`** (G6). Não foi preciso criar `metrics.view`.
5. ✅ **Trava de liberação por org** (G5): `organizations.metrics_studio_enabled`, migration `20270811100000`. Falha para FECHADO — enquanto não estiver em prod, o Estúdio fica invisível para todos. Fecha três portas: rota, item da top bar e command palette.
7. ✅ **Modos Visualização e Edição** (SCRUM-308). Nasce em Visualização; canvas travado, sem alças nem controles, lista lateral recolhida.
8. ✅ **Painel persistido no servidor** (SCRUM-309): `metrics_studio_panels`, um por (org, membro), migration `20270811110000`. NÃO reusa `dashboard_widgets` — ver o cabeçalho da migration para os quatro motivos medidos.
6. 🟠 **17 das 29 do inventário seguem fora do motor** — é o SCRUM-311 que as porta.

**Asperezas do motor que a UI precisa respeitar** (todas tratadas em `useMetricWindowData`):

- `value` XOR `series`: recorte `total` devolve escalar e `series: null`; qualquer outro devolve série e `value: null`.
- Toda série vem ordenada por VALOR desc — inclusive `tempo`. A série temporal é reordenada por `key` antes de virar linha, senão o gráfico sai embaralhado.
- Razão devolve `series: null` SEMPRE, e força `total` nos dois filhos.
- O motor DEGRADA recorte em silêncio e reporta o efetivo em `measure.recorte`. A janela rotula pelo efetivo, não pelo pedido.
- Par (medida, recorte) incompatível levanta `EXCEPTION 22023`, que **não** é capturado por `isMissingSchemaError`. O mapa é a guarda.
- O comparativo de período (G4) é uma SEGUNDA chamada, sempre em `total`, e não bloqueia a janela.

**Vela é SVG próprio** (`StudioCandleChart`): recharts não tem candlestick, e a receita usual de empilhar `Bar` com base falsa quebra quando `low = 0`.

## Áreas frágeis

🟠 **Receita mês "canônica"** — ADR existente (ver refs). Múltiplos consumidores (`useDashboardMetrics`, `useAnalyticsFinanceiro`) precisam usar o mesmo cálculo. Não tocar lógica sem auditar todos.

🟠 **TV Dashboard period rotation** — ADR-2026-05-22 (timing crítico). Componentes em `components/tv/` (RotatingSlot, PeriodPill) + `useTVDashboardData` + `useTVKPIs` + `TVPeriodContext`. Não tocar sem auditar drift de timing e race de hooks.

🟠 **Filtros cross-pipe** — `useAnalyticsFilters` + `useAnalyticsOverview` + `useAnalyticsPipesFunis` cruzam pipe_whatsapp/confirmacao/propostas (views compat sobre `pipeline_entries`). Coluna `status` = `stage_key` (slug). Não tocar lógica sem confirmar comportamento das views.

🟠 **`useDashboardMetrics` / `useRankingData`** — consumidos por `analytics/pages/Performance.tsx` + componentes `dashboard/*` (mesmo módulo). A página engagement `Metas.tsx` que os consumia foi deletada; features (Ranking/Gestão/awards) consolidadas em `Performance.tsx`. Manter contract estável.

## Dependências cross-module

- `@/modules/identity` — `useOrganization`, `useAuth`, `useIdentity`, `useCurrentTeamMember`, `useUserRole`, `useTeamMembers`, `useFeaturePermission`, `isVirtualTeamMember`, `TeamMember`
- `@/modules/copilot` — `useOraculoChat` (consumido por Dashboard → OraculoChat/OraculoFloatingButton)
- `@/modules/engagement` — `useActiveCompetition`, `useCompetitionParticipants`, `useCompetitionPrizes`, `useRankingTransitions`, `useTeamGoals`, `useGoals`, `useCreateGoal`, `useUpdateGoal`, `useAwards`, `useCreateAward`, `useUpdateAward`, `useDeleteAward`, `useBadges`, `useUserBadges`, `useMilestoneAutoUnlock`, `useCloserPerformance`, `useSDRPerformance`, components `ProgressRing`, `AchievementBadge`, `CelebrationEffect`
- `@/modules/marketing` — `MktConfigModal`, `MktOriginCard`, `MktOriginRanking` (consumido por `components/analytics/sections/AquisicaoSection.tsx` via deep-import — UI de display de Mkt por origem)
- `@/hooks/useRealtimeSubscription`, `@/hooks/useAvatarMap`, `@/hooks/usePersistedState`, `@/hooks/useOnboarding` — cross-cutting (slices 14+)
- `@/integrations/supabase/client`, `@/integrations/supabase/types`

### Consumidores cross-module (importam de `@/modules/analytics`)

- _(as páginas engagement `Metas.tsx`/`Premiacoes.tsx`/`Ranking.tsx` que consumiam `useDashboardMetrics`/`useRankingData` foram deletadas; o consumo agora é in-module via `analytics/pages/Performance.tsx`)_
- `@/modules/carteira/components/client/CarteiraCohortHeatmap.tsx` — consome `CohortHeatmap` chart
- `@/modules/workflows/components/SplitAbAnalytics.tsx` — consome `useSplitAbMetrics`
- `@/modules/pipelines/pages/PipePropostas.tsx` — consome `useAnalyticsFilters` (ou similar)

## Decisões — slice 12

- **Subcomponentes cross-domain em `dashboard/`** (OraculoChat, OraculoFloatingButton, GoalProgress, RankingPreview, RankingTable, TopPerformers, SellerActivityCard, ActivityFeed, PriorityLeads, ProductRanking) → **mantidos em analytics** como UI do Dashboard. São consumers de copilot/engagement/carteira/leads BCs, mas pertencem visualmente ao composite Dashboard. Dívida técnica para slice 17 — avaliar se devem virar slots/render-props ou se permanecem hospedados em analytics.
- **`useOutboundMetrics`** → confirmado analytics. Já consumido por `@/modules/engagement/hooks/useMilestoneAutoUnlock` (atualizado para `@/modules/analytics/hooks/useOutboundMetrics` nesta slice via codemod).
- **Pages Metas/GestaoMetas/Comissoes/Premiacoes/Ranking/Revisao/ChecklistPage** → migradas na slice 11 para engagement. Mencionadas no skeleton anterior, removidas desta CLAUDE.md.
- **`src/components/revisao`** → migrada na slice 11 para `src/modules/engagement/components/revisao/`. Removida do mapa de origem desta CLAUDE.md.

## Dívidas técnicas

- 🟠 **Cross-domain subcomponentes** — `dashboard/{OraculoChat,OraculoFloatingButton}` (copilot BC), `dashboard/{GoalProgress,RankingPreview,RankingTable,TopPerformers,SellerActivityCard,ActivityFeed,PriorityLeads,ProductRanking}` (engagement/carteira/leads BCs) hospedados em analytics. Slice 17 deve decidir: (a) split em slots/render-props, (b) extrair para módulos próprios, (c) manter como UI host-only.
- 🟠 **`FunnelStage` / `CohortRow` colisão** — 2 interfaces homônimas distintas. Barrel resolve por convenção (omite uma); consumidores que precisam da versão alternativa fazem deep-import. Slice futura: renomear uma das duas para evitar confusão.
- 🟠 **`useDashboardMetrics` cross-module com engagement** — engagement consome via deep-import. Slice 17+ pode promover ao barrel se padrão se estabilizar.
- 🟠 **`useTVKPIs` consome engagement (`useCloserPerformance`/`useSDRPerformance`)** — deep-import legítimo mas cruza BCs. Auditar slice 15.

## Origem (slice 12 — frontend migrado em 2026-05-27)

Frontend (migrado pra cá):

- ~~`src/components/analytics/`~~ (14 files + charts/33 + sections/4 + tabs/1) → `./components/analytics/`
- ~~`src/components/dashboard/`~~ (27 files) → `./components/dashboard/`
- ~~`src/components/dashboard-outbound/`~~ (4 files) → `./components/dashboard-outbound/`
- ~~`src/components/performance/`~~ (7 files) → `./components/performance/`
- ~~`src/components/tv/`~~ (17 files) → `./components/tv/`
- ~~`src/hooks/{useAnalytics,useAnalyticsComercial,useAnalyticsEngajamento,useAnalyticsFilters,useAnalyticsFinanceiro,useAnalyticsOverview,useAnalyticsPipesFunis,useAnalyticsUtms,useCohortAnalysis,useDashboardMetrics,useExchangeRates,useMktByOrigin,useMktOriginConfig,useOutboundMetrics,useSegmentBenchmark,useSplitAbMetrics,useTVDashboardData,useTVKPIs}.ts`~~ (18 hooks) → `./hooks/`
- ~~`src/pages/{Dashboard,DashboardOutbound,Performance,TVDashboard}.tsx`~~ (4 pages) → `./pages/`

Backend (próximas slices):

- `supabase/functions/meta-ads-insights/` (slice 14)
- `_shared/` modules consumidos por analytics edge functions (slice 16 cleanup)

## Slice de migração

**Slice 12** — `feat/modularizacao/11-analytics` — completado 2026-05-27.

## Refs

- ADR TV Dashboard period rotation: `Obsidian/.../04 — Decisões/ADR-2026-05-22-tv-dashboard-period-rotation.md`
- ADR receita mês canônica (no vault — buscar)
- TV Dashboard feature: `Obsidian/.../06 — Features/Dashboard/TV Dashboard.md`
- Slice de referência: slice 11 engagement (commit `10b7cf52`)
