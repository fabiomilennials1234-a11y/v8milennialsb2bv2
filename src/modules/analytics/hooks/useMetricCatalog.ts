import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingSchemaError } from "@/lib/rpc-errors";

// Métricas Montáveis, Camada 2 (#1194 / ADR-0023).
// Catálogo FECHADO servido por fn_metric_catalog() — global, read-only, sem org.
// Monta a UI de composição (Vitral): quais medidas, recortes, formatos e
// presets de razão existem, e a compatibilidade entre eles.

export interface MetricCatalogMeasure {
  id: string;
  label: string;
  unit: "currency" | "count" | "duration_seconds" | "percent" | "ratio";
  anchor: "entradas" | "fechamentos" | "hoje";
  description: string | null;
  compatible_recortes: string[];
  compatible_formats: string[];
}

export interface MetricCatalogRatio {
  id: string;
  label: string;
  num: string;
  den: string;
  format: string;
  unit: "percent" | "currency" | "ratio";
}

export interface MetricCatalogRenderer {
  id: string;
  label: string;
  description: string | null;
  /** Célula reservada (legado): o Composer NÃO deve oferecê-la como composível. */
  is_legacy: boolean;
}

export interface MetricCatalog {
  measures: MetricCatalogMeasure[];
  recortes: { id: string; label: string }[];
  formats: { id: string; label: string }[];
  ratios: MetricCatalogRatio[];
  renderers: MetricCatalogRenderer[];
}

const EMPTY: MetricCatalog = { measures: [], recortes: [], formats: [], ratios: [], renderers: [] };

export function useMetricCatalog() {
  return useQuery({
    queryKey: ["metric-catalog"],
    queryFn: async (): Promise<MetricCatalog> => {
      const { data, error } = await supabase.rpc("fn_metric_catalog" as any);
      if (error) {
        if (isMissingSchemaError(error)) return EMPTY; // migration ainda não em prod
        throw new Error(`Metric catalog failed: ${error.message}`);
      }
      return (data as unknown as MetricCatalog) ?? EMPTY;
    },
    // Catálogo é semeado por migration e praticamente imutável em runtime.
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
  });
}
