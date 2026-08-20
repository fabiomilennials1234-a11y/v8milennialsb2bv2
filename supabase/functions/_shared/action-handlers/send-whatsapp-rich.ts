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

  // ⚠️ ESTE NÓ ERA UM CHAMARIZ. O menu o anunciava como "Templates aprovados
  // pela Meta para envio em massa"; o handler lia `whatsapp_templates` — tabela
  // que NUNCA existiu em produção (`to_regclass` devolve null, zero ocorrências
  // em migrations) — e, se existisse, mandaria o conteúdo como TEXTO PURO por
  // `sendTextViaInstance`. Não era HSM. Tinha 0 usos, então a reforma não
  // quebra workflow nenhum.
  //
  // Agora o nó guarda o NOME e o IDIOMA do template aprovado, mais o mapeamento
  // de variáveis. Não há catálogo local: o executor manda com esses dados, e a
  // tela lista pela função que já existe, chamada com login de usuário.
  const templateName = (params.templateName as string | undefined)?.trim();
  const templateLanguage = (params.templateLanguage as string | undefined)?.trim() || "pt_BR";

  if (!templateName) {
    return { success: false, error: "No template configured", retryable: false };
  }

  const wa = await getWhatsAppInstance(supabase, organizationId, params, leadId);
  if (!wa.ok) return wa.failure;
  await enforceWhatsAppRateLimit(supabase, wa.instanceId);

  const phone = await getLeadPhone(supabase, leadId);
  if (!phone) return { success: false, error: "Lead has no phone", retryable: false };

  const recipientBlock = await recipientGate(supabase, wa.instance, phone, organizationId);
  if (recipientBlock) return recipientBlock;

  // ⚠️ O EXECUTOR NÃO LISTA OS TEMPLATES, e isto é uma troca consciente.
  //
  // Listar exigiria refazer aqui todo o caminho de cofre — carregar a subconta,
  // decifrar o token, montar a config — só para validar um nome. Em vez disso o
  // envio referencia o template pelo nome e o fornecedor recusa na resposta do
  // POST, de forma síncrona: o motivo dele chega ao passo da execução.
  //
  // O QUE NÃO FOI MEDIDO: se a recusa por template inexistente vem no corpo da
  // resposta (síncrona, e então legível no passo) ou por callback de status
  // (assíncrona, e então invisível para o executor). A primeira mensagem real
  // com um nome errado decide — e se for a segunda, esta escolha precisa ser
  // revista.
  //
  // A FORMA do template — quantas variáveis, se tem cabeçalho de mídia — vem do
  // que o NÓ guardou quando alguém o escolheu na tela, que é onde a listagem
  // acontece com login de usuário.
  const template = {
    name: templateName,
    id: null,
    language: templateLanguage,
    status: "APPROVED" as const,
    category: null,
    parameterFormat: null,
    components: (params.templateComponents as never) ?? [],
  } as unknown as import("../notificame-templates.ts").NotificameTemplate;

  // A REGRA COMPOSTA decide tudo num lugar só: resolve os valores contra o lead,
  // confere o que falta e monta os componentes. Pendência barra o envio — a Meta
  // recusa parâmetro vazio, e a recusa dela chega depois de o vendedor achar
  // que mandou.
  const { prepararEnvioDeTemplate } = await import("../template-node-valores.ts");
  const preparado = await prepararEnvioDeTemplate({
    template,
    mapeamento: (params.templateVariables as Record<string, string>) ?? {},
    resolver: (texto) => resolveVariables(supabase, leadId, texto, executionContext),
    headerMediaUrl: params.templateHeaderMediaUrl as string | undefined,
  });

  if (!preparado.ok) {
    return {
      success: false,
      error: `Template incompleto — falta: ${preparado.pendencias.join(", ")}`,
      retryable: false,
    };
  }

  const { sendTemplateViaInstance } = await import("../whatsapp-dispatch.ts");
  const sendResult = await sendTemplateViaInstance(
    supabase,
    wa.instance,
    phone,
    {
      name: template.name,
      language: templateLanguage,
      components: preparado.components,
      previewText: preparado.previewText,
      buttonLabels: preparado.buttonLabels,
    },
    {
      trackSource: "workflow-action-template",
      trackId: params._executionId as string | undefined,
    },
  );

  if (!sendResult.success) {
    return { success: false, error: `Template send failed: ${sendResult.error}` };
  }

  // ⚠️ NÃO grava a linha. O provider do canal oficial já a escreve, no mesmo
  // instante do envio — gravar de novo aqui duplicaria a mensagem na conversa.
  return { success: true, message: `Template "${template.name}" enviado` };
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
      provider: wa.instance.provider,
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
      provider: wa.instance.provider,
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
