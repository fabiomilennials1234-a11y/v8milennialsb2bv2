/**
 * send_whatsapp action handler — text messages via WhatsApp.
 * Extracted from workflow-action-handler.ts.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { sendMessage } from "../message-gateway.ts";
import {
  getWhatsAppInstance,
  getLeadPhone,
  enforceWhatsAppRateLimit,
  resolveVariables,
  buildTrackId,
} from "./whatsapp-helpers.ts";

export async function sendWhatsApp(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsApp" };
  }

  const wa = await getWhatsAppInstance(
    supabase, organizationId,
    params.whatsappInstanceId as string | undefined,
    leadId,
  );
  if (!wa) return { success: false, error: "WhatsApp instance not available" };
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const template = (params.messageTemplate as string) || "";
  const message = await resolveVariables(supabase, leadId, template, executionContext);
  if (!message) return { success: false, error: "Empty message template", retryable: false };

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: message,
    message_type: "text",
    source: "workflow",
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
  });

  if (!gwResult.delegated) {
    // Legacy path
    const { sendTextViaInstance } = await import("../whatsapp-dispatch.ts");
    const sendResult = await sendTextViaInstance(supabase, wa.instance, phone, message, {
      trackSource: "workflow-action",
      trackId: params._executionId as string | undefined,
    });

    if (!sendResult.success) {
      return { success: false, error: `WhatsApp send failed: ${sendResult.error}` };
    }

    const messageId = sendResult.messageId || `wf_${crypto.randomUUID()}`;

    await supabase.from("whatsapp_messages").upsert({
      organization_id: organizationId,
      instance_id: wa.instanceId,
      message_id: messageId,
      remote_jid: phone + "@s.whatsapp.net",
      phone_number: phone,
      direction: "outgoing",
      message_type: "conversation",
      content: message,
      timestamp: new Date().toISOString(),
      status: "sent",
      sent_by_ai: true,
      sent_source: "workflow",
    }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp] Gateway send failed:", gwResult.error);
    return { success: false, error: `WhatsApp send failed: ${gwResult.error}` };
  }

  return { success: true, message: "WhatsApp text sent" };
}
