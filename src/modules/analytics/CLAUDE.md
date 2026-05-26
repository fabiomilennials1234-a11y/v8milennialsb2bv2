# Module — analytics

**Status:** 🟡 Skeleton (slice 12 popula)
**BC:** analytics
**Entidade primária:** Dashboard + Metric + Cohort + TV Display
**Owner:** ops

## Escopo

Visão agregada do desempenho da org. Inclui:

- **Dashboard** — KPIs principais (leads novos, conversão, ticket médio, receita)
- **Dashboard Outbound** — fila de envio, queue health
- **TV Dashboard** — display rotativo pra parede do escritório
- **Performance** — view por vendedor (cross-cut com `engagement`)
- **Metas / Gestão de Metas** — definição e tracking
- **Revisão** — análise periódica
- **Cohort Analysis** — coortes de lead/cliente
- **UTMs / Mkt por Origin** — performance de origens de tráfego
- **Segment Benchmark** — comparativo entre orgs (master only)

## Não-escopo

- Métricas individuais do vendedor → `engagement` (ranking, performance)
- Métricas IA do Copilot → `copilot.useCopilotMetrics`
- Dashboard de saúde da carteira → `carteira.usePortfolioKPIs`

## API pública (`index.ts`) — TBD slice 12

Provável superfície:
- Hooks: `useAnalytics`, `useAnalyticsOverview`, `useAnalyticsComercial`, `useAnalyticsEngajamento`, `useAnalyticsFilters`, `useAnalyticsFinanceiro`, `useAnalyticsPipesFunis`, `useAnalyticsUtms`, `useDashboardMetrics`, `useTVDashboardData`, `useTVKPIs`, `useCohortAnalysis`, `useExchangeRates`, `useMktByOrigin`, `useMktOriginConfig`, `useSegmentBenchmark`, `useSplitAbMetrics`
- Components: `<DashboardGrid>`, `<TVRotator>`, `<MetricCard>`, `<CohortHeatmap>`
- Types: `Metric`, `Cohort`, `TVDashboardConfig`
- Eventos (post slice 19): n/a (read-only domain — consome eventos via aggregation tables)

## Áreas frágeis

- Receita mês "canônica" — ADR existente (ver refs)
- TV Dashboard period rotation — ADR-2026-05-22 (timing crítico)
- Filtros cross-pipe — tem que cruzar 3 tabelas pipe_*

## Origem (pastas atuais que migrarão pra cá)

Frontend:
- `src/components/analytics/`, `dashboard/`, `dashboard-outbound/`, `tv/`, `performance/`, `revisao/`
- `src/hooks/useAnalytics*.ts` (8 hooks)
- `src/hooks/useDashboardMetrics.ts`, `useTVDashboardData.ts`, `useTVKPIs.ts`
- `src/hooks/useCohortAnalysis.ts`, `useMktByOrigin.ts`, `useMktOriginConfig.ts`, `useSegmentBenchmark.ts`, `useSplitAbMetrics.ts`, `useExchangeRates.ts`
- `src/pages/Dashboard.tsx`, `DashboardOutbound.tsx`, `TVDashboard.tsx`, `Performance.tsx`, `Metas.tsx`, `GestaoMetas.tsx`, `Revisao.tsx`

Backend:
- `supabase/functions/meta-ads-insights/`

## Slice de migração

**Slice 12** — `feat/modularizacao/11-analytics` (5h)

## Dedup pendente

- 6 pastas em components → consolidar em `components/{dashboard,tv,outbound,performance,revisao}/`

## Refs

- ADR TV Dashboard period rotation: `Obsidian/.../04 — Decisões/ADR-2026-05-22-tv-dashboard-period-rotation.md`
- ADR receita mês canônica (referenciado no vault — buscar)
- TV Dashboard feature: `Obsidian/.../06 — Features/Dashboard/TV Dashboard.md`
