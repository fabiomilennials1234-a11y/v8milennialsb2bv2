/**
 * Module analytics — API pública.
 *
 * Public surface do bounded context (visão agregada de performance da org).
 * Tudo cross-module passa por aqui. Internals (components/, pages/) são
 * privados — ESLint `boundaries` impede import direto fora da API pública.
 *
 * Status: Active (populado em slice 12 — feat/modularizacao/11-analytics).
 *
 * Domínios cobertos:
 * - Dashboard (KPIs principais — leads novos, conversão, ticket, receita)
 * - Dashboard Outbound (queue health do envio em massa)
 * - TV Dashboard (display rotativo de parede com period rotation)
 * - Performance (view por vendedor — cross-cut com engagement)
 * - Analytics moderno (8 sub-domínios: comercial, engajamento, filtros, financeiro,
 *   overview, pipes/funis, utms, geral)
 * - Cohort Analysis (coortes de lead/cliente)
 * - Marketing por origem (UTMs + Mkt Origin Config + benchmark de segmento)
 * - Split A/B metrics (consumido por workflows)
 * - Outbound Metrics (queue + envio histórico)
 * - Exchange Rates (conversão multi-moeda)
 *
 * Pages NÃO são re-exportadas — App.tsx faz deep-import via React.lazy
 * (padrão dos slices 4-11):
 *   @/modules/analytics/pages/Dashboard
 *   @/modules/analytics/pages/DashboardOutbound
 *   @/modules/analytics/pages/Performance
 *   @/modules/analytics/pages/TVDashboard
 */

// ────────────────────────────────────────────────────────────────────────
// Hooks — Analytics moderno (8 sub-domínios)
// ────────────────────────────────────────────────────────────────────────

// useAnalytics expõe `FunnelStage` que colide com `useAnalyticsPipesFunis.FunnelStage`.
// Re-exportamos apenas as funções/interfaces sem colisão.
export {
  useFunnelConversion,
  usePipelineVelocity,
  useRevenueAttribution,
  useSalesCycleAnalysis,
  useWinLossAnalysis,
} from "./hooks/useAnalytics";
export type {
  PipelineVelocity,
  RevenueAttribution,
  SalesCycleStage,
  WinLossItem,
} from "./hooks/useAnalytics";

export * from "./hooks/useAnalyticsComercial";
export * from "./hooks/useAnalyticsEngajamento";
export * from "./hooks/useAnalyticsFilters";
export * from "./hooks/useAnalyticsFinanceiro";

// useAnalyticsOverview expõe `CohortRow` que colide com `useCohortAnalysis.CohortRow`.
// Re-exportamos sem o tipo colidente (consumidores fazem deep-import se precisarem).
export {
  useAnalyticsOverview,
} from "./hooks/useAnalyticsOverview";
export type {
  CohortRetentionPoint,
  UnitEconomics,
  AttributionRow,
  VelocityTransition,
  SalesVelocity,
  OverviewInsight,
  OverviewMetrics,
} from "./hooks/useAnalyticsOverview";

export * from "./hooks/useAnalyticsPipesFunis";
export * from "./hooks/useAnalyticsUtms";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Cohort Analysis
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useCohortAnalysis";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Dashboard Metrics (cross-cutting consumido por engagement/Metas)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useDashboardMetrics";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Exchange Rates (multi-currency)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useExchangeRates";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Marketing por origem (UTMs + Origin Config + Segment Benchmark)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useMktByOrigin";
export * from "./hooks/useMktOriginConfig";
export * from "./hooks/useSegmentBenchmark";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Outbound Metrics (queue health + envio histórico)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useOutboundMetrics";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Split A/B Metrics (consumido por workflows)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useSplitAbMetrics";

// ────────────────────────────────────────────────────────────────────────
// Hooks — TV Dashboard (display rotativo de parede)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useTVDashboardData";
export * from "./hooks/useTVKPIs";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Funnel Health (indicador de saúde do funil, coorte por criação)
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useFunnelHealth";
export * from "./lib/funnel-health-stages";

// ────────────────────────────────────────────────────────────────────────
// Hooks — Métricas Montáveis, Camada 2 (#1194 / ADR-0023)
// Catálogo fechado + motor + snapshot. v1 liga SÓ a TV.
// ────────────────────────────────────────────────────────────────────────

export * from "./hooks/useMetricCatalog";
export * from "./hooks/useMetricMeasure";
export * from "./hooks/useDashboardSnapshot";

// Casca da TV montável (#1207): grid 12×6, WidgetFrame, painel semeado.
export * from "./hooks/useComposableDashboard";
export * from "./lib/tv-metric-format";
export * from "./lib/tv-provenance";
export * from "./lib/tv-density";
export { WidgetFrame } from "./components/tv/composable/WidgetFrame";
export { TVGrid, TVGridCell } from "./components/tv/composable/TVGrid";
// Renderers (#1218): barra, linha, donut + seletor de corpo.
export * from "./lib/tv-series";
export * from "./lib/tv-chart-type";
export { TVWidgetBody } from "./components/tv/composable/TVWidgetBody";
export { BarRenderer } from "./components/tv/composable/renderers/BarRenderer";
export { LineRenderer } from "./components/tv/composable/renderers/LineRenderer";
export { DonutRenderer } from "./components/tv/composable/renderers/DonutRenderer";
export { TVComposableWall } from "./components/tv/composable/TVComposableWall";
export { TVComposableShell } from "./components/tv/composable/TVComposableShell";
