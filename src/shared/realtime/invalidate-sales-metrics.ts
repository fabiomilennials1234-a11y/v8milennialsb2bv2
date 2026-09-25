import type { QueryClient } from "@tanstack/react-query";

// Shared by the deal action and the metrics page: one sale affects several
// panels, including panels currently unmounted. Their layouts are not data.
const SALES_METRIC_KEYS = new Set([
  "metric-measure", "dashboard-snapshot", "dashboard-metrics", "command-metrics",
  "conversion-rates", "funnel-data", "ranking-data", "movement-metrics",
  "funnel-health", "funnel-health-stage-leads", "analytics-comercial",
  "analytics-financeiro", "analytics-overview", "analytics-pipes-funis",
  "analytics-utms", "win-loss", "sales-cycle", "funnel-conversion",
  "tv-dashboard-canonical", "tv-kpi-sales-canonical", "product-ranking", "vendedor-ranking",
]);

export function invalidateSalesMetrics(queryClient: QueryClient, organizationId: string | null | undefined) {
  if (!organizationId) return Promise.resolve();
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => SALES_METRIC_KEYS.has(String(queryKey[0]))
      && queryKey.includes(organizationId),
    refetchType: "active",
  });
}
