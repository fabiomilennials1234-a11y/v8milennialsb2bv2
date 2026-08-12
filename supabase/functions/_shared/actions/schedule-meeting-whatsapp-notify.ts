/**
 * AI Action handler — notifica equipe via WhatsApp quando o agente AGENDA uma reunião.
 *
 * Espelha transfer-human-whatsapp-notify.ts. Disparado de forma determinística
 * pelo executeScheduleMeeting (após reunião gravada + Google Calendar), NÃO pela
 * decisão do LLM — toda reunião agendada gera notificação.
 *
 * Recipiente: reutiliza copilot_agents.handoff_notify_phones (mesma lista do handoff).
 * Resolução do agente: conversa (conversations.agent_id) → fallback agente ativo da org.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ActionResult } from "./types.ts";
import { resolveInstance, normalizeBrazilianPhone } from "../whatsapp-dispatch.ts";
import { getWhatsAppProvider } from "../whatsapp-client.ts";
import { persistOutboundMessage } from "../action-handlers/whatsapp-helpers.ts";

interface MeetingMessageParams {
  leadName: string;
  leadCompany: string | null;
  leadPhone: string;
  meetingDate: string; // YYYY-MM-DD
  meetingTime: string; // HH:MM
  meetLink: string | null;
}

/** "2026-06-12" → "12/06/2026". Devolve original se formato inesperado. */
function formatBrDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function buildMeetingNotifyMessage(p: MeetingMessageParams): string {
  const leadLine = p.leadCompany
    ? `*Lead:* ${p.leadName} — ${p.leadCompany}`
    : `*Lead:* ${p.leadName}`;

  const lines = [
    "📅 *Reunião agendada*",
    "",
    leadLine,
    `*Telefone:* ${p.leadPhone}`,
    `*Data:* ${formatBrDate(p.meetingDate)} às ${p.meetingTime}`,
  ];

  if (p.meetLink) {
    lines.push(`*Google Meet:* ${p.meetLink}`);
  }

  lines.push("", "👉 Acesse o sistema para acompanhar.");

  return lines.join("\n");
}

/**
 * Resolve a lista de telefones a notificar a partir do agente.
 * Preferência: agente da conversa. Fallback: primeiro agente ativo da org com
 * handoff_notify_phones não-vazio.
 */
async function resolveNotifyPhones(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string | null,
): Promise<string[]> {
  if (conversationId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("agent_id")
      .eq("id", conversationId)
      .maybeSingle();

    const agentId = conv?.agent_id as string | undefined;
    if (agentId) {
      const { data: agent } = await supabase
        .from("copilot_agents")
        .select("handoff_notify_phones")
        .eq("id", agentId)
        .maybeSingle();

      const phones = (agent?.handoff_notify_phones as string[] | null) ?? [];
      if (phones.length > 0) return phones;
    }
  }

  // Fallback: agente ativo da org com telefones configurados
  const { data: fallback } = await supabase
    .from("copilot_agents")
    .select("handoff_notify_phones")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .not("handoff_notify_phones", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (fallback?.handoff_notify_phones as string[] | null) ?? [];
}

export async function executeScheduleMeetingWhatsappNotify(
  supabase: SupabaseClient,
  params: Record<string, unknown>,
  organizationId: string,
  leadId: string | null,
  conversationId: string | null,
): Promise<ActionResult> {
  if (!leadId) {
    return { success: false, error: "lead_id required" };
  }

  const phones = await resolveNotifyPhones(supabase, organizationId, conversationId);
  if (phones.length === 0) {
    return { success: true, message: "Skipped: no notify phones configured" };
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

  const message = buildMeetingNotifyMessage({
    leadName: lead.name || "Lead",
    leadCompany: lead.company || null,
    leadPhone: normalizeBrazilianPhone(lead.phone) || lead.phone || "N/A",
    meetingDate: (params.meeting_date as string) || "",
    meetingTime: (params.meeting_time as string) || "09:00",
    meetLink: (params.meet_link as string) || null,
  });

  let sent = 0;
  let failed = 0;

  for (const phone of phones) {
    try {
      const target = normalizeBrazilianPhone(phone) || phone;
      const res = await provider.sendText({
        number: target,
        text: message,
        trackSource: "schedule-meeting-whatsapp-notify",
        trackId: `meeting_notify_${leadId}_${phone}`,
      });
      // Entregue. Contagem fecha antes do persist — rastro no banco não pode
      // rebaixar envio bem sucedido a `failed`.
      sent++;

      // Sem esta linha o eco `fromMe` entra como `sent_source='manual'` e o
      // `trg_human_pause_on_manual_send` pausa a IA para o número do vendedor
      // notificado. `leadId` fora de propósito: o destinatário é a equipe, e
      // carimbar o lead colaria o aviso interno na thread do cliente.
      await persistOutboundMessage(supabase, {
        organizationId,
        instanceId: instance.id,
        providerMessageId: res?.message_id,
        phone: target,
        messageType: "conversation",
        content: message,
        sentSource: "copilot",
        fallbackIdPrefix: "meeting",
      });
    } catch (err) {
      console.warn(`[schedule-meeting-whatsapp-notify] Failed to send to ${phone}:`, err);
      failed++;
    }
  }

  if (sent === 0 && failed > 0) {
    return { success: false, error: `All ${failed} notifications failed` };
  }

  return {
    success: true,
    message: `Meeting notification sent: ${sent}/${phones.length} delivered`,
    data: { sent, failed, total: phones.length },
  };
}
