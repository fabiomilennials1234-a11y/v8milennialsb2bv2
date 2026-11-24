/**
 * `conversation.get` (C3) — the WhatsApp thread of one lead/phone, as the caller sees it.
 *
 * The thread is keyed by `normalized_phone`, not `lead_id`: the summary row sticks to the
 * FIRST lead a number ever had, so lead_id would hide history for a re-linked contact.
 * Visibility is entirely RLS (chat ownership, number restrictions, strict-owner regimes) —
 * a member who cannot open that chat in the app gets an empty thread here too.
 *
 * Never returned: raw provider payloads, media URLs, internal routing fields. Media shows up
 * as its type (and transcription, when there is one).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { normalizeBrazilianPhone } from "../lib/phone.ts";
import {
  clampLimit,
  clip,
  dbErrorResult,
  errorResult,
  isFromUs,
  jsonResult,
  optionalIsoDate,
  optionalUuid,
  READ_ONLY,
  resolveOrgScope,
} from "./shared.ts";

export const CONVERSATION_DEFAULT = 30;
export const CONVERSATION_MAX = 100;
const MESSAGE_CHARS = 2_000;

export interface MessageRow {
  timestamp: string | null;
  created_at: string | null;
  direction: string | null;
  message_type: string | null;
  content: string | null;
  transcription_text: string | null;
  push_name: string | null;
  sent_by_ai: boolean | null;
}

/** Oldest → newest, compact, text clipped. Pure. */
export function shapeThread(rows: MessageRow[]): Array<Record<string, unknown>> {
  return rows
    .slice()
    .reverse()
    .map((m) => ({
      at: m.timestamp ?? m.created_at,
      from: isFromUs(m.direction) ? "us" : "contact",
      ...(m.sent_by_ai ? { by_ai: true } : {}),
      type: m.message_type ?? "text",
      text: clip(m.content, MESSAGE_CHARS),
      ...(m.transcription_text ? { transcription: clip(m.transcription_text, MESSAGE_CHARS) } : {}),
      ...(m.push_name && !isFromUs(m.direction) ? { name: m.push_name } : {}),
    }));
}

export const customerConversationGetTool: ToolDef = {
  name: "conversation.get",
  description:
    "Read the WhatsApp conversation with one of your leads (by lead_id) or with a phone " +
    "number. Returns the most recent messages, oldest first (default 30, max 100); pass " +
    "`before` with the oldest `at` to page further back. Only chats your user can open are " +
    "returned.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Read WhatsApp conversation" },
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string", description: "Lead UUID" },
      phone: { type: "string", description: "Phone in any format" },
      limit: { type: "integer", minimum: 1, maximum: CONVERSATION_MAX },
      before: { type: "string", description: "ISO-8601 timestamp; messages strictly before it" },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const db = ctx.db as SupabaseClient;

    const before = optionalIsoDate(args.before);
    if (before === "invalid") return errorResult("before must be an ISO-8601 timestamp.");
    const limit = clampLimit(args.limit, CONVERSATION_DEFAULT, CONVERSATION_MAX);

    let phone: string | null = null;
    let leadId: string | null = null;
    const id = optionalUuid(args.lead_id);
    if (id === "invalid") return errorResult("lead_id must be a UUID.");
    if (id) {
      // Resolve through `leads` so the caller must be able to see the lead first.
      const { data, error } = await db
        .from("leads")
        .select("id,normalized_phone")
        .eq("organization_id", scope.orgId)
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return dbErrorResult(error);
      if (!data) return errorResult("No lead found.");
      leadId = (data as { id: string }).id;
      phone = (data as { normalized_phone: string | null }).normalized_phone;
      if (!phone) {
        return jsonResult({ lead_id: leadId, count: 0, messages: [], note: "Lead has no phone." });
      }
    } else if (typeof args.phone === "string" && args.phone.trim()) {
      phone = normalizeBrazilianPhone(args.phone);
      if (!phone) return errorResult("Phone has no digits.");
    } else {
      return errorResult("Provide lead_id or phone.");
    }

    let req = db
      .from("whatsapp_messages")
      .select(
        "timestamp,created_at,direction,message_type,content,transcription_text,push_name,sent_by_ai",
      )
      .eq("organization_id", scope.orgId) // defense-in-depth on top of RLS
      .eq("normalized_phone", phone)
      .is("deleted_at", null)
      .or("is_group.is.null,is_group.eq.false");
    if (before) req = req.lt("timestamp", before);

    const { data, error } = await req
      .order("timestamp", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) return dbErrorResult(error);

    const messages = shapeThread((data ?? []) as MessageRow[]);
    return jsonResult({
      ...(leadId ? { lead_id: leadId } : {}),
      phone,
      count: messages.length,
      messages,
    });
  },
};
