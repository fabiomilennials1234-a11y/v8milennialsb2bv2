import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
export interface SegmentBenchmarkData {
  available: boolean;
  reason?: string;
  segment?: string;
  peerCount?: number;
  avgTicketMedio?: number;
  avgLeadsPerSeller?: number;
  avgConversionRate?: number;
}

export function useSegmentBenchmark() {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["segment-benchmark", organizationId],
    queryFn: async (): Promise<SegmentBenchmarkData> => {
      if (!organizationId) return { available: false, reason: "no_org" };

      const { data, error } = await supabase.rpc("get_segment_benchmark", {
        p_org_id: organizationId,
      });

      if (error) {
        console.error("[useSegmentBenchmark] RPC error:", error);
        return { available: false, reason: "error" };
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return raw as SegmentBenchmarkData;
    },
    enabled: !!organizationId,
    staleTime: 300000,
  });
}
