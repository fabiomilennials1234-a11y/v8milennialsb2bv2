import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DealInsight {
  id: string;
  deal_id: string;
  health_score: number;
  positive_factors: string[];
  negative_factors: string[];
  suggestions: string[];
  risk_level: RiskLevel;
  predicted_close_probability: number | null;
  computed_at: string;
  expires_at: string;
}

export function useDealInsight(dealId: string | null) {
  return useQuery<DealInsight | null>({
    queryKey: ["deal-insight", dealId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("deal_insights")
        .select("*")
        .eq("deal_id", dealId!)
        .gte("expires_at", new Date().toISOString())
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as DealInsight | null;
    },
    enabled: !!dealId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDealsAtRisk(orgId: string | null) {
  return useQuery<DealInsight[]>({
    queryKey: ["deals-at-risk", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("deal_insights")
        .select("*")
        .in("risk_level", ["high", "critical"])
        .gte("expires_at", new Date().toISOString())
        .order("health_score", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as DealInsight[];
    },
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}
