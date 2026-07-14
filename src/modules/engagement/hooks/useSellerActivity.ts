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

/**
 * @param rangeOverride — intervalo arbitrário (Comando period-aware). Quando
 *   presente, tem precedência sobre `month`/`year` e vai direto nos
 *   `p_start_date`/`p_end_date` da RPC (que já é range-based). Ausente →
 *   intervalo UTC-do-mês de sempre, comportamento inalterado.
 */
export function useSellerActivity(
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
    queryKey: ["seller-activity", startStr, endStr, organizationId],
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
