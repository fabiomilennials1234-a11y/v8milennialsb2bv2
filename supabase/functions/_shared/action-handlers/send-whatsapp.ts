/**
 * send_whatsapp action handler — text messages via WhatsApp.
 * Extracted from workflow-action-handler.ts.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { sendMessage } from "../message-gateway.ts";
import { reserveSendOrSkip } from "../send-dedup.ts";
import {
  getWhatsAppInstance,
  getLeadPhone,
  enforceWhatsAppRateLimit,
  resolveVariables,
  buildTrackId,
  recipientGate,
  isRetryableSendFailure,
} from "./whatsapp-helpers.ts";

export async function sendWhatsApp(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsApp" };
  }

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  // Pre-flight: a recipient not on WhatsApp fails permanently. Skip the send and
  // mark non-retryable so the executor terminal-fails immediately instead of
  // retrying an opaque Uazapi 500 three times over ~8 min.
  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const template = (params.messageTemplate as string) || "";
  const message = await resolveVariables(supabase, leadId, template, executionContext);
  if (!message) return { success: false, error: "Empty message template", retryable: false };

  // Content-hash dedup backstop (fail-open): blocks an identical workflow text to
  // the same number inside the 300s window even if a duplicate execution slipped
  // past the trigger-level dedup (retry, resumed wait node, un-keyed insert path).
  const { duplicate } = await reserveSendOrSkip({
    supabase, orgId: organizationId, phone, content: message, source: "workflow",
  });
  if (duplicate) return { success: true, message: "WhatsApp text skipped (duplicate within window)" };

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
      const error = `WhatsApp send failed: ${sendResult.error}`;
      return { success: false, error, retryable: isRetryableSendFailure(error) };
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
    const error = `WhatsApp send failed: ${gwResult.error}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
  }

  return { success: true, message: "WhatsApp text sent" };
}
