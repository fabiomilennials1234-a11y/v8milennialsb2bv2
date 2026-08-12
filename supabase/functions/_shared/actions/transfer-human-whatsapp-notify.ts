import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import { resolveInstance, normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import { getWhatsAppProvider } from "../whatsapp-client.ts";
import { persistOutboundMessage } from "../action-handlers/whatsapp-helpers.ts";

interface HandoffMessageParams {
  leadName: string;
  leadCompany: string | null;
  leadPhone: string;
  priority: string;
  priorityReason: string;
  summary: string;
  reason: string;
  extraNotes: string | null;
}

export function buildHandoffNotifyMessage(p: HandoffMessageParams): string {
  const leadLine = p.leadCompany
    ? `*Lead:* ${p.leadName} — ${p.leadCompany}`
    : `*Lead:* ${p.leadName}`;

  const priorityLine = p.priorityReason
    ? `*Prioridade:* ${p.priority} — ${p.priorityReason}`
    : `*Prioridade:* ${p.priority}`;

  const lines = [
    "🚨 *Transferência de Lead*",
    "",
    leadLine,
    `*Telefone:* ${p.leadPhone}`,
    priorityLine,
    "",
    "*Resumo da conversa:*",
    p.summary,
    "",
    "*Motivo da transferência:*",
    p.reason,
  ];

  if (p.extraNotes) {
    lines.push("", p.extraNotes);
  }

  lines.push("", "👉 Acesse o sistema para atender.");

  return lines.join("\n");
}

export async function executeTransferHumanWhatsappNotify(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
): Promise<ActionResult> {
  const phones = (params.notify_phones as string[]) || [];
  if (phones.length === 0) {
    return { success: true, message: "Skipped: no phones configured" };
  }

  if (!leadId) {
    return { success: false, error: "lead_id required" };
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("name, company, phone")
    .eq("id", leadId)
    .single();

  if (!lead) {
    return { success: false, error: "lead not found" };
  }

  const instance = await resolveInstance(supabase, organizationId);
  if (!instance) {
    return { success: false, error: "No WhatsApp instance found for org" };
  }

  const provider = await getWhatsAppProvider(instance, supabase);

  const message = buildHandoffNotifyMessage({
    leadName: lead.name || "Lead",
    leadCompany: lead.company || null,
    leadPhone: normalizeBrazilianPhone(lead.phone) || lead.phone || "N/A",
    priority: (params.priority as string) || "NORMAL",
    priorityReason: (params.priority_reason as string) || "",
    summary: (params.summary as string) || "Sem resumo disponível",
    reason: (params.reason as string) || "Sem motivo informado",
    extraNotes: (params.extra_notes as string) || null,
  });

  let sent = 0;
  let failed = 0;

  for (const phone of phones) {
    try {
      const target = normalizeBrazilianPhone(phone) || phone;
      const res = await provider.sendText({
        number: target,
        text: message,
        trackSource: "handoff-whatsapp-notify",
        trackId: `handoff_notify_${leadId}_${phone}`,
      });
      // Entregue. A contagem fecha AQUI, antes de persistir: a linha no banco é
      // rastro, não condição de entrega, e não pode transformar envio bem
      // sucedido em `failed` no relatório.
      sent++;

      // Sem isto, o eco `fromMe` entra como `sent_source='manual'` e o
      // `trg_human_pause_on_manual_send` pausa a IA — aqui, para o número do
      // PRÓPRIO vendedor notificado, que é quem recebe esta mensagem.
      //
      // `leadId` fica de fora de propósito: o destinatário é a equipe, não o
      // lead. Carimbar o lead colaria a notificação interna dentro da thread do
      // cliente no chat.
      await persistOutboundMessage(supabase, {
        organizationId,
        instanceId: instance.id,
        providerMessageId: res?.message_id,
        phone: target,
        messageType: "conversation",
        content: message,
        sentSource: "copilot",
        fallbackIdPrefix: "handoff",
      });
    } catch (err) {
      console.warn(`[handoff-whatsapp-notify] Failed to send to ${phone}:`, err);
      failed++;
    }
  }

  if (sent === 0 && failed > 0) {
    return { success: false, error: `All ${failed} notifications failed` };
  }

  return {
    success: true,
    message: `Handoff notification sent: ${sent}/${phones.length} delivered`,
    data: { sent, failed, total: phones.length },
  };
}
