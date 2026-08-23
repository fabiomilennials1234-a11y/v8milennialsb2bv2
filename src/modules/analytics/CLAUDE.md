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
| Vocabulário fechado (folha, sem deps) | `lib/metric-vocabulary.ts` — `MetricRecorte`, `MetricFormatId`, `MetricUnit`, `MetricFilters` |
| Mapa Estúdio→motor | `lib/metrics-studio-engine-map.ts` (+ `.test.ts`) — 16 medidas + 5 razões |
| Árvore personalizada (espelho do validador SQL) | `lib/metric-tree.ts` |
| Período Estúdio→motor | `lib/metrics-studio-period.ts` (+ `.test.ts`) |
| Dado de uma janela | `hooks/useMetricWindowData.ts` |
| Catálogo efetivo (fábrica + personalizadas) | `hooks/useStudioCatalog.ts` |
| CRUD de métrica personalizada | `hooks/useMetricCustomDefinitions.ts` → `metric_custom_definitions` |
| Estado do painel | `hooks/useMetricsStudio.ts` (cópia de trabalho; recebe `byId` do catálogo) |
| Persistência do painel | `hooks/useMetricsStudioPanel.ts` → tabela `metrics_studio_panels`, 1 por (org, membro) |
| Trava de rollout | `hooks/useMetricsStudioEnabled.ts` → `organizations.metrics_studio_enabled` |
| Lista lateral | `components/metrics-studio/MetricsStudioSidebar.tsx` |
| Compositor de métrica | `components/metrics-studio/MetricComposer.tsx` |
| Canvas / janela | `components/metrics-studio/{MetricsCanvas,MetricWindow}.tsx` |
| Gráficos | `components/metrics-studio/charts/Studio{Line,Pie}Chart.tsx` (Candle existe e está DESLIGADO — G3) |

### 🔴 Lead ≠ Negócio (fatia 9 · migration `20270813100000`)

A unidade do funil é o **NEGÓCIO** (ADR-0023 `negocio-is-the-funnel-unit`). O motor
passou a distinguir, e as duas medidas leem a MESMA tabela:

| medida | conta | prod 2026-08-12 |
|---|---|---|
| `negocios_na_etapa` | `COUNT(*)` de entrada aberta | 41.025 |
| `leads_na_etapa` | `COUNT(DISTINCT lead_id)` | 36.073 |

⚠️ **`leads_na_etapa` MUDOU de conta.** Painel salvo apontando para ela cai 12%.
É a correção, não o efeito colateral — e é grátis hoje porque o Estúdio inteiro
está atrás de `metrics_studio_enabled`, que não está em prod.

O StudioMetric `negocios_por_etapa` **manteve o id** (painel salvo continua
abrindo) e passou a apontar para `negocios_na_etapa`. Ele já se chamava
"Negócios na etapa" na tela e contava entrada — três nomes, uma conta.

`negocios_abertos` (âncora `entradas`, por `entered_at`) existe para a razão
`taxa_conversao_negocio`: dividir venda por LEAD infla o denominador quando o
lead tem vários negócios (4.380 leads têm mais de um aberto).

### Métrica personalizada (fatia 10 · migration `20270813110000`)

Emenda 1 do ADR-0023: profundidade ≤ 3, operadores `+ − × ÷`, folha = id do
catálogo (+ filtro da allowlist) ou número literal, árvore `jsonb` tipada.

- `measure_ref` ganhou `kind='custom'` (definição salva) e `kind='tree'` (prévia
  inline do compositor). Os dois passam pelo mesmo validador e pelo mesmo
  avaliador — prévia não é caminho privilegiado.
- Validação nas **duas pontas**: trigger na escrita e `fn_metric_tree_validate`
  em runtime, porque a linha gravada sobrevive a mudança de validador.
- Escrita é **admin-only** (`get_my_admin_organization_ids()`); leitura é de
  qualquer membro da org.

🔴 **A armadilha de 100×, e por que ela não existe na árvore.** O ramo
`kind='ratio'` deriva `count/count → percent` e **multiplica por 100**; o front
apenas SUFIXA `%` sem multiplicar. Par incoerente imprime erro de 100× que nada
detecta. Na árvore personalizada, `count ÷ count` deriva **`ratio`** e o motor
**nunca multiplica** — quem quer percentual escreve `× 100` na composição, e o
compositor avisa em português quando o formato é `percent_1`.

**Estado, após o grill de 2026-08-11** (13 decisões em `.specs/features/metricas-v2/SPEC.md` §1.7):

1. ✅ **Números vêm do motor** `fn_metric_measure`, via `useMetricWindowData`. A amostra foi deletada.
2. ✅ **A lista mostra só o que tem número real** (G1): 7 medidas + 3 razões. O inventário de 29 continua em `metrics-studio-catalog.ts` como mapa do roadmap, não como fonte da UI.
3. ✅ **O corte é escolha do usuário** (G2) — o seletor da janela oferece só os cortes que aquela medida aceita, conferidos contra prod.
4. ✅ **Cortes por pessoa reusam `performance.view`** (G6). Não foi preciso criar `metrics.view`.
5. ✅ **Trava de liberação por org** (G5): `organizations.metrics_studio_enabled`, migration `20270811100000`. Falha para FECHADO — enquanto não estiver em prod, o Estúdio fica invisível para todos. Fecha três portas: rota, item da top bar e command palette.
7. ✅ **Modos Visualização e Edição** (SCRUM-308). Nasce em Visualização; canvas travado, sem alças nem controles, lista lateral recolhida.
8. ✅ **Painel persistido no servidor** (SCRUM-309): `metrics_studio_panels`, um por (org, membro), migration `20270811110000`. NÃO reusa `dashboard_widgets` — ver o cabeçalho da migration para os quatro motivos medidos.
6. 🟠 **15 das 29 do inventário seguem fora do motor** — é o SCRUM-311 que as porta.
   Eram 17 quando esta linha nasceu; o motor ganhou medidas desde então.
   **Não copie este número — conte:** cruze os `id` de `metrics-studio-catalog.ts`
   contra `ENGINE_METRICS` de `metrics-studio-engine-map.ts`. Das 15, **5 travam
   em decisão de produto** (SCRUM-365) e as outras 10 estão fatiadas em
   SCRUM-389…394, agrupadas por FONTE partilhada — portar duas medidas que leem
   a mesma tabela em fatias separadas faz cada uma reimplementar o mesmo join.
9. ✅ **Período personalizado** (SCRUM-313): `StudioPeriod` aceita `"custom"` e
   `StudioRange` carrega duas datas de CALENDÁRIO. 🔴 O Comando faz diferente —
   `useCommandMetrics` recorta com `startOfUTCDay` NO CLIENTE, e para uma org em
   BRT isso desloca a virada do dia em 3 horas. Aqui as datas viajam cruas e o
   servidor corta. As duas telas devem PARECER iguais, não CALCULAR igual
   (SCRUM-322).

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
