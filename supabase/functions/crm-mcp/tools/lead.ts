/**
 * Customer-scoped lead tools: `lead.get` (C2 tracer) and `lead.list` (C3).
 *
 * Deliberately NOT the ops `torque-mcp/tools/lead.ts`:
 *  - the org is taken from the PAT (ctx.orgId), NEVER trusted from the args (the ops tool
 *    accepts org_id as an argument because master is cross-org — for a customer that arg is
 *    the cross-tenant vector);
 *  - phone is normalized in TS (lib/phone.ts), never via `db.rpc` (anti-bypass, HOLE 1);
 *  - every query carries an explicit `.eq("organization_id", orgId)` on top of RLS
 *    (defense-in-depth — the barrier that contains an RLS regression, DESIGN §6.4).
 *
 * Visibility is the caller's own: a member who only sees their own cards gets only those.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { normalizeBrazilianPhone } from "../lib/phone.ts";
import {
  clampLimit,
  clip,
  combineOrGroups,
  type Cursor,
  dbErrorResult,
  decodeCursor,
  encodeCursor,
  errorResult,
  jsonResult,
  keysetAfter,
  memberNames,
  optionalIsoDate,
  optionalUuid,
  pgrstQuote,
  READ_ONLY,
  resolveOrgScope,
  sanitizeSearch,
} from "./shared.ts";

export { resolveOrgScope } from "./shared.ts";

export interface LeadSelector {
  by: "id" | "phone";
  value: string;
}

/** id wins over phone; trims; null if neither given. */
export function leadSelector(args: Record<string, unknown>): LeadSelector | null {
  const id = typeof args.id === "string" ? args.id.trim() : "";
  if (id) return { by: "id", value: id };
  const phone = typeof args.phone === "string" ? args.phone.trim() : "";
  if (phone) return { by: "phone", value: phone };
  return null;
}

/** Shape a fetched lead row (or absence) into an MCP tool result. */
export function formatLead(lead: Record<string, unknown> | null): ToolResult {
  if (!lead) return { content: [{ type: "text", text: "No lead found." }] };
  return jsonResult(lead);
}

// Children without an organization_id (tags, custom field values) are EMBEDDED through
// `leads`, so they inherit the lead's visibility; deals are reached through the card
// (deals RLS ignores the funnel's visibility regimes — never read them directly).
const LEAD_SELECT = "id,name,company,email,phone,origin,segment,organization_id,created_at," +
  "updated_at,deleted_at,responsible_user_id,rating,urgency,qualification_tier,erp_code," +
  // entry id = what deal.move.plan takes; the stage name saves a stage.list round-trip
  "pipeline_entries(id,deal_id,stage_key,pipeline_id,entered_at,stage_changed_at,closed_at," +
  "pipelines(slug,name,type),pipeline_stages(name)," +
  "deals(id,title,value,currency,outcome,outcome_at,loss_reason))," +
  "lead_tags(tags(id,name))," +
  "lead_custom_field_values(value,lead_custom_fields(field_name,field_type))";

/**
 * The lead as the AI reads it: tags and custom fields flattened, the owner with a name,
 * internal join shapes dropped. Pure.
 */
export function shapeLead(
  row: Record<string, unknown>,
  ownerName: string | null,
): Record<string, unknown> {
  const {
    lead_tags,
    lead_custom_field_values,
    responsible_user_id,
    ...rest
  } = row as Record<string, unknown> & {
    lead_tags?: Array<{ tags: { id: string; name: string } | null }> | null;
    lead_custom_field_values?:
      | Array<
        {
          value: string | null;
          lead_custom_fields: { field_name: string; field_type: string | null } | null;
        }
      >
      | null;
    responsible_user_id?: string | null;
  };
  return {
    ...rest,
    owner: responsible_user_id ? { id: responsible_user_id, name: ownerName } : null,
    tags: (lead_tags ?? []).map((t) => t.tags).filter((t): t is { id: string; name: string } =>
      !!t
    ),
    custom_fields: (lead_custom_field_values ?? [])
      .filter((v) => v.lead_custom_fields && v.value !== null && v.value !== "")
      .map((v) => ({
        field: v.lead_custom_fields!.field_name,
        type: v.lead_custom_fields!.field_type,
        value: v.value,
      })),
  };
}

export const customerLeadGetTool: ToolDef = {
  name: "lead.get",
  description:
    "Resolve one of your leads by id or phone: its owner, tags, custom fields, rating, and " +
    "every funnel card it has (entry_id, stage, days, and the deal's value and outcome). " +
    "Scoped to your organization and to what your own user can see. Provide id or phone. For " +
    "what happened with the lead use lead.timeline; for its WhatsApp, conversation.get.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Get lead" },
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Lead UUID" },
      phone: { type: "string", description: "Phone in any format (normalized server-side)" },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);

    const sel = leadSelector(args);
    if (!sel) return errorResult("Provide either id or phone.");

    let column = "id";
    let value = sel.value;
    if (sel.by === "phone") {
      const normalized = normalizeBrazilianPhone(sel.value); // TS, never db.rpc (HOLE 1)
      if (!normalized) return errorResult("Phone has no digits.");
      column = "normalized_phone";
      value = normalized;
    } else if (optionalUuid(sel.value) === "invalid") {
      return errorResult("id must be a UUID.");
    }

    const db = ctx.db as SupabaseClient;
    const { data, error } = await db
      .from("leads")
      .select(LEAD_SELECT)
      .eq("organization_id", scope.orgId) // defense-in-depth on top of RLS (DESIGN §6.4)
      .eq(column, value)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return dbErrorResult(error);
    const row = data as Record<string, unknown> | null;
    if (!row) return formatLead(null);
    const ownerId = typeof row.responsible_user_id === "string" ? row.responsible_user_id : null;
    const names = await memberNames(db, scope.orgId, [ownerId]);
    return formatLead(shapeLead(row, ownerId ? names.get(ownerId) ?? null : null));
  },
};

// --- lead.list ---------------------------------------------------------------------------

export const LEAD_LIST_DEFAULT = 25;
export const LEAD_LIST_MAX = 100;

export interface LeadListQuery {
  orgId: string;
  limit: number;
  pipelineId: string | null;
  stageKey: string | null;
  /** team_members.id in leads.responsible_user_id (team.list) */
  ownerId: string | null;
  createdAfter: string | null;
  createdBefore: string | null;
  /** normalized phone when the search looks like a phone, else null */
  phone: string | null;
  /** ILIKE term otherwise */
  search: string | null;
  cursor: Cursor | null;
}

/** Validate + normalize lead.list arguments. Pure. */
export function parseLeadListArgs(
  args: Record<string, unknown>,
  orgId: string,
): { ok: true; q: LeadListQuery } | { ok: false; message: string } {
  const pipelineId = optionalUuid(args.pipeline_id);
  if (pipelineId === "invalid") return { ok: false, message: "pipeline_id must be a UUID." };
  const ownerId = optionalUuid(args.owner_id);
  if (ownerId === "invalid") return { ok: false, message: "owner_id must be a UUID." };

  const stageKey = typeof args.stage_key === "string" && args.stage_key.trim()
    ? args.stage_key.trim().slice(0, 120)
    : null;
  if (stageKey && !pipelineId) {
    return {
      ok: false,
      message: "stage_key requires pipeline_id (stage keys repeat across funnels).",
    };
  }

  const createdAfter = optionalIsoDate(args.created_after);
  const createdBefore = optionalIsoDate(args.created_before);
  if (createdAfter === "invalid" || createdBefore === "invalid") {
    return { ok: false, message: "created_after/created_before must be ISO-8601 dates." };
  }

  const cursor = decodeCursor(args.cursor);
  if (cursor === "invalid") {
    return { ok: false, message: "cursor is not valid (use next_cursor as returned)." };
  }

  let phone: string | null = null;
  let search: string | null = null;
  const raw = typeof args.query === "string" ? args.query.trim() : "";
  if (raw) {
    const digits = raw.replace(/\D/g, "");
    if (/^[\d\s()+.-]+$/.test(raw) && digits.length >= 8) {
      phone = normalizeBrazilianPhone(raw);
    } else {
      search = sanitizeSearch(raw);
      if (!search) return { ok: false, message: "query needs at least 2 letters or digits." };
    }
  }

  return {
    ok: true,
    q: {
      orgId,
      limit: clampLimit(args.limit, LEAD_LIST_DEFAULT, LEAD_LIST_MAX),
      pipelineId,
      stageKey,
      ownerId,
      createdAfter,
      createdBefore,
      phone,
      search,
      cursor,
    },
  };
}

/** The single `.or()` argument for search + keyset, or null. Pure. */
export function leadListOrFilter(q: LeadListQuery): string | null {
  const groups: string[] = [];
  if (q.search) {
    const pat = pgrstQuote(`*${q.search}*`);
    groups.push(`name.ilike.${pat},email.ilike.${pat},company.ilike.${pat}`);
  }
  if (q.cursor) groups.push(keysetAfter(q.cursor));
  return combineOrGroups(groups);
}

const LEAD_LIST_COLUMNS = "id,name,company,email,phone,origin,created_at,updated_at";

export const customerLeadListTool: ToolDef = {
  name: "lead.list",
  description:
    "List your leads, newest first. Filter by funnel (pipeline_id, from pipeline.list) and " +
    "stage (stage_key, from stage.list), by owner (owner_id, from team.list), by creation date, " +
    "or search by name/email/company " +
    "(or a phone number). Returns at most `limit` leads (default 25, max 100) and a " +
    "`next_cursor` to fetch the next page. Only leads your own user can see are returned.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List leads" },
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name, email, company or phone fragment" },
      pipeline_id: { type: "string", description: "Only leads in this funnel (UUID)" },
      stage_key: { type: "string", description: "Only leads in this stage (requires pipeline_id)" },
      owner_id: { type: "string", description: "Only leads owned by this team member (team.list)" },
      created_after: { type: "string", description: "ISO-8601 date, inclusive" },
      created_before: { type: "string", description: "ISO-8601 date, exclusive" },
      limit: { type: "integer", minimum: 1, maximum: LEAD_LIST_MAX },
      cursor: { type: "string", description: "next_cursor from the previous page" },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const parsed = parseLeadListArgs(args, scope.orgId);
    if (!parsed.ok) return errorResult(parsed.message);
    const q = parsed.q;

    // With a funnel filter the embed is INNER (only leads with an entry there) and shows just
    // that funnel's position; without it, every position the lead has.
    const cols = "id,deal_id,pipeline_id,stage_key,entered_at,stage_changed_at,closed_at," +
      "pipeline_stages(name)";
    const embed = q.pipelineId ? `pipeline_entries!inner(${cols})` : `pipeline_entries(${cols})`;

    const db = ctx.db as SupabaseClient;
    let req = db
      .from("leads")
      .select(`${LEAD_LIST_COLUMNS},${embed}`)
      .eq("organization_id", q.orgId) // defense-in-depth on top of RLS
      .is("deleted_at", null);

    if (q.pipelineId) req = req.eq("pipeline_entries.pipeline_id", q.pipelineId);
    if (q.stageKey) req = req.eq("pipeline_entries.stage_key", q.stageKey);
    if (q.ownerId) req = req.eq("responsible_user_id", q.ownerId);
    if (q.createdAfter) req = req.gte("created_at", q.createdAfter);
    if (q.createdBefore) req = req.lt("created_at", q.createdBefore);
    if (q.phone) req = req.eq("normalized_phone", q.phone);
    const orFilter = leadListOrFilter(q);
    if (orFilter) req = req.or(orFilter);

    const { data, error } = await req
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(q.limit);
    if (error) return dbErrorResult(error);

    const leads = (data ?? []) as Array<Record<string, unknown>>;
    const last = leads[leads.length - 1];
    const next = leads.length === q.limit && last
      ? encodeCursor({ createdAt: String(last.created_at), id: String(last.id) })
      : null;
    return jsonResult({ count: leads.length, next_cursor: next, leads });
  },
};

// --- lead.timeline (fatia 7) -------------------------------------------------------------------

interface HistoryRow {
  id: string;
  action: string | null;
  description: string | null;
  source: string | null;
  entity_type: string | null;
  created_at: string;
}

interface CommentRow {
  id: string;
  body: string | null;
  author_team_member_id: string | null;
  pipeline_entry_id: string | null;
  created_at: string;
}

/** History events and notes merged newest first, cut at `limit`. Pure. */
export function mergeTimeline(
  history: HistoryRow[],
  comments: CommentRow[],
  names: Map<string, string>,
  limit: number,
) {
  const items = [
    ...history.map((h) => ({
      at: h.created_at,
      kind: "event" as const,
      action: h.action,
      text: clip(h.description, 500),
      by: h.source, // manual | automation | agent | system
      ...(h.entity_type ? { about: h.entity_type } : {}),
    })),
    ...comments.map((c) => ({
      at: c.created_at,
      kind: "note" as const,
      text: clip(c.body, 1500),
      by: c.author_team_member_id ? names.get(c.author_team_member_id) ?? "equipe" : "equipe",
      ...(c.pipeline_entry_id ? { entry_id: c.pipeline_entry_id } : {}),
    })),
  ].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return { items: items.slice(0, limit), more: items.length > limit };
}

export const customerLeadTimelineTool: ToolDef = {
  name: "lead.timeline",
  description:
    "What happened with one lead, newest first: history events (stage moves, sales, automations, " +
    "edits — each with who did it: manual, automation, agent or system) and the team's notes on " +
    "it. Page back with before = the oldest `at` you got. For the WhatsApp messages use " +
    "conversation.get.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Lead timeline" },
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string" },
      before: { type: "string", description: "ISO-8601; only items older than this" },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["lead_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const leadId = optionalUuid(args.lead_id);
    if (!leadId || leadId === "invalid") return errorResult("lead_id must be a UUID.");
    const before = optionalIsoDate(args.before);
    if (before === "invalid") return errorResult("before must be an ISO-8601 date.");
    const limit = clampLimit(args.limit, 30, 100);
    const db = ctx.db as SupabaseClient;

    // The lead first, through `leads`: lead_history and lead_comments RLS check the org only,
    // so this read is what makes a lead the person cannot see answer "not found".
    const { data: lead, error: leadErr } = await db
      .from("leads")
      .select("id,name")
      .eq("organization_id", scope.orgId)
      .eq("id", leadId)
      .is("deleted_at", null)
      .maybeSingle();
    if (leadErr) return dbErrorResult(leadErr);
    if (!lead) return errorResult("Lead não encontrado (ou você não tem acesso a ele).");

    let hq = db.from("lead_history")
      .select("id,action,description,source,entity_type,created_at")
      .eq("organization_id", scope.orgId)
      .eq("lead_id", leadId);
    let cq = db.from("lead_comments")
      .select("id,body,author_team_member_id,pipeline_entry_id,created_at")
      .eq("organization_id", scope.orgId)
      .eq("lead_id", leadId)
      .is("deleted_at", null);
    if (before) {
      hq = hq.lt("created_at", before);
      cq = cq.lt("created_at", before);
    }
    const [h, c] = await Promise.all([
      hq.order("created_at", { ascending: false }).limit(limit + 1),
      cq.order("created_at", { ascending: false }).limit(limit + 1),
    ]);
    if (h.error) return dbErrorResult(h.error);
    if (c.error) return dbErrorResult(c.error);
    const comments = (c.data ?? []) as CommentRow[];
    const names = await memberNames(db, scope.orgId, comments.map((x) => x.author_team_member_id));
    const t = mergeTimeline((h.data ?? []) as HistoryRow[], comments, names, limit);
    return jsonResult({
      lead: lead,
      count: t.items.length,
      next_before: t.more ? t.items[t.items.length - 1].at : null,
      items: t.items,
    });
  },
};
