import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
export interface SellerActivity {
  id: string;
  name: string;
  role: string;
  metricType: string;
  leads: number;
  followups: number;
  reunioes: number;
  propostas: number;
  vendas: number;
  scoreBruto: number;
  scoreNormalizado: number;
}

function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

export function useSellerActivity(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["seller-activity", selectedMonth, selectedYear, organizationId],
    queryFn: async (): Promise<SellerActivity[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase.rpc("get_seller_activity_scores", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
      });

      if (error) {
        console.error("[useSellerActivity] RPC error:", error);
        return [];
      }

      const raw = Array.isArray(data) ? data : [];
      return raw as SellerActivity[];
    },
    enabled: !!organizationId,
    staleTime: 120000,
  });
}
