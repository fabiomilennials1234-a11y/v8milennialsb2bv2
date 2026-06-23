/**
 * send_whatsapp_audio / send_whatsapp_image / send_whatsapp_sticker action handlers.
 * Extracted from workflow-action-handler.ts. Shared pattern: media via WhatsApp.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { sendMessage } from "../message-gateway.ts";
import { getWhatsAppProvider } from "../whatsapp-client.ts";
import { sendAudioViaProvider } from "../audio-sender.ts";
import {
  getWhatsAppInstance,
  getLeadPhone,
  enforceWhatsAppRateLimit,
  resolveVariables,
  buildTrackId,
  recipientGate,
} from "./whatsapp-helpers.ts";

// ─── Audio ─────────────────────────────────────────────────────────────────

export async function sendWhatsAppAudio(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppAudio" };
  }

  const audioUrl = params.audioUrl as string;
  if (!audioUrl) return { success: false, error: "No audio URL configured", retryable: false };

  const wa = await getWhatsAppInstance(
    supabase, organizationId,
    params.whatsappInstanceId as string | undefined,
    leadId,
  );
  if (!wa) return { success: false, error: "WhatsApp instance not available" };
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: "[Audio]",
    message_type: "audio",
    source: "workflow",
    media_url: audioUrl,
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
  });

  if (!gwResult.delegated) {
    // Legacy path
    let provider;
    try {
      provider = await getWhatsAppProvider(wa.instance, supabase);
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as any)?.message ?? JSON.stringify(err);
      return { success: false, error: `WhatsApp provider error: ${msg}` };
    }

    const result = await sendAudioViaProvider(provider, phone, audioUrl, {
      trackSource: "workflow-action-audio",
      trackId: params._executionId as string | undefined,
    });
    if (!result.success) return { success: false, error: result.error || "Audio send failed" };

    const messageId = result.messageId || `wf_${crypto.randomUUID()}`;

    await supabase.from("whatsapp_messages").upsert({
      organization_id: organizationId,
      instance_id: wa.instanceId,
      message_id: messageId,
      remote_jid: phone + "@s.whatsapp.net",
      phone_number: phone,
      direction: "outgoing",
      message_type: "audio",
      content: null,
      media_url: audioUrl,
      timestamp: new Date().toISOString(),
      status: "sent",
      sent_by_ai: true,
      sent_source: "workflow",
    }, { onConflict: "message_id,instance_id", ignoreDuplicates: false });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway audio send failed:", gwResult.error);
    return { success: false, error: `Audio send failed: ${gwResult.error}` };
  }

  return { success: true, message: "WhatsApp audio sent" };
}

// ─── Image ─────────────────────────────────────────────────────────────────

export async function sendWhatsAppImage(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppImage" };
  }

  const imageUrl = params.imageUrl as string;
  if (!imageUrl) return { success: false, error: "No image URL configured", retryable: false };

  const wa = await getWhatsAppInstance(
    supabase, organizationId,
    params.whatsappInstanceId as string | undefined,
    leadId,
  );
  if (!wa) return { success: false, error: "WhatsApp instance not available" };
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const caption = (params.imageCaption as string) || "";
  const resolvedCaption = await resolveVariables(supabase, leadId, caption, executionContext);
  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: resolvedCaption || null,
    message_type: "image",
    source: "workflow",
    media_url: imageUrl,
    caption: resolvedCaption || undefined,
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
  });

  if (!gwResult.delegated) {
    // Legacy path
    const { sendMediaViaInstance } = await import("../whatsapp-dispatch.ts");
    const sendResult = await sendMediaViaInstance(
      supabase,
      wa.instance,
      phone,
      { type: "image", file: imageUrl, caption: resolvedCaption },
      { trackSource: "workflow-action", trackId: params._executionId as string | undefined },
    );

    if (!sendResult.success) return { success: false, error: `Image send failed: ${sendResult.error}` };
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway image send failed:", gwResult.error);
    return { success: false, error: `Image send failed: ${gwResult.error}` };
  }

  return { success: true, message: "WhatsApp image sent" };
}

// ─── Sticker ───────────────────────────────────────────────────────────────

export async function sendWhatsAppSticker(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppSticker" };
  }

  const stickerUrl = params.stickerUrl as string;
  if (!stickerUrl) return { success: false, error: "No sticker URL configured", retryable: false };

  const wa = await getWhatsAppInstance(
    supabase, organizationId,
    params.whatsappInstanceId as string | undefined,
    leadId,
  );
  if (!wa) return { success: false, error: "WhatsApp instance not available" };
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: null,
    message_type: "sticker",
    source: "workflow",
    media_url: stickerUrl,
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
  });

  if (!gwResult.delegated) {
    // Legacy path
    const { sendMediaViaInstance } = await import("../whatsapp-dispatch.ts");
    const sendResult = await sendMediaViaInstance(
      supabase,
      wa.instance,
      phone,
      { type: "sticker", file: stickerUrl },
      { trackSource: "workflow-action", trackId: params._executionId as string | undefined },
    );

    if (!sendResult.success) return { success: false, error: `Sticker send failed: ${sendResult.error}` };
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway sticker send failed:", gwResult.error);
    return { success: false, error: `Sticker send failed: ${gwResult.error}` };
  }

  return { success: true, message: "WhatsApp sticker sent" };
}
