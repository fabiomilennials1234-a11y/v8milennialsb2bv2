import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";

export interface LeadSelector {
  by: "id" | "phone";
  value: string;
}

/** Decide how to resolve the lead from the tool args. id wins over phone. */
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

// Pipes carry stage_key directly; pipelines embed adds slug/name/type for context.
const LEAD_SELECT = "id,name,company,email,phone,organization_id,deleted_at," +
  "pipeline_entries(stage_key,pipeline_id,entered_at,stage_changed_at,pipelines(slug,name,type))";

export const leadGetTool: ToolDef = {
  name: "lead.get",
  description: "Resolve a lead by id or phone within an organization (RLS-scoped as master), " +
    "including its pipe positions. Provide org_id and one of id | phone.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      org_id: { type: "string", description: "Organization UUID" },
      id: { type: "string", description: "Lead UUID" },
      phone: { type: "string", description: "Phone in any format (normalized server-side)" },
    },
    required: ["org_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const sel = leadSelector(args);
    if (!sel) {
      return { content: [{ type: "text", text: "Provide either id or phone." }], isError: true };
    }
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);

    let column = "id";
    let value = sel.value;
    if (sel.by === "phone") {
      column = "normalized_phone";
      // Normalize via the DB's own function → guaranteed parity with stored data.
      const { data: norm, error: nErr } = await db.rpc("normalize_brazilian_phone", {
        phone: sel.value,
      });
      if (nErr) {
        return {
          content: [{ type: "text", text: `Error normalizing phone: ${nErr.message}` }],
          isError: true,
        };
      }
      value = String(norm);
    }

    const { data, error } = await db
      .from("leads")
      .select(LEAD_SELECT)
      .eq("organization_id", org)
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
