import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { isMissingSchemaError } from "@/lib/rpc-errors";

// Métricas Montáveis, Camada 2 (#1194 / ADR-0023).
// Widget ÚNICO via fn_metric_measure. Usado no design-time do Composer (preview
// por widget, debounced) e por consumidores pontuais. A TV usa o snapshot de
// página (useDashboardSnapshot), não este hook em loop.

export type MetricPeriod = "day" | "week" | "month" | "range";

// measure_ref: leaf {id} | ratio {num,den}. Só IDs do catálogo — nunca SQL/coluna.
export type MeasureRef =
  | { kind: "leaf"; id: string }
  | { kind: "ratio"; num: string; den: string };

// Allowlist de filtros — espelha o trigger do banco. NUNCA organization_id.
export interface MetricFilters {
  pipeline_id?: string;
  member_id?: string;
  origin?: string;
  tag_id?: string;
  product_id?: string;
  stream?: "novo_negocio" | "carteira";
}

export interface MetricMeasureResult {
  kind: "leaf" | "ratio";
  measure_id?: string;
  measure_ref?: MeasureRef;
  unit: string;
  currency: string | null;
  anchor: string | null;
  recorte?: string;
  value: number | null;
  series: { key: string | null; label: string; value: number }[] | null;
  empty_reason: string | null;
  /** Só em kind='ratio': os 2 filhos da razão (profundidade 1, exatamente 2). */
  num?: { measure_id: string; value: number | null; unit: string };
  den?: { measure_id: string; value: number | null; unit: string };
  provenance?: { period_label: string | null; stream: string | null; note: string | null };
}

interface UseMetricMeasureArgs {
  measureRef: MeasureRef | null;
  recorte: string;
  period?: MetricPeriod;
  ref?: string | null;
  start?: string | null;
  end?: string | null;
  filters?: MetricFilters;
  /** Desliga a query (ex.: config de widget ainda incompleta). */
  enabled?: boolean;
}

export function useMetricMeasure({
  measureRef,
  recorte,
  period = "month",
  ref = null,
  start = null,
  end = null,
  filters = {},
  enabled = true,
}: UseMetricMeasureArgs) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    // A chave inclui todos os parâmetros → o cache client evita chamada idêntica
    // repetida no mesmo widget (pedido do Vitral para o preview debounced).
    queryKey: [
      "metric-measure",
      organizationId,
      measureRef,
      recorte,
      period,
      ref,
      start,
      end,
      filters,
    ],
    queryFn: async (): Promise<MetricMeasureResult | null> => {
      if (!measureRef) return null;
      const { data, error } = await supabase.rpc("fn_metric_measure" as any, {
        p_org_id: organizationId,
        p_measure_ref: measureRef,
        p_recorte: recorte,
        p_period: period,
        p_ref: ref,
        p_start: start,
        p_end: end,
        p_filters: filters,
      });
      if (error) {
        if (isMissingSchemaError(error)) return null; // migration ainda não em prod
        throw new Error(`Metric measure failed: ${error.message}`);
      }
      return (data as unknown as MetricMeasureResult) ?? null;
    },
    enabled: enabled && isReady && !!organizationId && !!measureRef && !!recorte,
    staleTime: 30 * 1000,
  });
}
