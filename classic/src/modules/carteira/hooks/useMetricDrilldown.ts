import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { usePipelineId } from "@/modules/pipelines/hooks/model/usePipelineEntries";
import type { DateRange } from "@/lib/metrics-period";

export type MetricType =
  | "pipeline_ativo"
  | "vendas_total"
  | "rec_vendida"
  | "projetos_vendidos"
  | "taxa_conversao";

export interface DrilldownRow {
  id: string;
  lead_id: string;
  sale_value: number | null;
  status: string;
  product_type: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  lead: { name: string | null; company: string | null } | null;
  responsible: { name: string | null } | null;
}

const ACTIVE_STATUSES = [
  "marcar_compromisso",
  "reativar",
  "compromisso_marcado",
  "proposta_enviada",
  "esfriou",
  "futuro",
];

const SELECT = `
  id, lead_id, stage_key, metadata, closed_at, created_at, updated_at,
  lead:leads!pipeline_entries_lead_id_fkey(name, company),
  responsible:team_members!pipeline_entries_assigned_to_fkey(name),
  items:pipe_proposta_items!pipe_proposta_items_pipeline_entry_id_fkey(sale_value, product:products(type))
`;

function resolveProductType(entry: any): string | null {
  const items = entry.items?.filter((i: any) => i != null) ?? [];
  if (items.length > 0) {
    const types = new Set(items.map((i: any) => i.product?.type).filter(Boolean));
    if (types.has("mrr")) return "mrr";
    if (types.has("projeto")) return "projeto";
    return "unitario";
  }
  const meta = (entry.metadata as Record<string, any>) ?? {};
  return meta.product_type ?? null;
}

function mapEntry(entry: any): DrilldownRow {
  const meta = (entry.metadata as Record<string, any>) ?? {};
  return {
    id: entry.id,
    lead_id: entry.lead_id,
    sale_value: meta.sale_value != null ? Number(meta.sale_value) : null,
    status: entry.stage_key,
    product_type: resolveProductType(entry),
    closed_at: entry.closed_at,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    lead: entry.lead,
    responsible: entry.responsible,
  };
}

export function useMetricDrilldown(metricType: MetricType, range: DateRange | null) {
  const { organizationId, isReady } = useOrganization();
  const { data: pipelineId } = usePipelineId("propostas");

  return useQuery({
    queryKey: ["metric-drilldown", metricType, range?.startStr ?? "all", range?.endStr ?? "all", organizationId, pipelineId],
    queryFn: async (): Promise<DrilldownRow[]> => {
      if (!organizationId || !pipelineId) return [];

      let query = supabase
        .from("pipeline_entries")
        .select(SELECT)
        .eq("pipeline_id", pipelineId);

      if (metricType === "pipeline_ativo") {
        query = query.in("stage_key", ACTIVE_STATUSES);
      } else if (metricType === "vendas_total" || metricType === "rec_vendida" || metricType === "projetos_vendidos") {
        query = query.eq("stage_key", "vendido");
      }

      if (range && metricType !== "pipeline_ativo") {
        if (metricType === "vendas_total" || metricType === "rec_vendida" || metricType === "projetos_vendidos") {
          query = query
            .not("closed_at", "is", null)
            .gte("closed_at", range.startStr)
            .lte("closed_at", range.endStr);
        } else {
          query = query
            .gte("created_at", range.startStr)
            .lte("created_at", range.endStr);
        }
      }

      const { data, error } = await query.order("closed_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      let rows = (data ?? []).map(mapEntry);

      if (metricType === "rec_vendida") {
        rows = rows.filter((r) => r.product_type === "mrr");
      } else if (metricType === "projetos_vendidos") {
        rows = rows.filter((r) => r.product_type === "projeto");
      }

      return rows;
    },
    enabled: isReady && !!organizationId && !!pipelineId,
    staleTime: 60000,
  });
}
