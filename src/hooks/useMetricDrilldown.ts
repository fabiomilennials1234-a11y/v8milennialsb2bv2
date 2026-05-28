import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
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
  lead: { name: string | null; company_name: string | null } | null;
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
  id, lead_id, sale_value, status, product_type,
  closed_at, created_at, updated_at,
  lead:leads!pipeline_entries_lead_id_fkey(name, company_name),
  responsible:team_members!pipeline_entries_assigned_to_fkey(name)
`;

export function useMetricDrilldown(metricType: MetricType, range: DateRange | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["metric-drilldown", metricType, range?.startStr ?? "all", range?.endStr ?? "all", organizationId],
    queryFn: async (): Promise<DrilldownRow[]> => {
      if (!organizationId) return [];

      let query = supabase
        .from("pipe_propostas")
        .select(SELECT)
        .eq("organization_id", organizationId);

      if (metricType === "pipeline_ativo") {
        query = query.in("status", ACTIVE_STATUSES);
      } else if (metricType === "vendas_total" || metricType === "rec_vendida" || metricType === "projetos_vendidos") {
        query = query.eq("status", "vendido");
      }
      // taxa_conversao: no status filter

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

      let rows = (data ?? []) as DrilldownRow[];

      if (metricType === "rec_vendida") {
        rows = rows.filter((r) => r.product_type === "mrr");
      } else if (metricType === "projetos_vendidos") {
        rows = rows.filter((r) => r.product_type === "projeto");
      }

      return rows;
    },
    enabled: isReady && !!organizationId,
    staleTime: 60000,
  });
}
