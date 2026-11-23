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
  combineOrGroups,
  type Cursor,
  dbErrorResult,
  decodeCursor,
  encodeCursor,
  errorResult,
  jsonResult,
  keysetAfter,
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
  return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
}

const LEAD_SELECT = "id,name,company,email,phone,origin,segment,organization_id,created_at," +
  "updated_at,deleted_at," +
  "pipeline_entries(stage_key,pipeline_id,entered_at,stage_changed_at,closed_at,pipelines(slug,name,type))";

export const customerLeadGetTool: ToolDef = {
  name: "lead.get",
  description:
    "Resolve one of your leads by id or phone, including which funnels and stages it is in. " +
    "Scoped to your organization and to what your own user can see. Provide id or phone.",
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
    return formatLead(data as Record<string, unknown> | null);
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
    "stage (stage_key, from stage.list), by creation date, or search by name/email/company " +
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
    const embed = q.pipelineId
      ? "pipeline_entries!inner(pipeline_id,stage_key,entered_at,closed_at)"
      : "pipeline_entries(pipeline_id,stage_key,entered_at,closed_at)";

    const db = ctx.db as SupabaseClient;
    let req = db
      .from("leads")
      .select(`${LEAD_LIST_COLUMNS},${embed}`)
      .eq("organization_id", q.orgId) // defense-in-depth on top of RLS
      .is("deleted_at", null);

    if (q.pipelineId) req = req.eq("pipeline_entries.pipeline_id", q.pipelineId);
    if (q.stageKey) req = req.eq("pipeline_entries.stage_key", q.stageKey);
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
