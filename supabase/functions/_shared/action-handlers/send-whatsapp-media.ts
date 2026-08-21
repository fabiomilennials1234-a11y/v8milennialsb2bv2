/**
 * send_whatsapp_audio / send_whatsapp_image / send_whatsapp_video /
 * send_whatsapp_sticker / send_whatsapp_document action handlers.
 * Extracted from workflow-action-handler.ts. Shared pattern: media via WhatsApp.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import { sendMessage } from "../message-gateway.ts";
import { reserveSendOrSkip } from "../send-dedup.ts";
import { getWhatsAppProvider } from "../whatsapp-client.ts";
import { sendAudioViaProvider } from "../audio-sender.ts";
import {
  getWhatsAppInstance,
  getLeadPhone,
  enforceWhatsAppRateLimit,
  resolveVariables,
  buildTrackId,
  recipientGate,
  isRetryableSendFailure,
  persistOutboundMessage,
} from "./whatsapp-helpers.ts";

// ─── Audio ─────────────────────────────────────────────────────────────────

export async function sendWhatsAppAudio(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppAudio" };
  }

  const audioUrl = params.audioUrl as string;
  if (!audioUrl) return { success: false, error: "No audio URL configured", retryable: false };

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  // Content-hash dedup backstop (fail-open) keyed on the media URL.
  const audioDedup = await reserveSendOrSkip({ supabase, orgId: organizationId, phone, content: `audio:${audioUrl}`, source: "workflow" });
  if (audioDedup.duplicate) return { success: true, message: "WhatsApp audio skipped (duplicate within window)" };

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
    if (!result.success) {
      const error = result.error || "Audio send failed";
      return { success: false, error, retryable: isRetryableSendFailure(error) };
    }

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: result.messageId,
      phone,
      messageType: "audio",
      content: null,
      mediaUrl: audioUrl,
      leadId,
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway audio send failed:", gwResult.error);
    const error = `Audio send failed: ${gwResult.error}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
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

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const caption = (params.imageCaption as string) || "";
  const resolvedCaption = await resolveVariables(supabase, leadId, caption, executionContext);

  // Content-hash dedup backstop (fail-open) keyed on the image URL + caption.
  const imgDedup = await reserveSendOrSkip({ supabase, orgId: organizationId, phone, content: `image:${imageUrl}|${resolvedCaption}`, source: "workflow" });
  if (imgDedup.duplicate) return { success: true, message: "WhatsApp image skipped (duplicate within window)" };

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

    if (!sendResult.success) {
      const error = `Image send failed: ${sendResult.error}`;
      return { success: false, error, retryable: isRetryableSendFailure(error) };
    }

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: "image",
      content: resolvedCaption || null,
      mediaUrl: imageUrl,
      leadId,
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway image send failed:", gwResult.error);
    const error = `Image send failed: ${gwResult.error}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
  }

  return { success: true, message: "WhatsApp image sent" };
}

// ─── Video (MP4 — até 16MB) ────────────────────────────────────────────────

export async function sendWhatsAppVideo(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppVideo" };
  }

  const videoUrl = params.videoUrl as string;
  if (!videoUrl) return { success: false, error: "No video URL configured", retryable: false };

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const caption = (params.videoCaption as string) || "";
  const resolvedCaption = await resolveVariables(supabase, leadId, caption, executionContext);

  // Content-hash dedup backstop (fail-open) keyed on the video URL + caption.
  const videoDedup = await reserveSendOrSkip({ supabase, orgId: organizationId, phone, content: `video:${videoUrl}|${resolvedCaption}`, source: "workflow" });
  if (videoDedup.duplicate) return { success: true, message: "WhatsApp video skipped (duplicate within window)" };

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: resolvedCaption || null,
    message_type: "video",
    source: "workflow",
    media_url: videoUrl,
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
      { type: "video", file: videoUrl, caption: resolvedCaption },
      { trackSource: "workflow-action", trackId: params._executionId as string | undefined },
    );

    if (!sendResult.success) {
      const error = `Video send failed: ${sendResult.error}`;
      return { success: false, error, retryable: isRetryableSendFailure(error) };
    }

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: "video",
      content: resolvedCaption || null,
      mediaUrl: videoUrl,
      leadId,
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway video send failed:", gwResult.error);
    const error = `Video send failed: ${gwResult.error}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
  }

  return { success: true, message: "WhatsApp video sent" };
}

// ─── Sticker ───────────────────────────────────────────────────────────────

export async function sendWhatsAppSticker(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppSticker" };
  }

  const stickerUrl = params.stickerUrl as string;
  if (!stickerUrl) return { success: false, error: "No sticker URL configured", retryable: false };

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  // Content-hash dedup backstop (fail-open) keyed on the sticker URL.
  const stickerDedup = await reserveSendOrSkip({ supabase, orgId: organizationId, phone, content: `sticker:${stickerUrl}`, source: "workflow" });
  if (stickerDedup.duplicate) return { success: true, message: "WhatsApp sticker skipped (duplicate within window)" };

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

    if (!sendResult.success) {
      const error = `Sticker send failed: ${sendResult.error}`;
      return { success: false, error, retryable: isRetryableSendFailure(error) };
    }

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: "sticker",
      content: null,
      mediaUrl: stickerUrl,
      leadId,
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway sticker send failed:", gwResult.error);
    const error = `Sticker send failed: ${gwResult.error}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
  }

  return { success: true, message: "WhatsApp sticker sent" };
}

// ─── Document (PDF/DOC — até 16MB) ───────────────────────────────────────────

export async function sendWhatsAppDocument(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppDocument" };
  }

  const documentUrl = params.documentUrl as string;
  if (!documentUrl) return { success: false, error: "No document URL configured", retryable: false };
  const documentName = (params.documentName as string) || undefined;

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const caption = (params.documentCaption as string) || "";
  const resolvedCaption = await resolveVariables(supabase, leadId, caption, executionContext);

  // Content-hash dedup backstop (fail-open) keyed on the document URL + caption.
  const docDedup = await reserveSendOrSkip({ supabase, orgId: organizationId, phone, content: `document:${documentUrl}|${resolvedCaption}`, source: "workflow" });
  if (docDedup.duplicate) return { success: true, message: "WhatsApp document skipped (duplicate within window)" };

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: resolvedCaption || null,
    message_type: "document",
    source: "workflow",
    media_url: documentUrl,
    filename: documentName,
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
      { type: "document", file: documentUrl, filename: documentName, caption: resolvedCaption },
      { trackSource: "workflow-action", trackId: params._executionId as string | undefined },
    );

    if (!sendResult.success) {
      const error = `Document send failed: ${sendResult.error}`;
      return { success: false, error, retryable: isRetryableSendFailure(error) };
    }

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: "document",
      content: resolvedCaption || null,
      mediaUrl: documentUrl,
      leadId,
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-media] Gateway document send failed:", gwResult.error);
    const error = `Document send failed: ${gwResult.error}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
  }

  return { success: true, message: "WhatsApp document sent" };
}
