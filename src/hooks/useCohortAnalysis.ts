import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface CohortRow {
  cohort_month: string;
  month_offset: number;
  active_clients: number;
  total_clients: number;
  retention_pct: number;
}

export function useCohortAnalysis(filters?: { segment?: string; closer_id?: string }) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["cohort-analysis", organizationId, filters],
    queryFn: async () => {
      let query = supabase
        .from("portfolio_retention_cohorts" as any)
        .select("cohort_month, month_offset, active_clients, total_clients, retention_pct")
        .eq("organization_id", organizationId!);

      if (filters?.segment) {
        query = query.eq("segment", filters.segment);
      }
      if (filters?.closer_id) {
        query = query.eq("closer_id", filters.closer_id);
      }

      const { data, error } = await query.order("cohort_month", { ascending: true });
      if (error) throw error;

      // Aggregate rows by cohort_month + month_offset (sum across filters)
      const map = new Map<string, CohortRow>();
      for (const row of (data ?? []) as any[]) {
        const key = `${row.cohort_month}|${row.month_offset}`;
        const existing = map.get(key);
        if (existing) {
          existing.active_clients += row.active_clients;
          existing.total_clients += row.total_clients;
          existing.retention_pct = existing.total_clients > 0
            ? Math.round((existing.active_clients / existing.total_clients) * 100)
            : 0;
        } else {
          map.set(key, { ...row });
        }
      }

      return Array.from(map.values());
    },
    enabled: !!organizationId,
    staleTime: 300_000,
  });
}
