/**
 * audio-transcription — Media understanding for Copilot via OpenRouter.
 *
 * Handles audio transcription, image description, and other media types.
 * Routes all LLM calls through OpenRouter (google/gemini-2.5-flash)
 * for centralized billing. Returns processed text or fallback (never throws).
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MEDIA_MODEL = "google/gemini-2.5-flash";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function callOpenRouterWithMedia(
  base64Data: string,
  mimeType: string,
  prompt: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    console.error("[media-understanding] OPENROUTER_API_KEY not set");
    return null;
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://torquecrm.com.br",
        "X-Title": "Torque CRM Media Understanding",
      },
      body: JSON.stringify({
        model: MEDIA_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[media-understanding] OpenRouter error:", response.status, errText);
      return null;
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("[media-understanding] Failed:", (err as Error).message);
    return null;
  }
}

export async function transcribeAudio(
  audioBytes: Uint8Array,
  mimeType: string,
): Promise<string | null> {
  const base64Data = toBase64(audioBytes);
  return callOpenRouterWithMedia(
    base64Data,
    mimeType,
    "Transcreva este áudio em português. Retorne APENAS o texto falado, sem formatação, sem aspas, sem explicações.",
  );
}

export async function downloadAndTranscribeAudio(
  mediaUrl: string,
  mimeType?: string,
): Promise<string | null> {
  try {
    const res = await fetch(mediaUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error("[media-understanding] Download failed:", res.status);
      return null;
    }

    const contentType = mimeType || res.headers.get("content-type") || "audio/ogg";
    const bytes = new Uint8Array(await res.arrayBuffer());

    if (bytes.length === 0) {
      console.error("[media-understanding] Empty file");
      return null;
    }

    return transcribeAudio(bytes, contentType);
  } catch (err) {
    console.error("[media-understanding] Download+transcribe failed:", (err as Error).message);
    return null;
  }
}

const MEDIA_PROMPTS: Record<string, string> = {
  audio: "Transcreva este áudio em português. Retorne APENAS o texto falado, sem formatação, sem aspas, sem explicações.",
  ptt: "Transcreva este áudio em português. Retorne APENAS o texto falado, sem formatação, sem aspas, sem explicações.",
  image: "Descreva esta imagem em português de forma concisa. O que aparece nela? Se houver texto visível, inclua-o.",
  video: "Descreva este vídeo em português de forma concisa. O que acontece nele?",
};

const MEDIA_LABELS: Record<string, string> = {
  audio: "Áudio transcrito",
  ptt: "Áudio transcrito",
  image: "Imagem recebida",
  video: "Vídeo recebido",
  document: "documento",
};

const MEDIA_FALLBACKS: Record<string, string> = {
  audio: "[O lead enviou um áudio de voz]",
  ptt: "[O lead enviou um áudio de voz]",
  image: "[O lead enviou uma imagem]",
  video: "[O lead enviou um vídeo]",
  document: "[O lead enviou um documento]",
  sticker: "[O lead enviou um sticker]",
};

async function processMediaViaOpenRouter(
  mediaUrl: string,
  messageType: string,
): Promise<string | null> {
  const prompt = MEDIA_PROMPTS[messageType];
  if (!prompt) return null;

  try {
    const res = await fetch(mediaUrl, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "application/octet-stream";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) return null;

    const base64Data = toBase64(bytes);
    return callOpenRouterWithMedia(base64Data, contentType, prompt);
  } catch {
    return null;
  }
}

export async function resolveMediaContent(opts: {
  content: string | null;
  messageType: string;
  mediaUrl: string | null;
}): Promise<string> {
  const { content, messageType, mediaUrl } = opts;

  if (content && content.trim().length > 0) {
    if (mediaUrl && MEDIA_PROMPTS[messageType]) {
      const description = await processMediaViaOpenRouter(mediaUrl, messageType);
      if (description) {
        const label = MEDIA_LABELS[messageType] || messageType;
        return `${content}\n[${label}]: ${description}`;
      }
    }
    return content;
  }

  if (!mediaUrl) {
    return MEDIA_FALLBACKS[messageType] || `[O lead enviou ${messageType}]`;
  }

  if (MEDIA_PROMPTS[messageType]) {
    const result = await processMediaViaOpenRouter(mediaUrl, messageType);
    if (result) {
      const label = MEDIA_LABELS[messageType] || messageType;
      return `[${label}]: ${result}`;
    }
  }

  return MEDIA_FALLBACKS[messageType] || `[O lead enviou ${messageType}]`;
}
