import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";

export interface ThreadSummary {
  total: number;
  inbound: number;
  outbound: number;
  last_at: string | null;
  awaiting_reply: boolean;
}

/** Summarize a thread: counts + whether the last message was ours (awaiting reply). */
export function threadSummary(
  messages: Array<{ direction?: unknown; timestamp?: unknown }>,
): ThreadSummary {
  const inbound = messages.filter((m) => m.direction === "incoming").length;
  const outbound = messages.filter((m) => m.direction === "outgoing").length;
  const last = messages[messages.length - 1];
  return {
    total: messages.length,
    inbound,
    outbound,
    last_at: last ? String(last.timestamp) : null,
    awaiting_reply: !!last && last.direction === "outgoing",
  };
}

const MSG_COLS = "id,direction,message_type,content,timestamp,push_name,lead_id,instance_id";

export const conversationGetTool: ToolDef = {
  name: "conversation.get",
  description:
    "Fetch the WhatsApp message thread for a phone within an organization (RLS-scoped as master), " +
    "with the resolved lead and a summary. Provide org_id and phone.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      org_id: { type: "string", description: "Organization UUID" },
      phone: { type: "string", description: "Phone in any format (normalized server-side)" },
    },
    required: ["org_id", "phone"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);

    const { data: norm, error: nErr } = await db.rpc("normalize_brazilian_phone", {
      phone: String(args.phone),
    });
    if (nErr) {
      return {
        content: [{ type: "text", text: `Error normalizing phone: ${nErr.message}` }],
        isError: true,
      };
    }
    const normalized = String(norm);

    const { data: messages, error: mErr } = await db.from("whatsapp_messages").select(MSG_COLS)
      .eq("organization_id", org).eq("normalized_phone", normalized)
      .is("deleted_at", null).order("timestamp", { ascending: true });
    if (mErr) return { content: [{ type: "text", text: `Error: ${mErr.message}` }], isError: true };

    const { data: lead } = await db.from("leads")
      .select("id,name,company,email")
      .eq("organization_id", org).eq("normalized_phone", normalized)
      .is("deleted_at", null).limit(1).maybeSingle();

    const payload = {
      phone: normalized,
      lead: lead ?? null,
      summary: threadSummary(messages ?? []),
      messages: messages ?? [],
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};
