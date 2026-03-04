/**
 * Shared logic for sending outbound messages via Evolution API
 * Used by outbound-trigger (immediate) and process-outbound-dispatches (scheduled)
 *
 * Supports:
 * - Text message (firstMessageTemplate, humanized)
 * - Audio voice note (pre-recorded, random from pool) — via copilot_agent_audios
 * - Configurable order: text_first or audio_first
 */

import { humanizeMessage } from "./message-humanizer.ts";
import { sendWhatsAppAudio } from "./audio-sender.ts";

const AUDIO_DELAY_MS = 8000; // 8 seconds between text and audio

interface DispatchRow {
  id: string;
  lead_id: string;
  organization_id: string;
  agent_id: string;
  message_content: string;
  lead?: { phone?: string; name?: string };
  agent?: { whatsapp_instance_id?: string; outbound_config?: OutboundConfig };
}

interface OutboundConfig {
  audioEnabled?: boolean;
  audioSendOrder?: "text_first" | "audio_first";
  [key: string]: unknown;
}

interface AudioRecord {
  id: string;
  public_url: string;
  name: string;
}

/**
 * Sends a single outbound dispatch via WhatsApp Evolution API
 */
// deno-lint-ignore no-explicit-any
export async function sendOutboundDispatch(
  supabase: any,
  dispatchId: string,
  organizationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: dispatch, error: fetchError } = await supabase
      .from("outbound_dispatch_log")
      .select(`
        *,
        lead:leads(phone, name),
        agent:copilot_agents(whatsapp_instance_id, outbound_config)
      `)
      .eq("id", dispatchId)
      .single();

    if (fetchError || !dispatch) {
      console.error("[outbound-sender] Dispatch not found:", fetchError);
      return { success: false, error: "Dispatch not found" };
    }

    const row = dispatch as unknown as DispatchRow;
    if (!row.lead?.phone) {
      console.error("[outbound-sender] Lead has no phone");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "Lead has no phone" })
        .eq("id", dispatchId);
      return { success: false, error: "Lead has no phone" };
    }

    let instanceName: string | null = null;
    if (row.agent?.whatsapp_instance_id) {
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("id", row.agent.whatsapp_instance_id)
        .single();
      instanceName = instance?.instance_name ?? null;
    }
    if (!instanceName) {
      const { data: instance } = await supabase
        .from("whatsapp_instances")
        .select("instance_name")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .limit(1)
        .maybeSingle();
      instanceName = instance?.instance_name ?? null;
    }
    if (!instanceName) {
      console.error("[outbound-sender] No WhatsApp instance found");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "No WhatsApp instance available" })
        .eq("id", dispatchId);
      return { success: false, error: "No WhatsApp instance available" };
    }

    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");
    if (!evolutionUrl || !evolutionKey) {
      console.error("[outbound-sender] Evolution API not configured");
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: "Evolution API not configured" })
        .eq("id", dispatchId);
      return { success: false, error: "Evolution API not configured" };
    }

    let phone = String(row.lead.phone).replace(/\D/g, "");
    if (!phone.startsWith("55")) phone = "55" + phone;

    // Humanizar mensagem para evitar banimento por mensagens repetitivas
    const humanizedContent = await humanizeMessage(row.message_content);

    // Resolver configuração de áudio
    const outboundConfig = row.agent?.outbound_config;
    const audioEnabled = outboundConfig?.audioEnabled === true;
    const audioSendOrder = outboundConfig?.audioSendOrder || "text_first";

    let chosenAudio: AudioRecord | null = null;
    if (audioEnabled && row.agent_id) {
      const { data: audios } = await supabase
        .from("copilot_agent_audios")
        .select("id, public_url, name")
        .eq("agent_id", row.agent_id)
        .eq("is_active", true);

      if (audios && audios.length > 0) {
        // Escolher aleatoriamente
        chosenAudio = audios[Math.floor(Math.random() * audios.length)] as AudioRecord;
      }
    }

    // =====================================================
    // Função auxiliar: enviar texto
    // =====================================================
    const sendText = async (): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
      const sendResponse = await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionKey,
        },
        body: JSON.stringify({
          number: phone,
          text: humanizedContent,
        }),
      });

      if (!sendResponse.ok) {
        const errorText = await sendResponse.text();
        return { ok: false, error: errorText };
      }

      const result = await sendResponse.json();
      return { ok: true, messageId: result?.key?.id };
    };

    // =====================================================
    // Função auxiliar: enviar áudio
    // =====================================================
    const sendAudio = async (): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
      if (!chosenAudio) return { ok: false, error: "No audio available" };

      const result = await sendWhatsAppAudio(instanceName!, phone, chosenAudio.public_url);
      return { ok: result.success, messageId: result.messageId, error: result.error };
    };

    // =====================================================
    // Executar envio na ordem configurada
    // =====================================================
    let textResult: { ok: boolean; messageId?: string; error?: string };
    let audioResult: { ok: boolean; messageId?: string; error?: string } | null = null;

    if (chosenAudio && audioSendOrder === "audio_first") {
      // Áudio primeiro → texto imediato (delay assíncrono)
      audioResult = await sendAudio();
      textResult = await sendText();
    } else if (chosenAudio) {
      // Texto primeiro → áudio agendado em background (não bloqueia)
      textResult = await sendText();
      if (textResult.ok) {
        // Fire-and-forget: envia áudio após delay sem bloquear o dispatch loop
        setTimeout(async () => {
          try {
            await sendAudio();
          } catch (e) {
            console.warn("[outbound-sender] Background audio send failed:", e);
          }
        }, AUDIO_DELAY_MS);
      }
    } else {
      // Sem áudio — comportamento padrão
      textResult = await sendText();
    }

    // Verificar resultado do texto (obrigatório)
    if (!textResult.ok) {
      console.error("[outbound-sender] Failed to send text:", textResult.error);
      await supabase
        .from("outbound_dispatch_log")
        .update({ status: "failed", error_message: textResult.error })
        .eq("id", dispatchId);
      return { success: false, error: textResult.error };
    }

    // Atualizar dispatch log
    const triggerReason = dispatch.trigger_reason || {};
    if (chosenAudio && audioResult?.ok) {
      triggerReason.audioSent = true;
      triggerReason.audioId = chosenAudio.id;
      triggerReason.audioName = chosenAudio.name;
    }

    await supabase
      .from("outbound_dispatch_log")
      .update({
        status: "sent",
        message_id: textResult.messageId,
        sent_at: new Date().toISOString(),
        trigger_reason: triggerReason,
      })
      .eq("id", dispatchId);

    await supabase.from("leads").update({ pipe_whatsapp: "abordado" }).eq("id", row.lead_id);

    const { data: existingPipe } = await supabase
      .from("pipe_whatsapp")
      .select("id")
      .eq("lead_id", row.lead_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (existingPipe) {
      await supabase.from("pipe_whatsapp").update({ status: "abordado" }).eq("id", existingPipe.id);
    } else {
      await supabase.from("pipe_whatsapp").insert({
        lead_id: row.lead_id,
        organization_id: organizationId,
        status: "abordado",
      });
    }

    // Registrar mensagem de texto no histórico
    await supabase.from("whatsapp_messages").insert({
      organization_id: organizationId,
      instance_name: instanceName,
      remote_jid: phone + "@s.whatsapp.net",
      from_me: true,
      message_type: "conversation",
      content: humanizedContent,
      timestamp: new Date().toISOString(),
      status: "sent",
    });

    // Registrar áudio no histórico (se enviado com sucesso)
    if (chosenAudio && audioResult?.ok) {
      await supabase.from("whatsapp_messages").insert({
        organization_id: organizationId,
        instance_name: instanceName,
        remote_jid: phone + "@s.whatsapp.net",
        from_me: true,
        message_type: "audio",
        content: "[Áudio]",
        media_url: chosenAudio.public_url,
        timestamp: new Date().toISOString(),
        status: "sent",
      });
      console.log(`[outbound-sender] Audio sent: ${chosenAudio.name} (${chosenAudio.id})`);
    }

    return { success: true };
  } catch (error) {
    console.error("[outbound-sender] Error:", error);
    await supabase
      .from("outbound_dispatch_log")
      .update({ status: "failed", error_message: String(error) })
      .eq("id", dispatchId);
    return { success: false, error: String(error) };
  }
}
