import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import type { MetricMeasureResult, MetricPeriod } from "./useMetricMeasure";

// Métricas Montáveis, Camada 2 (#1194 / ADR-0023).
// Snapshot de PÁGINA inteira via fn_dashboard_snapshot — 1 round-trip, erro
// isolado por widget. É o caminho da TV (poll 30s). v1 liga SÓ a TV.

export interface DashboardWidgetSnapshot {
  widget_id: string;
  /** 'legacy' = célula reservada: o motor reconhece o renderer mas não avalia medida. */
  measure_kind?: "leaf" | "ratio" | "legacy";
  /** Só em measure_kind='legacy'. Resolvido no front para um componente legado. */
  renderer_id?: string | null;
  weight?: "hero" | "primary" | "secondary";
  format_id?: string | null;
  recorte_id?: string | null;
  eyebrow_override?: string | null;
  grid?: { col: number; row: number; w: number; h: number };
  pinned?: boolean;
  filters?: Record<string, string> | null;
  /** null em célula legada — não há medida a avaliar. */
  measure?: MetricMeasureResult | null;
  error?: "unavailable"; // widget quebrado isolado, não derruba a página
}

export interface DashboardSnapshot {
  disabled: boolean; // true quando a flag composable_metrics está OFF na org
  page_id: string;
  widgets: DashboardWidgetSnapshot[];
}

interface UseDashboardSnapshotArgs {
  pageId: string | null;
  period?: MetricPeriod;
  ref?: string | null;
  start?: string | null;
  end?: string | null;
  /** TV liga o dia todo: re-fetch a cada 30s (orçamento #1208). */
  pollMs?: number;
  enabled?: boolean;
}

export function useDashboardSnapshot({
  pageId,
  period = "month",
  ref = null,
  start = null,
  end = null,
  pollMs = 30_000,
  enabled = true,
}: UseDashboardSnapshotArgs) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["dashboard-snapshot", organizationId, pageId, period, ref, start, end],
    queryFn: async (): Promise<DashboardSnapshot | null> => {
      if (!pageId) return null;
      const { data, error } = await supabase.rpc("fn_dashboard_snapshot" as any, {
        p_org_id: organizationId,
        p_page_id: pageId,
        p_period: period,
        p_ref: ref,
        p_start: start,
        p_end: end,
      });
      if (error) {
        if (isMissingSchemaError(error)) return null; // migration ainda não em prod
        throw new Error(`Dashboard snapshot failed: ${error.message}`);
      }
      return (data as unknown as DashboardSnapshot) ?? null;
    },
    enabled: enabled && isReady && !!organizationId && !!pageId,
    // Um fetch por página; a troca de página é nó em memória (design §6.1).
    refetchInterval: pollMs,
    staleTime: pollMs,
  });
}
