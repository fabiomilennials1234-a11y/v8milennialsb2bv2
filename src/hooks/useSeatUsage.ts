/**
 * useSeatUsage — hook que retorna uso de seats da org atual.
 * Chama a RPC org_get_seat_usage e cacheia por 2 minutos.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SeatUsage {
  paid_seats: number;
  active_members: number;
  plan_name: string;
  is_unlimited: boolean;
  can_add: boolean;
  remaining: number;
}

export function useSeatUsage(organizationId: string | undefined) {
  return useQuery<SeatUsage>({
    queryKey: ["seat-usage", organizationId],
    queryFn: async () => {
      if (!organizationId) throw new Error("No organization ID");
      const { data, error } = await supabase.rpc("org_get_seat_usage", {
        p_org_id: organizationId,
      });
      if (error) throw error;
      return data as unknown as SeatUsage;
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}
