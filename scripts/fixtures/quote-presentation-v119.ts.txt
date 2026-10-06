import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { QuoteContext } from "./tool.ts";
import { quoteLiveSendEnabled } from "./live-send.ts";

export interface QuoteInbound { storage: "whatsapp_messages" | "channel_messages"; messageIds: string[] }
export interface QuotePresentation { conversation_id: string; quote_id: string; revision: number; summary: string; message_id: string }
export interface QuoteReceipt { accepted_at: string; instance_id: string; quote_id: string; revision: number }
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Each presentation is a new occurrence, independent of chat text deduplication. */
export async function createQuotePresentation(db: SupabaseClient, presentation: Omit<QuotePresentation,"message_id">): Promise<QuotePresentation> {
  const result = await db.from("conversation_messages").insert({conversation_id:presentation.conversation_id,role:"assistant",content:presentation.summary,metadata:{}}).select("id").single();
  if (result.error || !result.data) throw new Error("Não foi possível registrar a apresentação do orçamento.");
  return {...presentation,message_id:result.data.id};
}

async function sealPresentation(db: SupabaseClient, organizationId: string, message: {id:string; metadata:Record<string,any>}, strict = false) {
  if (message.metadata.quote_presentation) return;
  const delivery = message.metadata.quote_delivery;
  if (!delivery?.message_ids?.length) return;
  const quote = await db.from("copilot_quotes").select("id").eq("organization_id", organizationId).eq("id", delivery.quote_id).eq("conversation_id", delivery.conversation_id).eq("revision", delivery.revision).eq("status", "awaiting_confirmation").maybeSingle();
  if (quote.error && strict) throw new Error("Quote receipt lookup failed");
  if (quote.error || !quote.data) return;
  const chunks = await db.from("whatsapp_messages").select("message_id,status").eq("organization_id", organizationId).eq("instance_id", delivery.instance_id).eq("direction","outgoing").in("message_id",delivery.message_ids);
  if (chunks.error && strict) throw new Error("Quote receipt chunks unavailable");
  if (chunks.error || chunks.data?.length !== delivery.message_ids.length || chunks.data.some(row=>!["sent","delivered","read"].includes(row.status))) return;
  // First completion wins. A duplicated/late callback cannot move consent forward.
  const result = await db.from("conversation_messages").update({metadata:{...message.metadata,quote_presentation:{accepted_at:new Date().toISOString(),instance_id:delivery.instance_id,quote_id:delivery.quote_id,revision:delivery.revision}}}).eq("id", message.id).eq("conversation_id", delivery.conversation_id).is("metadata->quote_presentation",null);
  if (result.error && strict) throw new Error("Quote receipt persistence failed");
  if (result.error) console.warn("[quote] Failed to record summary acceptance");
}

/** Associate all provider chunk IDs, including queued chunks; then attempt completion. */
export async function recordQuotePresentation(db: SupabaseClient, organizationId: string, instanceId: string, presentation: QuotePresentation | undefined, messageIds: string[]): Promise<void> {
  if (!presentation || !messageIds.length || new Set(messageIds).size !== messageIds.length) return;
  const quote = await db.from("copilot_quotes").select("id").eq("organization_id",organizationId).eq("id",presentation.quote_id).eq("conversation_id",presentation.conversation_id).eq("revision",presentation.revision).eq("status","awaiting_confirmation").maybeSingle();
  if (quote.error || !quote.data) return;
  const message = await db.from("conversation_messages").select("id,metadata").eq("id",presentation.message_id).eq("conversation_id",presentation.conversation_id).eq("role","assistant").eq("content",presentation.summary).maybeSingle();
  if (message.error || !message.data || message.data.metadata?.quote_presentation) return;
  const metadata={...message.data.metadata,quote_delivery:{...presentation,instance_id:instanceId,message_ids:messageIds}};
  const saved = await db.from("conversation_messages").update({metadata}).eq("id",message.data.id).eq("conversation_id",presentation.conversation_id).is("metadata->quote_delivery",null).select("id,metadata").maybeSingle();
  if (saved.data) await sealPresentation(db,organizationId,saved.data);
  else if (message.data.metadata?.quote_delivery) await sealPresentation(db,organizationId,message.data);
}

/** Provider receipts/echoes finish queued presentations, never retroactively date them. */
export async function completeQuotePresentations(db: SupabaseClient, organizationId: string, instanceId: string, providerIds: string[], options: { strict?: boolean } = {}): Promise<void> {
  if (!quoteLiveSendEnabled(organizationId)) return;
  const quotes = await db.from("copilot_quotes").select("conversation_id").eq("organization_id",organizationId).eq("status","awaiting_confirmation");
  if (quotes.error && options.strict) throw new Error("Quote receipt candidates unavailable");
  if (quotes.error || !quotes.data?.length) return;
  for (const id of providerIds) {
    const messages = await db.from("conversation_messages").select("id,metadata").in("conversation_id",quotes.data.map(row=>row.conversation_id)).is("metadata->quote_presentation",null).contains("metadata",{quote_delivery:{instance_id:instanceId,message_ids:[id]}});
    if (messages.error && options.strict) throw new Error("Quote receipt presentations unavailable");
    if (!messages.error) for (const message of messages.data ?? []) await sealPresentation(db,organizationId,message,options.strict);
  }
}

/** Uses original persisted inbound timestamps, NOT the later engine/absorb invocation time. */
export async function receivedAfterSummary(db: SupabaseClient, ctx: QuoteContext, presentedAfter: string, summary: string, receipt?: QuoteReceipt): Promise<boolean> {
  const source = ctx.inbound;
  if (!source || !source.messageIds.length || source.messageIds.length > 50 || !receipt || !Number.isFinite(Date.parse(receipt.accepted_at))) return false;
  const incoming = await db.from(source.storage).select("id,content,created_at,timestamp,instance_id")
    .eq("organization_id", ctx.organizationId).eq("lead_id", ctx.leadId).eq("direction", "incoming")
    .in("id", source.messageIds).order("timestamp", { ascending: true }).order("id", { ascending: true });
  if (incoming.error || incoming.data?.length !== new Set(source.messageIds).size) return false;
  if (normalize(incoming.data.map(row => row.content ?? "").join("\n")) !== normalize(ctx.userMessage)) return false;
  const instance = incoming.data[0]?.instance_id;
  if (!instance || instance !== receipt.instance_id || incoming.data.some(row => row.instance_id !== instance)) return false;
  const timestamps = incoming.data.flatMap(row => [Date.parse(row.created_at), Date.parse(row.timestamp ?? row.created_at)]);
  if (timestamps.some(time => !Number.isFinite(time))) return false;
  const earliest = Math.min(...timestamps);
  if (earliest <= Date.parse(presentedAfter) || earliest <= Date.parse(receipt.accepted_at)) return false;
  const outgoing = await db.from("whatsapp_messages").select("content,created_at,status")
    .eq("organization_id", ctx.organizationId).eq("lead_id", ctx.leadId).eq("instance_id", instance).eq("direction", "outgoing")
    .gte("created_at", presentedAfter).lt("created_at", new Date(earliest).toISOString())
    .order("created_at", { ascending: false }).limit(25);
  if (outgoing.error || !outgoing.data?.length) return false;
  // A later question (human or AI) invalidates a bare "sim". Accept a suffix
  // matching the complete summary to support repeated presentations/chunks.
  const rows = [...outgoing.data].reverse();
  for (let start = 0; start < rows.length; start++) {
    const tail = rows.slice(start);
    if (tail.every(row => ["sent", "delivered", "read"].includes(row.status)) && normalize(tail.map(row => row.content ?? "").join("\n")) === normalize(summary)) return true;
  }
  return false;
}
