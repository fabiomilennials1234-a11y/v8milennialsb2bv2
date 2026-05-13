// deno-lint-ignore-file no-explicit-any
/**
 * Shared utility for sending WhatsApp audio voice notes (PTT).
 *
 * Provider-agnostic: uses whatsapp-client adapter. Evolution and Uazapi
 * both supported via the unified SendMediaOptions contract with type=ptt.
 */

import type { WhatsAppProvider } from "./whatsapp-client.ts";

export type SendAudioResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Sends a voice note via an already-resolved provider instance.
 * Preferred entry point — avoids duplicate instance lookup.
 */
export async function sendAudioViaProvider(
  provider: WhatsAppProvider,
  phoneNumber: string,
  audioUrl: string,
  opts: { trackSource?: string; trackId?: string } = {}
): Promise<SendAudioResult> {
  try {
    const res = await provider.sendMedia({
      number: phoneNumber,
      type: "ptt",
      file: audioUrl,
      trackSource: opts.trackSource,
      trackId: opts.trackId,
    });
    return { success: true, messageId: res.message_id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}

/**
 * Back-compat wrapper: resolves provider from instance_id + supabase client.
 * Prefer sendAudioViaProvider when the caller already has a provider instance.
 *
 * @deprecated call sites should resolve the provider once and call
 * sendAudioViaProvider directly to avoid redundant DB roundtrips.
 */
export async function sendWhatsAppAudio(
  supabaseAdmin: any,
  instanceId: string,
  phoneNumber: string,
  audioUrl: string,
  opts: { trackSource?: string; trackId?: string } = {}
): Promise<SendAudioResult> {
  try {
    const { data: instance } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("*")
      .eq("id", instanceId)
      .maybeSingle();

    if (!instance) {
      return { success: false, error: "Instance not found" };
    }

    const { getWhatsAppProvider } = await import("./whatsapp-client.ts");
    const provider = await getWhatsAppProvider(instance, supabaseAdmin);
    return await sendAudioViaProvider(provider, phoneNumber, audioUrl, opts);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error
        ? error.message
        : (error as any)?.message ?? JSON.stringify(error),
    };
  }
}
