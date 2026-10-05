/**
 * useDeadSessions — lists WhatsApp instances of the current org whose Uazapi
 * session has been observed dead by the session watchdog.
 *
 * Source of truth: `whatsapp_instances.session_dead_since`, populated by the
 * `whatsapp-session-watchdog` edge function every 10 min and cleared on
 * recovery. Polling at 30s here keeps the banner reactive without realtime
 * channel subscription overhead (banner is global, not per-page).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember, useMasterAuth } from "@/modules/identity";
export type DeadSession = {
  id: string;
  instance_name: string;
  phone_number: string | null;
  session_dead_since: string;
  session_dead_reason: string | null;
};

export function useDeadSessions() {
  const { data: teamMember } = useCurrentTeamMember();
  const { isMaster } = useMasterAuth();
  const organizationId = teamMember?.organization_id;

  return useQuery({
    queryKey: ["whatsapp_dead_sessions", organizationId, teamMember?.id, teamMember?.role, isMaster],
    queryFn: async () => {
      if (!organizationId) return [] as DeadSession[];

      const { data, error } = await supabase
        .from("whatsapp_instances")
        .select("id, instance_name, phone_number, session_dead_since, session_dead_reason, owner_team_member_id, whatsapp_instance_allowed_members(team_member_id)")
        .eq("organization_id", organizationId)
        .not("session_dead_since", "is", null);

      if (error) throw error;
      return (data ?? []).filter(instance => {
        // Ownership is authoritative. Shared sessions notify their configured
        // members; only unassigned sessions fall back to org administrators.
        if (instance.owner_team_member_id) return instance.owner_team_member_id === teamMember?.id;
        const members = instance.whatsapp_instance_allowed_members;
        if (members.length) return members.some(member => member.team_member_id === teamMember?.id);
        return teamMember?.role === "admin" || isMaster;
      }) as unknown as DeadSession[];
    },
    enabled: !!organizationId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
