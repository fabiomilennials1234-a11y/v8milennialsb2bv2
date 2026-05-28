import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
// ─── Types ───────────────────────────────────────────────────────────────────
// Matches the return shape of the get_agenda_events RPC.

export interface AgendaEvent {
  id: string;
  source: "meeting" | "follow_up" | "scheduled_message" | "pipe_confirmacao";
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: boolean;
  event_type: string;
  status: string;
  lead_id: string | null;
  lead_name: string | null;
  lead_company: string | null;
  created_by: string | null;
  creator_name: string | null;
  location: string | null;
  meet_link: string | null;
  color: string | null;
  google_event_id: string | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Unified agenda feed that aggregates meetings, follow-ups,
 * scheduled messages, and pipe_confirmacao events via the
 * get_agenda_events RPC.
 */
export function useAgendaEvents(startDate?: Date, endDate?: Date) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: [
      "agenda-events",
      organizationId,
      startDate?.toISOString(),
      endDate?.toISOString(),
    ],
    queryFn: async () => {
      if (!organizationId || !startDate || !endDate) return [];

      // RPC is brand new — types not regenerated yet.
      // Cast to bypass TS strict check on the function name.
      const { data, error } = await supabase.rpc(
        "get_agenda_events" as "get_org_member_stats",
        {
          p_organization_id: organizationId,
          p_start: startDate.toISOString(),
          p_end: endDate.toISOString(),
        } as unknown as Parameters<typeof supabase.rpc>[1],
      );

      if (error) throw error;
      return (data ?? []) as unknown as AgendaEvent[];
    },
    enabled: isReady && !!organizationId && !!startDate && !!endDate,
    staleTime: 30_000,
  });
}
