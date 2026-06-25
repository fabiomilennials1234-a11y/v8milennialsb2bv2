/**
 * Customer-scoped `lead.get` — the C2 tracer tool (DESIGN §6.2/§6.4).
 *
 * This is a NEW handler, deliberately not the ops `torque-mcp/tools/lead.ts`:
 *  - the org is taken from the PAT (ctx.orgId), NEVER trusted from the args (the ops tool
 *    accepts org_id as an argument because master is cross-org — for a customer that arg is
 *    the cross-tenant vector);
 *  - phone is normalized in TS (lib/phone.ts), never via `db.rpc` (anti-bypass, HOLE 1);
 *  - every query carries an explicit `.eq("organization_id", ctx.orgId)` on top of RLS
 *    (defense-in-depth — the barrier that contains an RLS regression, DESIGN §6.4).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { normalizeBrazilianPhone } from "../lib/phone.ts";

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

export type OrgScope =
  | { ok: true; orgId: string }
  | { ok: false; message: string };

/**
 * Resolve the org to query, PURELY (DESIGN §6.4). The token org is authoritative; an arg
 * org_id is allowed ONLY if it matches (else rejected — never a silent wrong-org query).
 */
export function resolveOrgScope(
  args: Record<string, unknown>,
  tokenOrgId: string | undefined,
): OrgScope {
  if (!tokenOrgId) return { ok: false, message: "No organization in token context." };
  const argOrg = typeof args.org_id === "string" ? args.org_id.trim() : "";
  if (argOrg && argOrg !== tokenOrgId) {
    return { ok: false, message: "org_id does not match the token's organization." };
  }
  return { ok: true, orgId: tokenOrgId };
}

/** Shape a fetched lead row (or absence) into an MCP tool result. */
export function formatLead(lead: Record<string, unknown> | null): ToolResult {
  if (!lead) return { content: [{ type: "text", text: "No lead found." }] };
  return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
}

const LEAD_SELECT = "id,name,company,email,phone,organization_id,deleted_at," +
  "pipeline_entries(stage_key,pipeline_id,entered_at,stage_changed_at,pipelines(slug,name,type))";

export const customerLeadGetTool: ToolDef = {
  name: "lead.get",
  description:
    "Resolve one of your leads by id or phone, including its pipe positions. Scoped to your " +
    "organization and your access level. Provide id or phone.",
  readonly: true,
  customerExposed: true,
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
    if (!scope.ok) return { content: [{ type: "text", text: scope.message }], isError: true };

    const sel = leadSelector(args);
    if (!sel) {
      return { content: [{ type: "text", text: "Provide either id or phone." }], isError: true };
    }

    let column = "id";
    let value = sel.value;
    if (sel.by === "phone") {
      const normalized = normalizeBrazilianPhone(sel.value); // TS, never db.rpc (HOLE 1)
      if (!normalized) {
        return { content: [{ type: "text", text: "Phone has no digits." }], isError: true };
      }
      column = "normalized_phone";
      value = normalized;
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

    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    return formatLead(data as Record<string, unknown> | null);
  },
};
