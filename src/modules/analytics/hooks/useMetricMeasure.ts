import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { isMissingSchemaError } from "@/lib/rpc-errors";
import type { MetricTreeNode } from "@/modules/analytics/lib/metric-tree";
import type { MetricFilters, MetricFormatId } from "@/modules/analytics/lib/metric-vocabulary";

// Métricas Montáveis, Camada 2 (#1194 / ADR-0023).
// Widget ÚNICO via fn_metric_measure. Usado no design-time do Composer (preview
// por widget, debounced) e por consumidores pontuais. A TV usa o snapshot de
// página (useDashboardSnapshot), não este hook em loop.

export type MetricPeriod = "day" | "week" | "month" | "range";

/**
 * measure_ref — só IDs do catálogo, nunca SQL/coluna.
 *
 *   leaf   {id}            uma medida
 *   ratio  {num,den}       razão v1 (profundidade 1) — deriva percent e
 *                          MULTIPLICA por 100 em count/count
 *   custom {id}            definição salva em `metric_custom_definitions`
 *   tree   {tree,...}      árvore inline, para a prévia do compositor
 *
 * ⚠ `custom` e `tree` (Emenda 1 do ADR-0023) NÃO multiplicam por 100 em
 * unidade nenhuma: `count ÷ count` deriva `ratio`. Quem quer percentual põe
 * `× 100` na própria árvore. Ver `lib/metric-tree.ts`.
 */
export type MeasureRef =
  | { kind: "leaf"; id: string }
  | { kind: "ratio"; num: string; den: string }
  | { kind: "custom"; id: string }
  | { kind: "tree"; tree: MetricTreeNode; format_id?: MetricFormatId };

// Re-exportado daqui por compatibilidade: o tipo mora em `lib/metric-vocabulary`
// para não fechar ciclo com `metric-tree`.
export type { MetricFilters };

export interface MetricMeasureResult {
  kind: "leaf" | "ratio" | "custom" | "tree";
  measure_id?: string;
  measure_ref?: MeasureRef;
  /** Só em kind='custom': o nome que o cliente deu à métrica. */
  label?: string | null;
  /** Só em custom/tree: o formato declarado na definição. */
  format_id?: MetricFormatId | null;
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

/**
 * Chamada imperativa do motor. Existe para quem precisa do número FORA de um
 * componente — hoje o relatório (SCRUM-312), que busca N métricas de uma vez
 * ao clicar em exportar e não pode montar N hooks.
 *
 * O hook abaixo consome esta mesma função: manter os dois caminhos idênticos
 * é o que impede a exportação de divergir da tela.
 */
export async function fetchMetricMeasure(args: {
  organizationId: string;
  measureRef: MeasureRef;
  recorte: string;
  period?: MetricPeriod;
  ref?: string | null;
  start?: string | null;
  end?: string | null;
  filters?: MetricFilters;
}): Promise<MetricMeasureResult | null> {
  const { data, error } = await supabase.rpc("fn_metric_measure" as any, {
    p_org_id: args.organizationId,
    p_measure_ref: args.measureRef,
    p_recorte: args.recorte,
    p_period: args.period ?? "month",
    p_ref: args.ref ?? null,
    p_start: args.start ?? null,
    p_end: args.end ?? null,
    p_filters: args.filters ?? {},
  });
  if (error) {
    if (isMissingSchemaError(error)) return null; // migration ainda não em prod
    throw new Error(`Metric measure failed: ${error.message}`);
  }
  return (data as unknown as MetricMeasureResult) ?? null;
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
      if (!measureRef || !organizationId) return null;
      return fetchMetricMeasure({
        organizationId,
        measureRef,
        recorte,
        period,
        ref,
        start,
        end,
        filters,
      });
    },
    enabled: enabled && isReady && !!organizationId && !!measureRef && !!recorte,
    staleTime: 30 * 1000,
  });
}
