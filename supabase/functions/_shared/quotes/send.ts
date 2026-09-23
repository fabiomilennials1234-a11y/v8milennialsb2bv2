import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionRecord, ActionResult } from "../actions/types.ts";
import { QUOTE_BUCKET } from "../../../../src/contracts/copilot/quote-document.ts";
import { quoteContext } from "./tool.ts";
import { quoteLiveSendEnabled } from "./live-send.ts";
import { normalizePhoneForSearch } from "../lead-service.ts";
import { resolveDispatchContext, sendMediaViaInstance } from "../whatsapp-dispatch.ts";

/** CAS is permanent for a revision: ambiguous provider results require reconciliation. */
export async function sendQuoteDocument(db: SupabaseClient, action: ActionRecord): Promise<ActionResult> {
  if (!quoteLiveSendEnabled()) return { success: false, error: "quote_live_send_disabled" };
  if (!action.lead_id || !action.conversation_id || typeof action.payload.quote_id !== "string") return { success: false, error: "quote_context_required" };
  const read = await db.from("copilot_quotes").select("*").eq("id", action.payload.quote_id).eq("organization_id", action.organization_id).eq("lead_id", action.lead_id).eq("conversation_id", action.conversation_id).eq("revision", action.payload.revision).maybeSingle();
  if (read.error || !read.data) return { success: false, error: "quote_not_found" };
  const quote = read.data;
  if (quote.status === "sent") return { success: true, data: { skipped: true, quote_id: quote.id } };
  if (["sending", "reconcile"].includes(quote.status)) return { success: false, error: "quote_requires_reconciliation" };
  if (quote.status !== "ready" || !quote.confirmed_at || !quote.file_path?.startsWith(`${quote.organization_id}/${quote.agent_id}/quotes/${quote.id}/`)) return { success: false, error: "quote_not_ready" };
  try {
    const { agent, lead } = await quoteContext(db, { organizationId: action.organization_id, agentId: quote.agent_id, leadId: action.lead_id, conversationId: action.conversation_id, userMessage: "" });
    if (!lead.phone || lead.ai_disabled) return { success: false, error: "quote_recipient_unavailable" };
    // Financial documents fail closed if the canonical pause gate cannot be read.
    const normalized = normalizePhoneForSearch(lead.phone);
    if (!normalized) return { success: false, error: "quote_recipient_unavailable" };
    const preference = await db.from("phone_ai_preferences").select("ai_disabled,human_paused_until").eq("organization_id", action.organization_id).eq("normalized_phone", normalized).maybeSingle();
    if (preference.error || preference.data?.ai_disabled || (preference.data?.human_paused_until && new Date(preference.data.human_paused_until).getTime() > Date.now())) return { success: false, error: "quote_copilot_paused" };
    let instanceId = agent.whatsapp_instance_id;
    if (!instanceId) {
      const linked = await db.from("whatsapp_instances").select("id").eq("organization_id", action.organization_id).eq("copilot_agent_id", quote.agent_id).in("status", ["open", "connected"]).limit(2);
      if (linked.error || linked.data?.length !== 1) return { success: false, error: "quote_agent_instance_required" };
      instanceId = linked.data[0].id;
    }
    const dispatch = await resolveDispatchContext(db, { organization_id: action.organization_id, phone: lead.phone, preferred_instance_id: instanceId, require_connected: true, lead_id: action.lead_id });
    if (dispatch.instance.id !== instanceId) return { success: false, error: "quote_instance_mismatch" };
    const signed = await db.storage.from(QUOTE_BUCKET).createSignedUrl(quote.file_path, 3600);
    if (signed.error || !signed.data?.signedUrl) return { success: false, error: "quote_file_unavailable" };
    const claim = await db.from("copilot_quotes").update({ status: "sending" }).eq("id", quote.id).eq("organization_id", action.organization_id).eq("revision", quote.revision).eq("status", "ready").select("id").maybeSingle();
    if (claim.error || !claim.data) return { success: false, error: "quote_send_claim_failed" };
    try {
      const result = await sendMediaViaInstance(db, dispatch.instance, dispatch.normalizedPhone, { type: "document", file: signed.data.signedUrl, filename: quote.file_name, caption: "Segue seu orçamento." }, { trackSource: "copilot-quote", trackId: quote.id, idempotencyKey: `quote:${quote.id}:${quote.revision}` });
      const status = result.success ? "sent" : "reconcile";
      const stored = await db.from("copilot_quotes").update({ status, provider_message_id: result.messageId ?? null, error_code: result.success ? null : "provider_result_unconfirmed" }).eq("id", quote.id).eq("organization_id", action.organization_id).eq("revision", quote.revision).eq("status", "sending");
      if (stored.error) return { success: false, error: "quote_requires_reconciliation" };
      if (!result.success) return { success: false, error: "quote_requires_reconciliation" };
      if (result.messageId) {
        await db.from("whatsapp_messages").upsert({ organization_id: action.organization_id, lead_id: action.lead_id, instance_id: dispatch.instance.id, message_id: result.messageId, remote_jid: `${dispatch.normalizedPhone}@s.whatsapp.net`, phone_number: dispatch.normalizedPhone, direction: "outgoing", message_type: "document", content: `Orçamento ${quote.id.slice(0, 8)}`, media_url: signed.data.signedUrl, sent_by_ai: true, sent_source: "copilot", status: result.status === "queued" ? "pending" : "sent", timestamp: new Date().toISOString() }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });
      }
      await db.from("lead_history").insert({ lead_id: action.lead_id, organization_id: action.organization_id, action: "quote_document_sent", description: "Orçamento enviado pelo Copilot", metadata: { quote_id: quote.id, revision: quote.revision, provider_message_id: result.messageId } });
      return { success: true, data: { quote_id: quote.id, provider_message_id: result.messageId, provider_status: result.status } };
    } catch {
      await db.from("copilot_quotes").update({ status: "reconcile", error_code: "provider_result_unconfirmed" }).eq("id", quote.id).eq("organization_id", action.organization_id).eq("revision", quote.revision).eq("status", "sending");
      return { success: false, error: "quote_requires_reconciliation" };
    }
  } catch { return { success: false, error: "quote_send_unavailable" }; }
}
