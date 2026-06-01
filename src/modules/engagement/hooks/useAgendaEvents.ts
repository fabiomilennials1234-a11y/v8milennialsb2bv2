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

      if (error) {
        // Dev-environment drift fallback: get_agenda_events UNIONs several
        // source tables; if one is missing on a partially-migrated database
        // (e.g. scheduled_user_messages on dev), the whole RPC throws 42P01.
        // Production is fully migrated, so the RPC succeeds there and this
        // branch never runs. We rebuild the feed client-side from the tables
        // that do exist so the local frontend stays usable.
        if (isMissingRelationError(error)) {
          return fetchAgendaFallback(organizationId, startDate, endDate);
        }
        throw error;
      }
      return (data ?? []) as unknown as AgendaEvent[];
    },
    enabled: isReady && !!organizationId && !!startDate && !!endDate,
    staleTime: 30_000,
  });
}

// ─── Dev-drift fallback ────────────────────────────────────────────────────────
// Only used when get_agenda_events errors because a UNIONed table is missing on a
// partially-migrated database. Mirrors the RPC's mapping for the tables that exist
// (meetings, follow_ups, pipe_confirmacao). scheduled_user_messages is intentionally
// skipped — it's the table missing on dev. Inert in production.

type PgError = { code?: string; message?: string };

function isMissingRelationError(error: unknown): boolean {
  const e = error as PgError;
  return e?.code === "42P01" || /does not exist/i.test(e?.message ?? "");
}

interface LeadEmbed {
  name: string | null;
  company: string | null;
}

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

async function fetchAgendaFallback(
  organizationId: string,
  startDate: Date,
  endDate: Date,
): Promise<AgendaEvent[]> {
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  // Each source is queried independently and tolerated on failure, so one bad
  // table never blanks the whole agenda. RLS scopes rows to the user's org.
  const safe = async <T>(p: PromiseLike<{ data: T[] | null; error: unknown }>) => {
    try {
      const { data, error } = await p;
      if (error) return [] as T[];
      return (data ?? []) as T[];
    } catch {
      return [] as T[];
    }
  };

  const [meetings, followUps, confirmacoes] = await Promise.all([
    // Source 1: meetings (overlap with range)
    safe<Record<string, unknown>>(
      supabase
        .from("meetings" as "leads")
        .select(
          "id, title, description, start_at, end_at, all_day, event_type, status, lead_id, created_by, location, meet_link, color, google_event_id, lead:leads(name, company)",
        )
        .eq("organization_id", organizationId)
        .lt("start_at", endIso)
        .gt("end_at", startIso) as never,
    ),
    // Source 2: follow_ups (non-archived, due_date in range)
    safe<Record<string, unknown>>(
      supabase
        .from("follow_ups" as "leads")
        .select(
          "id, title, description, due_date, completed_at, lead_id, assigned_to, lead:leads(name, company)",
        )
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .gte("due_date", startIso)
        .lt("due_date", endIso) as never,
    ),
    // Source 4: pipe_confirmacao (non-null meeting_date in range)
    safe<Record<string, unknown>>(
      supabase
        .from("pipe_confirmacao" as "leads")
        .select(
          "id, notes, meeting_date, status, lead_id, lead:leads(name, company)",
        )
        .eq("organization_id", organizationId)
        .not("meeting_date", "is", null)
        .gte("meeting_date", startIso)
        .lt("meeting_date", endIso) as never,
    ),
  ]);

  const events: AgendaEvent[] = [];

  for (const r of meetings) {
    const lead = r.lead as LeadEmbed | null;
    events.push({
      id: r.id as string,
      source: "meeting",
      title: (r.title as string) ?? "Reunião",
      description: (r.description as string) ?? null,
      start_at: r.start_at as string,
      end_at: (r.end_at as string) ?? null,
      all_day: (r.all_day as boolean) ?? false,
      event_type: (r.event_type as string) ?? "meeting",
      status: (r.status as string) ?? "scheduled",
      lead_id: (r.lead_id as string) ?? null,
      lead_name: lead?.name ?? null,
      lead_company: lead?.company ?? null,
      created_by: (r.created_by as string) ?? null,
      creator_name: null,
      location: (r.location as string) ?? null,
      meet_link: (r.meet_link as string) ?? null,
      color: (r.color as string) ?? null,
      google_event_id: (r.google_event_id as string) ?? null,
    });
  }

  for (const r of followUps) {
    const lead = r.lead as LeadEmbed | null;
    const due = r.due_date as string;
    events.push({
      id: r.id as string,
      source: "follow_up",
      title: (r.title as string) ?? "Follow-up",
      description: (r.description as string) ?? null,
      start_at: due,
      end_at: addMinutesIso(due, 30),
      all_day: false,
      event_type: "follow_up",
      status: r.completed_at ? "completed" : "scheduled",
      lead_id: (r.lead_id as string) ?? null,
      lead_name: lead?.name ?? null,
      lead_company: lead?.company ?? null,
      created_by: (r.assigned_to as string) ?? null,
      creator_name: null,
      location: null,
      meet_link: null,
      color: null,
      google_event_id: null,
    });
  }

  for (const r of confirmacoes) {
    const lead = r.lead as LeadEmbed | null;
    const md = r.meeting_date as string;
    events.push({
      id: r.id as string,
      source: "pipe_confirmacao",
      title: lead?.name ?? "Reunião",
      description: (r.notes as string) ?? null,
      start_at: md,
      end_at: addMinutesIso(md, 60),
      all_day: false,
      event_type: "meeting",
      status: (r.status as string) ?? "scheduled",
      lead_id: (r.lead_id as string) ?? null,
      lead_name: lead?.name ?? null,
      lead_company: lead?.company ?? null,
      created_by: null,
      creator_name: null,
      location: null,
      meet_link: null,
      color: null,
      google_event_id: null,
    });
  }

  return events.sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
}
