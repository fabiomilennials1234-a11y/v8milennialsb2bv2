/**
 * `whatsapp.instance_status` (C3) — are my WhatsApp numbers connected?
 *
 * Explicit column list on purpose: `whatsapp_instances` also holds provider_config (can carry
 * provider credentials), the pairing QR code and raw metadata. None of that ever leaves the
 * server through this tool. RLS decides which numbers the caller sees (number restrictions,
 * linked-instance visibility).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { dbErrorResult, errorResult, jsonResult, READ_ONLY, resolveOrgScope } from "./shared.ts";

export interface InstanceRow {
  id: string;
  instance_name: string | null;
  phone_number: string | null;
  status: string | null;
  provider: string | null;
  last_connection_at: string | null;
  session_dead_since: string | null;
  session_dead_reason: string | null;
  reserved_for: string | null;
}

const CONNECTED = new Set(["connected", "open", "online"]);

/** One plain verdict per number, so the model does not have to interpret provider jargon. */
export function instanceHealth(r: InstanceRow): "connected" | "disconnected" | "session_dead" {
  if (r.session_dead_since) return "session_dead";
  return CONNECTED.has((r.status ?? "").toLowerCase()) ? "connected" : "disconnected";
}

export const customerWhatsappStatusTool: ToolDef = {
  name: "whatsapp.instance_status",
  description:
    "Show the WhatsApp numbers of your organization that your user can see, with a plain " +
    "health verdict (connected / disconnected / session_dead) and when each last connected. " +
    "Numbers reserved for a department (e.g. collections) are flagged.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "WhatsApp number status" },
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);

    const db = ctx.db as SupabaseClient;
    const { data, error } = await db
      .from("whatsapp_instances")
      .select(
        "id,instance_name,phone_number,status,provider,last_connection_at,session_dead_since," +
          "session_dead_reason,reserved_for",
      )
      .eq("organization_id", scope.orgId) // defense-in-depth on top of RLS
      .order("instance_name", { ascending: true })
      .limit(100);
    if (error) return dbErrorResult(error);

    const numbers = ((data ?? []) as unknown as InstanceRow[]).map((r) => ({
      id: r.id,
      name: r.instance_name,
      phone: r.phone_number,
      health: instanceHealth(r),
      status: r.status,
      provider: r.provider,
      last_connected_at: r.last_connection_at,
      ...(r.session_dead_since
        ? { session_dead_since: r.session_dead_since, session_dead_reason: r.session_dead_reason }
        : {}),
      ...(r.reserved_for ? { reserved_for: r.reserved_for } : {}),
    }));
    return jsonResult({ count: numbers.length, numbers });
  },
};
