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

import { runMutation } from "../lib/guardrails.ts";
import { auditMcpAction } from "../lib/audit.ts";

export function buildRestorePlan(lead: Record<string, unknown>) {
  return {
    action: "restore_lead",
    lead_id: lead.id,
    name: lead.name,
    organization_id: lead.organization_id,
    deleted_at: lead.deleted_at,
    note: "Un-deletes only; does not re-add to pipes.",
  };
}

export const leadRestoreTool: ToolDef = {
  name: "lead.restore",
  description: "Restore a soft-deleted lead (un-delete) within an org, RLS-scoped as master. " +
    "Dry-run shows the lead; pass confirm_token to apply. Does not re-add to pipes.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      org_id: { type: "string", description: "Organization UUID" },
      lead_id: { type: "string", description: "Lead UUID (soft-deleted)" },
      confirm_token: { type: "string", description: "Echo the dry-run confirmToken to apply" },
    },
    required: ["org_id", "lead_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);
    const leadId = String(args.lead_id);

    const res = await runMutation({
      plan: async () => {
        const { data, error } = await db.from("leads")
          .select("id,name,organization_id,deleted_at")
          .eq("organization_id", org).eq("id", leadId).not("deleted_at", "is", null).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No soft-deleted lead found for that id/org.");
        return buildRestorePlan(data as Record<string, unknown>);
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "lead.restore",
          org_id: org,
          target_type: "lead",
          target_id: leadId,
          params: args,
          plan,
          confirm_token: token,
        }),
      apply: async () => {
        const { error } = await db.rpc("restore_lead", { p_lead_id: leadId });
        if (error) throw new Error(error.message);
        return { restored: leadId };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
