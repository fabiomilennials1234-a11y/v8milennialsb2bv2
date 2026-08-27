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
  providerPersistsOwnMessages,
} from "./whatsapp-helpers.ts";
import { enviarTemplateAprovado } from "./enviar-template.ts";
import {
  decidirEnvioDoNoDeTexto,
  escapeConfigurado,
  escapeDoNo,
  janelaPeloErroDoTransporte,
  modoDoNo,
  MOTIVO_LEGIVEL_SEM_TEMPLATE,
  templateDoNo,
} from "../decisao-de-envio.ts";

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

  // ─── MODO TEMPLATE — o nó manda a forma aprovada, e só ela ────────────────
  //
  // Sai ANTES da guarda de texto vazio de propósito. No modo template o painel
  // esconde o campo de mensagem, então `messageTemplate` está vazio por
  // construção: deixar a guarda rodar primeiro é exatamente o defeito que esta
  // issue corrige.
  //
  // ⚠️ SEM A DECISÃO DE JANELA, e sem o dedup de conteúdo. A janela não se
  // consulta porque template aprovado é o que a Meta aceita com ela fechada. O
  // dedup por hash não se aplica porque o conteúdo só existe depois que a Meta
  // renderiza o corpo — é a mesma escolha, pelo mesmo motivo, que o nó dedicado
  // `send_whatsapp_template` já fazia; divergir aqui criaria dois
  // comportamentos para o mesmo envio.
  if (modoDoNo(params) === "template") {
    const escolhido = escapeConfigurado(templateDoNo(params));
    if (!escolhido) {
      return { success: false, error: MOTIVO_LEGIVEL_SEM_TEMPLATE, retryable: false };
    }

    const envio = await enviarTemplateAprovado({
      supabase,
      leadId,
      executionContext,
      instance: wa.instance,
      phone,
      template: escolhido,
      trackSource: "workflow-action-template",
      trackId: params._executionId as string | undefined,
    });

    // Byte a byte o que o nó dedicado devolve: `retryable` ausente deixa o
    // executor no default dele (retentar). Divergir aqui daria dois destinos
    // diferentes para a mesma recusa da Meta.
    if (!envio.ok) {
      return { success: false, error: envio.erro, retryable: envio.retryable };
    }

    return {
      success: true,
      message: `Template "${envio.nome}" enviado`,
      data: { motivo: "modo_template", template: envio.nome },
    };
  }

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

  // A falha CRUA do transporte, quando houve. Os dois caminhos convergem nela em
  // vez de cada um devolver a sua: é essa string que carrega o motivo do
  // governor, e a decisão de janela precisa ver os dois caminhos igualmente.
  let erroDoTransporte: string | null = null;

  if (!gwResult.delegated) {
    // Legacy path
    const { sendTextViaInstance } = await import("../whatsapp-dispatch.ts");
    const sendResult = await sendTextViaInstance(supabase, wa.instance, phone, message, {
      trackSource: "workflow-action",
      trackId: params._executionId as string | undefined,
    });

    if (!sendResult.success) {
      erroDoTransporte = sendResult.error ?? "unknown";
    } else {
      const messageId = sendResult.messageId || `wf_${crypto.randomUUID()}`;

      // Ver `providerPersistsOwnMessages`: o canal oficial já gravou a linha em
      // `channel_messages`, e uma segunda cópia aqui nasceria órfã.
      if (!providerPersistsOwnMessages(wa.instance.provider)) {
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
      }
    }
  } else if (!gwResult.success) {
    console.error("[send-whatsapp] Gateway send failed:", gwResult.error);
    erroDoTransporte = gwResult.error ?? "unknown";
  }

  if (!erroDoTransporte) return { success: true, message: "WhatsApp text sent" };

  // ─── A DECISÃO — texto, template ou falha ────────────────────────────────
  //
  // Ela mora INTEIRA em `decisao-de-envio.ts`; aqui só se lê o veredito e se
  // age. Fora do canal oficial o governor nunca emite motivo de janela, então o
  // chip Uazapi cai sempre no ramo `texto` e sai daqui com exatamente a falha
  // que já devolvia antes desta issue.
  const decisao = decidirEnvioDoNoDeTexto({
    janela: janelaPeloErroDoTransporte(erroDoTransporte),
    escape: escapeDoNo(params),
  });

  if (decisao.acao === "texto") {
    const error = `WhatsApp send failed: ${erroDoTransporte}`;
    return { success: false, error, retryable: isRetryableSendFailure(error) };
  }

  if (decisao.acao === "falhar") {
    // Não-retentável de propósito: a janela não reabre com o tempo, reabre com
    // uma mensagem do contato. Três retentativas em ~8 min só adiariam a mesma
    // falha e atrasariam a leitura do motivo por quem opera.
    return {
      success: false,
      error: decisao.motivo,
      retryable: false,
      data: { motivo: "janela_fechada_sem_escape" },
    };
  }

  const envio = await enviarTemplateAprovado({
    supabase,
    leadId,
    executionContext,
    instance: wa.instance,
    phone,
    template: decisao.escape,
    trackSource: "workflow-action-escape-janela",
    trackId: params._executionId as string | undefined,
  });

  if (!envio.ok) {
    // Terminal mesmo quando a falha do template seria retentável: retentar este
    // nó refaz o texto, que volta a ser barrado, e reenvia o template — e um
    // template é justamente o envio que não pode sair duas vezes.
    return {
      success: false,
      error: `Janela de 24h fechada e o template de escape não saiu: ${envio.erro}`,
      retryable: false,
      data: { motivo: "janela_fechada_escape_falhou" },
    };
  }

  return {
    success: true,
    message: `Janela de 24h fechada — template de escape "${envio.nome}" enviado`,
    data: { motivo: "janela_fechada_escape_enviado", template: envio.nome },
  };
}
