/**
 * The day's work, read by AI (fatia 7 do v2): what is due, what is booked, who is waiting.
 *
 *   followup.list         — follow-ups (tasks tied to a lead): overdue, today, upcoming, open;
 *   agenda.list           — the Agenda as the person sees it (meetings, follow-ups, scheduled
 *                           messages…), through the screen's own RPC and its own scoping;
 *   inbox.awaiting_reply  — conversations where the customer wrote last and no human answered,
 *                           through the Comando tab's own RPC.
 *
 * Visibility: follow_ups RLS checks the org only, so the lead is joined INNER through `leads`
 * (whose RLS is the visibility rule) — a follow-up of a lead the person cannot see drops out.
 * Each tool asks the same feature permission the app's screen asks.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { isUuid } from "./actions.ts";
import { todayIn } from "./metrics.ts";
import { callerHasFeature, callRpc } from "./rpc.ts";
import {
  addDays,
  clampLimit,
  clip,
  dbErrorResult,
  errorResult,
  jsonResult,
  localMidnightUtc,
  memberNames,
  READ_ONLY,
  readOrgTimezone,
  resolveOrgScope,
} from "./shared.ts";

const DAY_MS = 86_400_000;

async function denyWithout(ctx: ToolContext, key: string, screen: string) {
  return (await callerHasFeature(ctx, key))
    ? null
    : errorResult(`Seu usuário não tem acesso a ${screen} no Torque (permissão ${key}).`);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// --- followup.list ---------------------------------------------------------------------------

export type FollowupWhen = "overdue" | "today" | "upcoming" | "open";
const WHEN: readonly FollowupWhen[] = ["overdue", "today", "upcoming", "open"];

/** The due-date window for `when`, as UTC ISO bounds, in the org's calendar. Pure. */
export function followupWindow(
  when: FollowupWhen,
  today: string,
  tz: string,
  daysAhead: number,
): { gte?: string; lt?: string } {
  const start = localMidnightUtc(today, tz).toISOString();
  const tomorrow = localMidnightUtc(addDays(today, 1), tz).toISOString();
  switch (when) {
    case "overdue":
      return { lt: start };
    case "today":
      return { gte: start, lt: tomorrow };
    case "upcoming":
      return { gte: start, lt: localMidnightUtc(addDays(today, daysAhead + 1), tz).toISOString() };
    default:
      return {};
  }
}

interface FollowupRow {
  id: string;
  title: string | null;
  description: string | null;
  due_date: string | null;
  completed_at: string | null;
  priority: string | null;
  assigned_to: string | null;
  is_automated: boolean | null;
  deal_id: string | null;
  pipeline_entry_id: string | null;
  leads: { id: string; name: string | null; company: string | null; phone: string | null } | null;
}

export const customerFollowupListTool: ToolDef = {
  name: "followup.list",
  description:
    "Follow-ups (tasks tied to a lead), soonest first. when: overdue (due before today), today, " +
    "upcoming (today through days_ahead days, default 7) or open (every pending one, default). " +
    "Narrow to one person (assigned_to = team member id from team.list, or mine: true) or one " +
    "lead. Each with title, due time, priority, whether it is overdue, who it is assigned to and " +
    "the lead. Only follow-ups of leads you can see; days follow the organization's timezone.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List follow-ups" },
  inputSchema: {
    type: "object",
    properties: {
      when: { type: "string", enum: [...WHEN] },
      days_ahead: { type: "integer", minimum: 1, maximum: 60 },
      assigned_to: { type: "string", description: "Team member id (team.list)" },
      mine: { type: "boolean", description: "Only the follow-ups assigned to you" },
      lead_id: { type: "string" },
      include_completed: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const when = (args.when ?? "open") as FollowupWhen;
    if (!WHEN.includes(when)) return errorResult(`when must be one of ${WHEN.join(", ")}.`);
    const daysAhead = args.days_ahead === undefined ? 7 : Number(args.days_ahead);
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 60) {
      return errorResult("days_ahead must be an integer between 1 and 60.");
    }
    for (const k of ["assigned_to", "lead_id"] as const) {
      if (args[k] !== undefined && !isUuid(args[k])) return errorResult(`${k} must be a UUID.`);
    }
    if (args.assigned_to !== undefined && args.mine === true) {
      return errorResult("Use assigned_to or mine, not both.");
    }
    const limit = clampLimit(args.limit, 50, 100);

    const denied = await denyWithout(ctx, "followups.view", "Follow-ups");
    if (denied) return denied;
    const db = ctx.db as SupabaseClient;

    const [tzR, meR] = await Promise.all([
      readOrgTimezone(db, scope.orgId),
      args.mine === true
        ? db.from("team_members").select("id").eq("organization_id", scope.orgId)
          .eq("user_id", ctx.userId).eq("is_active", true).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if ("error" in tzR) return dbErrorResult(tzR.error!);
    if (meR.error) return dbErrorResult(meR.error);
    const assignee = args.mine === true
      ? (meR.data as { id: string } | null)?.id
      : args.assigned_to as string | undefined;
    if (args.mine === true && !assignee) {
      return errorResult("Você não é membro ativo desta organização para ter follow-ups.");
    }

    const today = todayIn(tzR.tz, new Date());
    const win = followupWindow(when, today, tzR.tz, daysAhead);
    let q = db
      .from("follow_ups")
      // INNER through leads: its RLS is the visibility rule follow_ups lacks.
      .select(
        "id,title,description,due_date,completed_at,priority,assigned_to,is_automated,deal_id," +
          "pipeline_entry_id,leads!inner(id,name,company,phone)",
      )
      .eq("organization_id", scope.orgId)
      .is("archived_at", null)
      .is("leads.deleted_at", null);
    if (args.include_completed !== true) q = q.is("completed_at", null);
    if (win.gte) q = q.gte("due_date", win.gte);
    if (win.lt) q = q.lt("due_date", win.lt);
    if (assignee) q = q.eq("assigned_to", assignee);
    if (args.lead_id) q = q.eq("lead_id", args.lead_id as string);
    const { data, error } = await q
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit + 1);
    if (error) return dbErrorResult(error);
    const rows = (data ?? []) as unknown as FollowupRow[];
    const page = rows.slice(0, limit);
    const names = await memberNames(db, scope.orgId, page.map((r) => r.assigned_to));
    const startToday = localMidnightUtc(today, tzR.tz).getTime();
    return jsonResult({
      when,
      today,
      timezone: tzR.tz,
      count: page.length,
      has_more: rows.length > limit,
      followups: page.map((r) => ({
        id: r.id,
        title: r.title,
        ...(r.description ? { description: clip(r.description, 300) } : {}),
        due_at: r.due_date,
        overdue: !r.completed_at && !!r.due_date && Date.parse(r.due_date) < startToday,
        priority: r.priority,
        ...(r.completed_at ? { completed_at: r.completed_at } : {}),
        automated: r.is_automated === true,
        assigned_to: r.assigned_to
          ? { id: r.assigned_to, name: names.get(r.assigned_to) ?? null }
          : null,
        lead: r.leads,
        deal_id: r.deal_id,
        entry_id: r.pipeline_entry_id,
      })),
    });
  },
};

// --- agenda.list -----------------------------------------------------------------------------

export const AGENDA_MAX_DAYS = 62;

interface AgendaRow {
  id: string;
  source: string;
  title: string | null;
  description: string | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean | null;
  event_type: string | null;
  status: string | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_company: string | null;
  creator_name: string | null;
  location: string | null;
  meet_link: string | null;
  owner_team_member_id: string | null;
}

export const customerAgendaListTool: ToolDef = {
  name: "agenda.list",
  description:
    "The agenda between two dates (from/to, YYYY-MM-DD, inclusive; default today and the next " +
    "7 days, at most 62): meetings, follow-ups, scheduled messages and the other events the " +
    "Agenda screen shows — only the person's own unless they may see everyone's. Optional " +
    "sources filter (e.g. meeting). Each event with time, type, status, lead, owner and link.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List agenda" },
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "YYYY-MM-DD (default today)" },
      to: { type: "string", description: "YYYY-MM-DD, inclusive" },
      sources: { type: "array", items: { type: "string" } },
      limit: { type: "integer", minimum: 1, maximum: 300 },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    for (const k of ["from", "to"] as const) {
      if (args[k] !== undefined && !(typeof args[k] === "string" && YMD.test(args[k] as string))) {
        return errorResult(`${k} must be a date YYYY-MM-DD.`);
      }
    }
    const limit = clampLimit(args.limit, 100, 300);
    const sources = Array.isArray(args.sources)
      ? args.sources.filter((s): s is string => typeof s === "string").slice(0, 10)
      : [];

    const denied = await denyWithout(ctx, "agenda.view", "Agenda");
    if (denied) return denied;
    const db = ctx.db as SupabaseClient;
    const tzR = await readOrgTimezone(db, scope.orgId);
    if ("error" in tzR) return dbErrorResult(tzR.error!);

    const from = (args.from as string | undefined) ?? todayIn(tzR.tz, new Date());
    const to = (args.to as string | undefined) ?? addDays(from, 7);
    const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
    if (span < 0) return errorResult("to must not be before from.");
    if (span > AGENDA_MAX_DAYS) return errorResult(`At most ${AGENDA_MAX_DAYS} days per call.`);

    const { data, error } = await callRpc<AgendaRow[]>(ctx, "get_agenda_events_scoped", {
      p_organization_id: scope.orgId,
      p_start: localMidnightUtc(from, tzR.tz).toISOString(),
      p_end: localMidnightUtc(addDays(to, 1), tzR.tz).toISOString(),
    });
    if (error) return dbErrorResult(error);
    const rows = (data ?? [])
      .filter((r) => !sources.length || sources.includes(r.source))
      .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
    const page = rows.slice(0, limit);
    return jsonResult({
      from,
      to,
      timezone: tzR.tz,
      count: page.length,
      ...(rows.length > limit ? { truncated: true, total: rows.length } : {}),
      events: page.map((r) => ({
        id: r.id,
        source: r.source,
        title: r.title,
        start_at: r.start_at,
        end_at: r.end_at,
        ...(r.all_day ? { all_day: true } : {}),
        type: r.event_type,
        status: r.status,
        lead: r.lead_id ? { id: r.lead_id, name: r.lead_name, company: r.lead_company } : null,
        owner_team_member_id: r.owner_team_member_id,
        created_by: r.creator_name,
        ...(r.meet_link ? { meet_link: r.meet_link } : {}),
        ...(r.location ? { location: r.location } : {}),
        ...(r.description ? { description: clip(r.description, 300) } : {}),
      })),
    });
  },
};

// --- inbox.awaiting_reply --------------------------------------------------------------------

interface FilaRow {
  instance_id: string;
  phone_number: string | null;
  push_name: string | null;
  lead_id: string | null;
  conversation_id: string | null;
  last_client_message: string | null;
  last_client_message_at: string | null;
  ai_replied: boolean | null;
  owner_team_member_id: string | null;
  owner_name: string | null;
  lead_name: string | null;
}

export const customerInboxAwaitingReplyTool: ToolDef = {
  name: "inbox.awaiting_reply",
  description:
    "WhatsApp conversations waiting for a human reply — the customer wrote last and nobody on " +
    "the team answered (an AI answer does not count) — across the numbers the person may read, " +
    "in the order of Torque's Comando tab. Each with the lead, the last customer message, how " +
    "many minutes it has waited, whether the AI replied, and the owner. window_days: only " +
    "conversations whose last customer message is that recent (default 7).",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Awaiting reply" },
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      window_days: { type: "integer", minimum: 1, maximum: 30 },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const limit = clampLimit(args.limit, 30, 100);
    const windowDays = args.window_days === undefined ? 7 : Number(args.window_days);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30) {
      return errorResult("window_days must be an integer between 1 and 30.");
    }
    const denied = await denyWithout(ctx, "whatsapp.view", "WhatsApp");
    if (denied) return denied;

    const { data, error } = await callRpc<FilaRow[]>(ctx, "get_comando_fila", {
      p_org: scope.orgId,
      p_instances: null, // every number the caller may read (whatsapp_readable_instance_ids)
      p_limit: limit,
      p_window_days: windowDays,
    });
    if (error) return dbErrorResult(error);
    const now = Date.now();
    const rows = data ?? [];
    return jsonResult({
      count: rows.length,
      window_days: windowDays,
      conversations: rows.map((r) => ({
        lead: r.lead_id ? { id: r.lead_id, name: r.lead_name } : null,
        phone: r.phone_number,
        contact_name: r.push_name,
        last_message: clip(r.last_client_message, 300),
        last_message_at: r.last_client_message_at,
        waiting_minutes: r.last_client_message_at
          ? Math.max(0, Math.round((now - Date.parse(r.last_client_message_at)) / 60_000))
          : null,
        ai_replied: r.ai_replied === true,
        owner: r.owner_team_member_id ? { id: r.owner_team_member_id, name: r.owner_name } : null,
        conversation_id: r.conversation_id,
        instance_id: r.instance_id,
      })),
    });
  },
};
