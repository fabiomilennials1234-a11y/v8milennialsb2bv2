import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";

export interface InstanceHealth {
  is_dead: boolean;
  dead_for_minutes: number | null;
}

/** Derive a dead-session signal from session_dead_since. */
export function instanceHealth(
  row: { session_dead_since?: unknown },
  nowMs: number,
): InstanceHealth {
  const since = typeof row.session_dead_since === "string" ? row.session_dead_since : null;
  if (!since) return { is_dead: false, dead_for_minutes: null };
  return { is_dead: true, dead_for_minutes: Math.round((nowMs - Date.parse(since)) / 60000) };
}

const COLS = "id,instance_name,instance_id,phone_number,status,provider,session_dead_since," +
  "session_dead_reason,last_connection_at,owner_team_member_id,copilot_agent_id,updated_at";

export const whatsappInstanceStatusTool: ToolDef = {
  name: "whatsapp.instance_status",
  description:
    "List an organization's WhatsApp instances with health (status + dead-session signal), " +
    "RLS-scoped as master. For diagnosing dead-session / watchdog incidents. (Never reads secrets.)",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: { org_id: { type: "string", description: "Organization UUID" } },
    required: ["org_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);
    const now = Date.now();

    const { data, error } = await db.from("whatsapp_instances").select(COLS)
      .eq("organization_id", org).order("created_at", { ascending: false });
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }

    const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
    const instances = rows.map((row) => ({ ...row, ...instanceHealth(row, now) }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ count: instances.length, instances }, null, 2),
      }],
    };
  },
};
