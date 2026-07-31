/**
 * ElevenLabs TTS — generate audio from text and upload to Supabase Storage.
 *
 * Consumed by copilot senders (outbound-sender, agent-message) to convert
 * copilot responses to voice notes (PTT). Upload URL is then sent via the
 * provider adapter as sendMedia(type="ptt").
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logRuntime } from "./logger.ts";

export interface TtsRequest {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  apiKey: string;
  outputFormat?: string;
}

export interface TtsResult {
  success: boolean;
  audioUrl?: string;
  durationMs?: number;
  charCount?: number;
  error?: string;
}

const TTS_TIMEOUT_MS = 10_000;
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_OUTPUT_FORMAT = "mp3_22050_32";
const DEFAULT_STABILITY = 0.5;
const DEFAULT_SIMILARITY_BOOST = 0.75;

/**
 * Truncates text at the last complete sentence before maxChars.
 * Falls back to hard cut at maxChars if no sentence boundary found.
 */
export function truncateForTts(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?")
  );

  if (lastSentenceEnd > maxChars * 0.3) {
    return truncated.slice(0, lastSentenceEnd + 1).trim();
  }

  // No good sentence boundary — hard cut at last space
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace).trim() + "..." : truncated.trim() + "...";
}

/**
 * Generates audio from text via ElevenLabs API and uploads to Supabase Storage.
 * Returns a public URL to the audio file, or { success: false } on failure.
 * Enforces a 10-second timeout.
 */
export async function generateTtsAudio(
  request: TtsRequest,
  organizationId: string
): Promise<TtsResult> {
  const startTime = Date.now();
  const charCount = request.text.length;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    const outputFormat = request.outputFormat || DEFAULT_OUTPUT_FORMAT;
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${request.voiceId}?output_format=${outputFormat}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": request.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: request.modelId || DEFAULT_MODEL,
          voice_settings: {
            stability: request.stability ?? DEFAULT_STABILITY,
            similarity_boost: request.similarityBoost ?? DEFAULT_SIMILARITY_BOOST,
          },
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[tts-elevenlabs] ElevenLabs API error:", response.status, errorText);

      await logRuntime({
        organizationId,
        module: "tts",
        action: "generate_audio",
        status: "error",
        errorMessage: `ElevenLabs ${response.status}: ${errorText.slice(0, 200)}`,
        payloadSnapshot: { charCount, durationMs: Date.now() - startTime, fallbackToText: true },
      });

      return { success: false, error: `ElevenLabs API error: ${response.status}`, charCount };
    }

    // Read audio blob
    const audioBlob = await response.blob();
    const fileSizeBytes = audioBlob.size;

    // Upload to Supabase Storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // `autoRefreshToken: false`: senão o auth-js arma um `setInterval` de 30 s
    // por cliente e ninguém o desarma. Ver `_shared/supabase-admin.ts`.
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const uuid = crypto.randomUUID();
    const storagePath = `tts-audio/${organizationId}/${uuid}.mp3`;

    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(storagePath, audioBlob, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("[tts-elevenlabs] Storage upload error:", uploadError);

      await logRuntime({
        organizationId,
        module: "tts",
        action: "generate_audio",
        status: "error",
        errorMessage: `Storage upload: ${uploadError.message}`,
        payloadSnapshot: { charCount, fileSizeBytes, durationMs: Date.now() - startTime, fallbackToText: true },
      });

      return { success: false, error: `Storage upload failed: ${uploadError.message}`, charCount };
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from("media")
      .getPublicUrl(storagePath);

    const durationMs = Date.now() - startTime;

    await logRuntime({
      organizationId,
      module: "tts",
      action: "generate_audio",
      status: "success",
      payloadSnapshot: { charCount, fileSizeBytes, durationMs, fallbackToText: false },
    });

    console.log("[tts-elevenlabs] Audio generated:", {
      durationMs,
      charCount,
      fileSizeBytes,
      storagePath,
    });

    return {
      success: true,
      audioUrl: publicUrlData.publicUrl,
      durationMs,
      charCount,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    const errorMessage = isTimeout
      ? `Timeout after ${TTS_TIMEOUT_MS}ms`
      : error instanceof Error ? error.message : String(error);

    console.error("[tts-elevenlabs] Error:", errorMessage);

    await logRuntime({
      organizationId,
      module: "tts",
      action: "generate_audio",
      status: "error",
      errorMessage,
      payloadSnapshot: { charCount, durationMs, fallbackToText: true, isTimeout },
    });

    return { success: false, error: errorMessage, charCount };
  }
}
