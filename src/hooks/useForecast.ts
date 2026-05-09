import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface ForecastData {
  weightedTotal: number;
  expectedThisMonth: number;
  openDealCount: number;
  avgProbability: number;
}

/**
 * Weighted pipeline forecast.
 * Formula: sum(deal_value * stage_probability / 100).
 * Uses pipeline_stages.default_probability when deal.probability is null.
 */
export function useForecast() {
  const { organizationId, isReady } = useOrganization();

  return useQuery<ForecastData>({
    queryKey: ["forecast", organizationId],
    queryFn: async () => {
      if (!organizationId) {
        return { weightedTotal: 0, expectedThisMonth: 0, openDealCount: 0, avgProbability: 0 };
      }

      // Fetch open deals
      const { data: deals, error: dealsErr } = await (supabase.from as any)("deals")
        .select("id, value, probability, stage_id, expected_close_date")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .is("won", null);

      if (dealsErr) throw dealsErr;
      if (!deals?.length) {
        return { weightedTotal: 0, expectedThisMonth: 0, openDealCount: 0, avgProbability: 0 };
      }

      // Fetch stage probabilities
      const stageIds = [...new Set(deals.filter((d: any) => d.stage_id).map((d: any) => d.stage_id))];
      let stageProbs: Record<string, number> = {};

      if (stageIds.length) {
        const { data: stages } = await supabase
          .from("pipeline_stages")
          .select("id, default_probability")
          .in("id", stageIds);

        if (stages) {
          stages.forEach((s: any) => {
            stageProbs[s.id] = s.default_probability ?? 50;
          });
        }
      }

      const now = new Date();
      const thisMonth = now.getMonth();
      const thisYear = now.getFullYear();

      let weightedTotal = 0;
      let expectedThisMonth = 0;
      let probSum = 0;

      for (const deal of deals as any[]) {
        const value = deal.value ?? 0;
        const prob = deal.probability ?? (deal.stage_id ? stageProbs[deal.stage_id] ?? 50 : 50);
        const weighted = value * (prob / 100);
        weightedTotal += weighted;
        probSum += prob;

        if (deal.expected_close_date) {
          const close = new Date(deal.expected_close_date);
          if (close.getMonth() === thisMonth && close.getFullYear() === thisYear) {
            expectedThisMonth += weighted;
          }
        }
      }

      return {
        weightedTotal,
        expectedThisMonth,
        openDealCount: deals.length,
        avgProbability: deals.length > 0 ? Math.round(probSum / deals.length) : 0,
      };
    },
    enabled: isReady && !!organizationId,
    staleTime: 2 * 60_000,
  });
}
