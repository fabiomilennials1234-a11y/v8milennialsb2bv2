import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
export interface ProductRankingItem {
  product_id: string;
  product_name: string;
  product_type: "mrr" | "projeto";
  qty_sold: number;
  total_value: number;
  ticket_medio: number;
}

function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

/**
 * @param rangeOverride — intervalo arbitrário (Comando period-aware). Quando
 *   presente, tem precedência sobre `month`/`year` e é usado direto nos
 *   `p_start_date`/`p_end_date` da RPC (que já é range-based). Ausente →
 *   intervalo UTC-do-mês de sempre, comportamento inalterado.
 */
export function useProductRanking(
  month?: number,
  year?: number,
  rangeOverride?: { start: Date; end: Date } | null,
) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const { startStr, endStr } = rangeOverride
    ? { startStr: rangeOverride.start.toISOString(), endStr: rangeOverride.end.toISOString() }
    : getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    // Chave reflete o start/end EFETIVO — sem override, deriva de month/year
    // deterministicamente, então a identidade da query é idêntica à de antes.
    queryKey: ["product-ranking", startStr, endStr, organizationId],
    queryFn: async (): Promise<ProductRankingItem[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase.rpc("get_product_ranking", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
      });

      if (error) {
        console.error("[useProductRanking] RPC error:", error);
        return [];
      }

      const raw = Array.isArray(data) ? data : (data ? [data] : []);
      const items = raw.length === 1 && Array.isArray(raw[0]) ? raw[0] : raw;
      return items as ProductRankingItem[];
    },
    enabled: !!organizationId,
    staleTime: 120000,
  });
}
