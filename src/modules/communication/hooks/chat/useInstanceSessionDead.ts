/**
 * useInstanceSessionDead — is this conversation's WhatsApp number logged out?
 *
 * Source: `whatsapp_instances.session_dead_since`, set by the session watchdog
 * and cleared on recovery. It can lag a logout or a re-pair by a few minutes,
 * so it only WARNS the seller before they type; it never blocks a send. The
 * real gate is the provider: on a dead session the proxy refuses at once with
 * 409 `instance_disconnected` (Carol Distribuidora, 2026-11-24).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

export function useInstanceSessionDead(instanceId: string | null | undefined): boolean {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id;

  const { data } = useQuery({
    queryKey: ["whatsapp_instance_session_dead", organizationId, instanceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("session_dead_since")
        .eq("id", instanceId!)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      if (error) throw error;
      return data?.session_dead_since ?? null;
    },
    enabled: !!instanceId && !!organizationId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return !!data;
}
