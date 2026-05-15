import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HealthSnapshot {
  snapshot_date: string;
  health_score: number;
  health_status: string;
  segment: string;
}

export function useHealthHistory(clientId: string | undefined) {
  return useQuery({
    queryKey: ["health-history", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_health_snapshots")
        .select("snapshot_date, health_score, health_status, segment")
        .eq("client_id", clientId!)
        .gte("snapshot_date", new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
        .order("snapshot_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as HealthSnapshot[];
    },
    enabled: !!clientId,
    staleTime: 120_000,
  });
}
