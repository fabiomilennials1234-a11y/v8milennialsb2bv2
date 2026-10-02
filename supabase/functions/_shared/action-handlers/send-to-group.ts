/**
 * send_to_group action handler — manda UMA mensagem de texto para UM grupo de
 * WhatsApp (`…@g.us`) pela instância Uazapi nomeada no nó.
 *
 * Caso de uso: o lead responde, a automação avisa o grupo do time comercial com
 * o template resolvido contra o LEAD e, opcionalmente, o resumo da conversa +
 * o telefone dele — mesma ideia do `send_to_number`, com destino de grupo.
 *
 * Decisões (macro do arquiteto, D1–D9):
 *  - Instância PRESA (`getPinnedWhatsAppInstance`): o grupo é do número, então
 *    não há roteamento, atalho de "uma viva só" nem recuo. Inexistente, de outra
 *    org, de provedor ≠ uazapi ou caída → falha não-retentável, nunca troca.
 *  - SEM `recipientGate`: o `/chat/check` é para telefone; grupo não passa por ele.
 *  - Dedup por conteúdo reservado com `<JID>#<leadId>` como chave opaca,
 *    `source: workflow`. Duplicata = sucesso sem reenvio. Em retentativa o dedup
 *    não é consultado (a 1ª passada já reservou e provou que nada saiu).
 *  - Falha de envio usa `isRetryableSendFailure`: só reenvia quando dá para
 *    provar que a mensagem não saiu. Falha ambígua (5xx/timeout) é terminal —
 *    reenviar duplicaria a mensagem para o grupo inteiro.
 *  - A linha em `whatsapp_messages` é o ÚNICO registro do envio: o eco
 *    `wasSentByApi` da Uazapi é descartado pelo webhook.
 *
 * LGPD: o resumo e o telefone do lead são vistos por todos os membros do grupo.
 * A tela avisa isso no switch; o default é desligado.
 */

import type { ActionInput, ActionResult } from "./types.ts";
import {
  getPinnedWhatsAppInstance,
  getLeadPhone,
  resolveVariables,
  buildTrackId,
  isRetryableSendFailure,
  providerPersistsOwnMessages,
} from "./whatsapp-helpers.ts";
import { sendTextToGroupViaInstance } from "../whatsapp-dispatch.ts";
import { GROUP_PROVIDERS } from "../instance-routing.ts";
import { isValidGroupJid } from "../whatsapp-jid.ts";
import { summarizeConversation } from "./ai-operations.ts";
import { reserveSendOrSkip } from "../send-dedup.ts";

/**
 * Grava o envio como linha OUTGOING de grupo, no mesmo formato que o webhook
 * usa para mensagens de grupo (`remote_jid` = JID, `phone_number` = parte local,
 * `is_group` = true).
 *
 *  - `sent_source: "workflow"` — único valor de automação aceito pelo CHECK de
 *    `whatsapp_messages.sent_source` (manual, copilot, workflow). Também mantém
 *    `fn_human_pause_on_manual_send` quieto (ele só reage a `manual`).
 *  - `lead_id: null` explícito: o grupo não é a conversa do lead.
 *
 * Best-effort: a mensagem já saiu; falha de histórico nunca falha o nó nem o
 * torna retentável.
 */
async function persistGroupMessage(
  supabase: ActionInput["supabase"],
  organizationId: string,
  instance: { id: string; provider?: string | null },
  groupJid: string,
  content: string,
  messageId?: string,
): Promise<void> {
  if (providerPersistsOwnMessages(instance.provider)) return;

  try {
    const { error } = await supabase
      .from("whatsapp_messages")
      .upsert({
        organization_id: organizationId,
        instance_id: instance.id,
        message_id: messageId || `wf_${crypto.randomUUID()}`,
        remote_jid: groupJid,
        phone_number: groupJid.split("@")[0],
        is_group: true,
        direction: "outgoing",
        message_type: "conversation",
        content,
        sent_source: "workflow",
        sent_by_ai: true,
        lead_id: null,
        status: "sent",
        timestamp: new Date().toISOString(),
      }, { onConflict: "message_id,instance_id", ignoreDuplicates: true });
    if (error) {
      console.warn("[send-to-group] history upsert failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.warn("[send-to-group] history upsert threw (non-fatal):", err);
  }
}

export async function sendToGroup(input: ActionInput): Promise<ActionResult> {
  const { supabase, organizationId, leadId, params, executionContext } = input;

  // 1) O template é resolvido contra o lead: sem lead, não há o que mandar.
  if (!leadId) {
    return { success: false, error: "leadId is required for sendToGroup" };
  }

  // 2) Destino. Formato estrito — o JID viaja intacto até o provider.
  const groupJid = params.groupJid;
  if (!isValidGroupJid(groupJid)) {
    return { success: false, error: "send_to_group requires a valid groupJid", retryable: false };
  }
  const groupName = typeof params.groupName === "string" ? params.groupName : null;

  // 3) Instância presa. Sem id, falha — nunca escolhe sozinho.
  const instanceId = typeof params.whatsappInstanceId === "string" ? params.whatsappInstanceId : "";
  if (!instanceId) {
    return { success: false, error: "send_to_group requires whatsappInstanceId", retryable: false };
  }
  const wa = await getPinnedWhatsAppInstance(supabase, organizationId, instanceId, GROUP_PROVIDERS);
  if (!wa.ok) return wa.failure;

  // 4) Template contra o lead.
  const template = typeof params.messageTemplate === "string" ? params.messageTemplate : "";
  let message = await resolveVariables(supabase, leadId, template, executionContext);
  if (!message) return { success: false, error: "Empty message template", retryable: false };

  // 5) Resumo + telefone do lead (opcional, best-effort).
  if (params.includeConversationSummary) {
    try {
      const summaryRes = await summarizeConversation(input);
      const summary = summaryRes.success
        ? (summaryRes.data?.summary as string | undefined)
        : undefined;
      if (summary) message += `\n\n📋 Resumo da conversa:\n${summary}`;
    } catch (err) {
      console.warn("[send-to-group] summary generation failed (non-fatal):", err);
    }
    const leadPhone = await getLeadPhone(supabase, leadId, organizationId);
    if (leadPhone) message += `\n\n📞 Telefone do lead: ${leadPhone}`;
  }

  const data = {
    group_jid: groupJid,
    group_name: groupName,
    includedSummary: !!params.includeConversationSummary,
  };

  // 6) Dedup por conteúdo (fail-open). Duplicata = já entregue, não reenvia.
  //
  //  - A chave inclui o LEAD (`<jid>#<leadId>`; `fn_reserve_send` trata `p_phone`
  //    como texto opaco). Com template estático, só o grupo + conteúdo faria o
  //    aviso de um lead suprimir o de OUTRO lead dentro da janela de 300s.
  //  - Em RETENTATIVA o dedup não é consultado. O executor só reagenda quando
  //    este handler devolveu falha retentável — e aqui isso só acontece quando
  //    `isRetryableSendFailure` prova que nada saiu. Mas a 1ª passada já
  //    consumiu a reserva (hit_count=1, sem release): consultar de novo daria
  //    `duplicate` (limiar 2) e o nó viraria sucesso falso sem enviar nada.
  //    `_retryAttempt` vem do executor (`context._retry_counts[nodeId]`, via
  //    `toActionInput`).
  const retryAttempt = typeof params._retryAttempt === "number" ? params._retryAttempt : 0;
  if (retryAttempt === 0) {
    const dedup = await reserveSendOrSkip({
      supabase,
      orgId: organizationId,
      phone: `${groupJid}#${leadId}`,
      content: message,
      source: "workflow",
    });
    if (dedup.duplicate) {
      return {
        success: true,
        message: "Mensagem já enviada ao grupo nesta janela — reenvio suprimido",
        data: { ...data, deduplicated: true },
      };
    }
  }

  // 7) Envio.
  const res = await sendTextToGroupViaInstance(supabase, wa.instance, groupJid, message, {
    trackSource: "workflow-send-to-group",
    trackId: buildTrackId(params),
  });
  if (!res.success) {
    return {
      success: false,
      error: `WhatsApp group send failed: ${res.error ?? "unknown send error"}`,
      retryable: isRetryableSendFailure(res.error),
      data,
    };
  }

  // 8) Histórico (único registro do envio).
  await persistGroupMessage(supabase, organizationId, wa.instance, groupJid, message, res.messageId);

  // 9) Resultado.
  return {
    success: true,
    message: `Mensagem enviada ao grupo ${groupName || groupJid}`,
    data,
  };
}
