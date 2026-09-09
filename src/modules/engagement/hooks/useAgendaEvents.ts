import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
// ─── Types ───────────────────────────────────────────────────────────────────
// Matches the return shape of the get_agenda_events RPC.

export interface AgendaEvent {
  id: string;
  /**
   * ⚠️ São CINCO fontes no PROD, não quatro. `meeting_event` (o funil mergeado
   * — ADR-0004/ADR-0007) entrou na RPC em 2026-07-30 e este tipo nunca soube:
   * a migration `20270730000000_agenda_meeting_events_source.sql` foi aplicada
   * à mão e ficou fora do repo. O valor sempre chegou aqui em runtime — são
   * 836 linhas no PROD — apenas tipado como algo que ele não é.
   */
  source:
    | "meeting"
    | "follow_up"
    | "scheduled_message"
    | "pipe_confirmacao"
    | "meeting_event";
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

/** A RPC com recorte ainda não está no `types.ts` (gerado do PROD). */
type RpcName = Parameters<typeof supabase.rpc>[0];
const RPC_COM_RECORTE = "get_agenda_events_scoped" as RpcName;
const RPC_BASE = "get_agenda_events" as RpcName;

/** `PGRST202`: a função não existe no schema cache — migration ainda não aplicada. */
function isMissingFunctionError(error: unknown): boolean {
  const e = error as PgError;
  return (
    e?.code === "PGRST202" ||
    /Could not find the function|schema cache/i.test(e?.message ?? "")
  );
}

/**
 * Unified agenda feed that aggregates meetings, follow-ups,
 * scheduled messages, pipe_confirmacao and meeting_events.
 *
 * ─── Por que `get_agenda_events_scoped` e não a base ─────────────────────────
 *
 * A base é org-wide de propósito (o COMMENT dela diz isso) e NUNCA recortou por
 * pessoa: quem recortava era o filtro de tela em `AgendaAtividades`. Filtro de
 * tela não é fronteira — o compromisso do colega atravessava a rede e era
 * descartado no navegador.
 *
 * A `_scoped` compõe sobre a base e decide o escopo DENTRO do banco: org
 * inteira para admin e para quem tem `agenda.view_all` (que nasce ligada);
 * "os meus + os órfãos + os que me convidaram" para quem está com ela
 * desligada. Nenhum parâmetro de escopo viaja na requisição — não há o que o
 * cliente adulterar.
 *
 * ─── Os dois caminhos degradados ─────────────────────────────────────────────
 *
 * 1. `PGRST202` — a migration ainda não foi aplicada. Cai na base, e o filtro
 *    de tela volta a ser o único recorte (o comportamento de antes desta
 *    mudança). Remendo para o intervalo entre deploy do front e apply, que foi
 *    como um parâmetro novo derrubou o board inteiro na #1774.
 * 2. `42P01` — banco parcialmente migrado (dev sem `scheduled_user_messages`).
 *    Reconstrói o feed a partir das tabelas que existem. Inerte em produção.
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

      const args = {
        p_organization_id: organizationId,
        p_start: startDate.toISOString(),
        p_end: endDate.toISOString(),
      } as never;

      let { data, error } = await supabase.rpc(RPC_COM_RECORTE, args);

      if (error && isMissingFunctionError(error)) {
        ({ data, error } = await supabase.rpc(RPC_BASE, args));
      }

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

  // The agenda fallback queries source tables (meetings, follow_ups,
  // pipe_confirmacao) that are spoofed as "leads" to satisfy the table-name
  // union. The embedded `lead:leads(...)` select makes PostgREST's recursive
  // result-type parser explode (TS2589 — "type instantiation excessively
  // deep"). `from` returns a loosely-typed builder so the `.select(...)` chain
  // never triggers that deep instantiation; row shapes are recovered
  // downstream via the explicit `safe<Record<string, unknown>>` casts and the
  // `r.<field> as <type>` reads when mapping into AgendaEvent.
  type LooseQueryBuilder = {
    select: (columns: string) => LooseQueryBuilder;
    eq: (column: string, value: unknown) => LooseQueryBuilder;
    is: (column: string, value: unknown) => LooseQueryBuilder;
    not: (column: string, operator: string, value: unknown) => LooseQueryBuilder;
    gt: (column: string, value: unknown) => LooseQueryBuilder;
    gte: (column: string, value: unknown) => LooseQueryBuilder;
    lt: (column: string, value: unknown) => LooseQueryBuilder;
    then: PromiseLike<{ data: unknown; error: unknown }>["then"];
  };
  const from = (table: string): LooseQueryBuilder =>
    supabase.from(table as "leads") as unknown as LooseQueryBuilder;

  const [meetings, followUps, confirmacoes] = await Promise.all([
    // Source 1: meetings (overlap with range)
    safe<Record<string, unknown>>(
      from("meetings")
        .select(
          "id, title, description, start_at, end_at, all_day, event_type, status, lead_id, created_by, location, meet_link, color, google_event_id, lead:leads(name, company)",
        )
        .eq("organization_id", organizationId)
        .lt("start_at", endIso)
        .gt("end_at", startIso) as never,
    ),
    // Source 2: follow_ups (non-archived, due_date in range)
    safe<Record<string, unknown>>(
      from("follow_ups")
        .select(
          "id, title, description, due_date, completed_at, lead_id, assigned_to, lead:leads(name, company)",
        )
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .gte("due_date", startIso)
        .lt("due_date", endIso) as never,
    ),
    // Source 4: funil de confirmação (meeting_date preenchido no intervalo)
    safe<Record<string, unknown>>(
      from("negocio_projetado")
        .select(
          "id, notes, meeting_date, stage_key, lead_id, lead:leads(name, company)",
        )
        .eq("funil_sistema", "confirmacao")
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
      status: (r.stage_key as string) ?? "scheduled",
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
