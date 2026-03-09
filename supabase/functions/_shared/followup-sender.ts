/**
 * Envia mensagem de follow-up via Evolution API e registra execução
 */

import { humanizeMessage } from "./message-humanizer.ts";
import { smartSplitMessage } from "./natural-messaging.ts";

// deno-lint-ignore no-explicit-any
export async function sendFollowupMessage(
  supabase: any,
  params: {
    organizationId: string;
    leadId: string;
    ruleId: string;
    phone: string;
    messageContent: string;
    instanceId: string | null;
    instanceName: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const {
    organizationId,
    leadId,
    ruleId,
    phone,
    messageContent,
    instanceId,
    instanceName,
  } = params;

  const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
  if (!evolutionUrl || !evolutionKey) {
    return { success: false, error: "Evolution API not configured" };
  }

  let formattedPhone = String(phone).replace(/\D/g, "");
  if (!formattedPhone.startsWith("55")) formattedPhone = "55" + formattedPhone;

  // Humanizar mensagem para evitar banimento por mensagens repetitivas
  const humanizedContent = await humanizeMessage(messageContent);

  // Smart split: sempre ativo com intensidade "natural"
  const { chunks, delays } = await smartSplitMessage(humanizedContent, { enabled: true, intensity: "natural" });

  let allSent = true;
  for (let i = 0; i < chunks.length; i++) {
    // Typing indicator antes de cada chunk
    try {
      await fetch(`${evolutionUrl}/chat/sendPresence/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: evolutionKey },
        body: JSON.stringify({ number: formattedPhone, delay: 500, presence: "composing" }),
      });
    } catch { /* best-effort */ }

    // Delay proporcional
    if (delays[i] > 0) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }

    const sendResponse = await fetch(
      `${evolutionUrl}/message/sendText/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionKey,
        },
        body: JSON.stringify({
          number: formattedPhone,
          text: chunks[i],
        }),
      }
    );

    if (!sendResponse.ok) {
      const errText = await sendResponse.text();
      console.error("[followup-sender] Evolution API error on chunk", i + 1, ":", errText);
      allSent = false;
    }
  }

  if (!allSent) {
    return { success: false, error: "Failed to send one or more chunks" };
  }

  const messageId = `followup-${crypto.randomUUID()}`;

  await supabase.from("whatsapp_messages").insert({
    organization_id: organizationId,
    instance_id: instanceId,
    message_id: messageId,
    remote_jid: formattedPhone + "@s.whatsapp.net",
    phone_number: formattedPhone,
    direction: "outgoing",
    message_type: "conversation",
    content: humanizedContent,
    status: "sent",
    lead_id: leadId,
    timestamp: new Date().toISOString(),
  });

  await supabase.from("copilot_followup_execution_log").insert({
    lead_id: leadId,
    rule_id: ruleId,
    organization_id: organizationId,
    message_content: humanizedContent,
    instance_name: instanceName,
  });

  const { data: ctx } = await supabase
    .from("conversation_context_summary")
    .select("followup_count")
    .eq("lead_id", leadId)
    .maybeSingle();

  const newCount = (ctx?.followup_count ?? 0) + 1;
  await supabase
    .from("conversation_context_summary")
    .upsert(
      {
        lead_id: leadId,
        organization_id: organizationId,
        followup_count: newCount,
        last_followup_at: new Date().toISOString(),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "lead_id" }
    );

  return { success: true };
}
