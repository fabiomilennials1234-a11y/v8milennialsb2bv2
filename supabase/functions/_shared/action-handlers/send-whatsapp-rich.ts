/**
 * send_whatsapp_template / send_whatsapp_menu / send_whatsapp_pix_button action handlers.
 * Extracted from workflow-action-handler.ts. Rich/interactive WhatsApp messages.
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
  persistOutboundMessage,
} from "./whatsapp-helpers.ts";

// ─── Template ──────────────────────────────────────────────────────────────

export async function sendWhatsAppTemplate(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppTemplate" };
  }

  const templateId = params.templateId as string;
  if (!templateId) return { success: false, error: "No template configured", retryable: false };

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  // Fetch template from DB
  const { data: tpl } = await supabase
    .from("whatsapp_templates")
    .select("name, content")
    .eq("id", templateId)
    .maybeSingle();

  if (!tpl) return { success: false, error: "Template not found" };

  const message = await resolveVariables(supabase, leadId, tpl.content || "", executionContext);
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
      trackSource: "workflow-action-template",
      trackId: params._executionId as string | undefined,
    });

    if (!sendResult.success) return { success: false, error: `Template send failed: ${sendResult.error}` };

    // `conversation` é o tipo que o resto do envio de texto por workflow já grava
    // (5.299 das 5.354 linhas `sent_source='workflow'` dos últimos 7 dias).
    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: "conversation",
      content: message,
      leadId,
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-rich] Gateway template send failed:", gwResult.error);
    return { success: false, error: `Template send failed: ${gwResult.error}` };
  }

  return { success: true, message: `Template "${tpl.name}" sent` };
}

// ─── Menu (button/list/poll/carousel) ──────────────────────────────────────

export async function sendWhatsAppMenu(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppMenu" };
  }

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const menuType = (params.menuType as string) || "button";
  if (!["button", "list", "poll", "carousel"].includes(menuType)) {
    return { success: false, error: `Invalid menuType: ${menuType}` };
  }

  const rawText = (params.menuText as string) || "";
  const text = await resolveVariables(supabase, leadId, rawText, executionContext);
  if (!text) return { success: false, error: "Empty menu text", retryable: false };

  const rawChoices = params.menuChoices as string[] | undefined;
  if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
    return { success: false, error: "Menu requires at least one choice", retryable: false };
  }
  const choices = await Promise.all(
    rawChoices.map((c) => resolveVariables(supabase, leadId, c, executionContext)),
  );

  const footer = params.menuFooter
    ? await resolveVariables(supabase, leadId, params.menuFooter as string, executionContext)
    : undefined;

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: text,
    message_type: "menu",
    source: "workflow",
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
    menu_options: {
      type: menuType as "button" | "list" | "poll" | "carousel",
      choices,
      footer,
      selectableCount: params.menuSelectableCount as number | undefined,
    },
  });

  if (!gwResult.delegated) {
    // Legacy path
    const { sendMenuViaInstance } = await import("../whatsapp-dispatch.ts");
    const sendResult = await sendMenuViaInstance(
      supabase,
      wa.instance,
      phone,
      {
        type: menuType as "button" | "list" | "poll" | "carousel",
        text,
        choices,
        footer,
        selectableCount: params.menuSelectableCount as number | undefined,
      },
      { trackSource: "workflow-action-menu", trackId: params._executionId as string | undefined },
    );

    if (!sendResult.success) return { success: false, error: `Menu send failed: ${sendResult.error}` };

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: menuType,
      content: text,
      leadId,
      fallbackIdPrefix: "wf_menu",
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-rich] Gateway menu send failed:", gwResult.error);
    return { success: false, error: `Menu send failed: ${gwResult.error}` };
  }

  return { success: true, message: `WhatsApp ${menuType} menu sent` };
}

// ─── PIX Button ────────────────────────────────────────────────────────────

export async function sendWhatsAppPixButton(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  if (!leadId) {
    return { success: false, error: "leadId is required for sendWhatsAppPixButton" };
  }

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  const pixkey = params.pixkey as string;
  const pixkeyType = params.pixkeyType as string;
  const amount = Number(params.pixAmount ?? 0);
  const merchantName = params.pixMerchantName as string;

  if (!pixkey || !pixkeyType || !merchantName || !(amount > 0)) {
    return { success: false, error: "Missing PIX config (pixkey/pixkeyType/pixAmount/merchantName)" };
  }
  if (!["cpf", "cnpj", "email", "phone", "random"].includes(pixkeyType)) {
    return { success: false, error: `Invalid pixkeyType: ${pixkeyType}` };
  }

  const rawText = (params.pixText as string) || "";
  const text = rawText
    ? await resolveVariables(supabase, leadId, rawText, executionContext)
    : undefined;

  const trackId = buildTrackId(params);

  // Gateway dual-path
  const gwResult = await sendMessage(supabase, {
    organization_id: organizationId,
    phone,
    content: text || `[PIX R$ ${amount.toFixed(2)}]`,
    message_type: "pix_button",
    source: "workflow",
    instance_id: wa.instanceId,
    lead_id: leadId,
    track_id: trackId,
    triggered_by: "workflow",
    pix_payload: {
      pixkey,
      pixkeyType: pixkeyType as "cpf" | "cnpj" | "email" | "phone" | "random",
      amount,
      merchantName,
    },
  });

  if (!gwResult.delegated) {
    // Legacy path
    const { sendPixButtonViaInstance } = await import("../whatsapp-dispatch.ts");
    const sendResult = await sendPixButtonViaInstance(
      supabase,
      wa.instance,
      phone,
      {
        pixkey,
        pixkeyType: pixkeyType as "cpf" | "cnpj" | "email" | "phone" | "random",
        amount,
        merchantName,
        text,
      },
      { trackSource: "workflow-action-pix", trackId: params._executionId as string | undefined },
    );

    if (!sendResult.success) return { success: false, error: `PIX button failed: ${sendResult.error}` };

    await persistOutboundMessage(supabase, {
      organizationId,
      instanceId: wa.instanceId,
      providerMessageId: sendResult.messageId,
      phone,
      messageType: "pix_button",
      content: text || `[PIX R$ ${amount.toFixed(2)}]`,
      leadId,
      fallbackIdPrefix: "wf_pix",
    });
  } else if (!gwResult.success) {
    console.error("[send-whatsapp-rich] Gateway PIX button send failed:", gwResult.error);
    return { success: false, error: `PIX button failed: ${gwResult.error}` };
  }

  return { success: true, message: "PIX button sent" };
}
