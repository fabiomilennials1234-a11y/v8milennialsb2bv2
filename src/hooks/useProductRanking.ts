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

export function useProductRanking(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["product-ranking", selectedMonth, selectedYear, organizationId],
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
