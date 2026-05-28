import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface WinStreakData {
  streak: number;
  metricType: "sales" | "meetings";
}

export function useWinStreak(memberId: string | null) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["win-streak", organizationId, memberId],
    queryFn: async (): Promise<WinStreakData> => {
      const { data, error } = await supabase.rpc("get_win_streak", {
        p_org_id: organizationId!,
        p_member_id: memberId!,
      });

      if (error) throw error;

      const raw = data as { streak: number; metric_type: string };
      return {
        streak: raw.streak,
        metricType: raw.metric_type as "sales" | "meetings",
      };
    },
    enabled: !!organizationId && !!memberId,
    staleTime: 5 * 60 * 1000,
  });
}
