import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export function useClientAlerts(clientId?: string) {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["client-alerts", organizationId, clientId],
    queryFn: async () => {
      let q = supabase
        .from("client_alerts")
        .select("*")
        .eq("organization_id", organizationId!)
        .eq("is_resolved", false)
        .order("created_at", { ascending: false });

      if (clientId) q = q.eq("client_id", clientId);

      const { data } = await q;
      return data ?? [];
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();

  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      await supabase
        .from("client_alerts")
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", alertId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-alerts"] });
    },
  });

  return { ...query, resolveAlert };
}
