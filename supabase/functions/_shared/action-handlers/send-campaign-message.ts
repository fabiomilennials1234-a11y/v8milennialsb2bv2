/**
 * send_campaign_message action handler.
 * Extracted from workflow-action-handler.ts.
 *
 * Resolves campaign template, substitutes variables, sends via WhatsApp
 * (gateway dual-path with legacy fallback).
 *
 * Params:
 *   - campaignId: string (REQUIRED)
 *   - campaignTemplateId: string (REQUIRED)
 *   - whatsappInstanceId?: string
 *   - _executionId?: string — for tracking
 *   - _nodeId?: string — for tracking
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { sendMessage } from "../message-gateway.ts";
import {
  getWhatsAppInstance,
  getLeadPhone,
  enforceWhatsAppRateLimit,
  resolveVariables,
  buildTrackId,
  recipientGate,
} from "./whatsapp-helpers.ts";

export async function sendCampaignMessage(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  const campaignId = params.campaignId as string;
  const templateId = params.campaignTemplateId as string;

  if (!campaignId) return { success: false, error: "No campaign configured" };
  if (!templateId) return { success: false, error: "No template configured", retryable: false };

  if (!leadId) return { success: false, error: "leadId is required for sendCampaignMessage" };

  // Fetch template
  const { data: template } = await supabase
    .from("campaign_templates")
    .select("content, message_type, audio_url")
    .eq("id", templateId)
    .maybeSingle();

  if (!template) return { success: false, error: "Template not found" };

  // Resolve variables in content
  const message = await resolveVariables(
    supabase, leadId,
    template.content || "",
    executionContext,
  );

  // Resolve WhatsApp instance
  const wa = await getWhatsAppInstance(
    supabase, organizationId,
    params.whatsappInstanceId as string | undefined,
    leadId,
  );
  if (!wa) return { success: false, error: "WhatsApp instance not available" };
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  // Resolve phone
  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const isAudio = template.message_type === "audio" && template.audio_url;
  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: isAudio ? "[Audio]" : message,
    message_type: isAudio ? "audio" : "text",
    source: "workflow",
    media_url: isAudio ? template.audio_url : undefined,
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
  });

  if (!gwResult.delegated) {
    // Legacy path
    const { sendTextViaInstance, sendAudioViaInstance } = await import("../whatsapp-dispatch.ts");
    const executionId = params._executionId as string | undefined;

    const sendResult = isAudio
      ? await sendAudioViaInstance(supabase, wa.instance, phone, template.audio_url, {
          trackSource: "workflow-campaign-message",
          trackId: executionId,
        })
      : await sendTextViaInstance(supabase, wa.instance, phone, message, {
          trackSource: "workflow-campaign-message",
          trackId: executionId,
        });

    if (!sendResult.success) {
      return { success: false, error: `Campaign message send failed: ${sendResult.error}` };
    }

    const messageId = sendResult.messageId || `wf_camp_${crypto.randomUUID()}`;

    await supabase.from("whatsapp_messages").upsert({
      organization_id: organizationId,
      instance_id: wa.instanceId,
      message_id: messageId,
      remote_jid: phone + "@s.whatsapp.net",
      phone_number: phone,
      direction: "outgoing",
      message_type: isAudio ? "audio" : "conversation",
      content: isAudio ? null : message,
      media_url: isAudio ? template.audio_url : null,
      timestamp: new Date().toISOString(),
      status: "sent",
      sent_by_ai: true,
      sent_source: "workflow",
    }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
  } else if (!gwResult.success) {
    console.error("[send-campaign-message] Gateway campaign message send failed:", gwResult.error);
    return { success: false, error: `Campaign message send failed: ${gwResult.error}` };
  }

  return { success: true, message: "Campaign message sent" };
}
