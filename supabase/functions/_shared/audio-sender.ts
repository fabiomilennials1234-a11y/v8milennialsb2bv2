/**
 * Shared utility for sending WhatsApp audio messages (voice notes) via Evolution API
 *
 * Used by:
 * - outbound-sender.ts (copilot outbound audio dispatch)
 * - Can be imported by campaign-rule-dispatch, pipe-rule-dispatch, etc.
 */

/**
 * Sends a WhatsApp audio voice note (ptt = true / bolinha azul) via Evolution API
 */
export async function sendWhatsAppAudio(
  instanceName: string,
  phoneNumber: string,
  audioUrl: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
  const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

  if (!evolutionUrl || !evolutionKey) {
    return { success: false, error: "Evolution API not configured" };
  }

  try {
    let phone = phoneNumber.replace(/\D/g, "");
    if (!phone.startsWith("55")) phone = "55" + phone;

    const response = await fetch(
      `${evolutionUrl}/message/sendWhatsAppAudio/${instanceName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: evolutionKey,
        },
        body: JSON.stringify({ number: phone, audio: audioUrl }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[audio-sender] Failed to send audio:", errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    const messageId = result?.key?.id;
    return { success: true, messageId };
  } catch (error) {
    console.error("[audio-sender] Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
