/**
 * audio-transcription — Media understanding for Copilot.
 *
 * Lead manda áudio/imagem/documento → transformamos em TEXTO que o LLM entende.
 *
 * Primary: OpenRouter (google/gemini-2.5-flash) com content-part CORRETO por
 * tipo de mídia — `input_audio` para áudio, `image_url` para imagem, `file`
 * (file-parser) para PDF. Billing centralizado.
 *
 * Bug histórico (corrigido 2026-06-22): áudio era enviado como `image_url`
 * data-URI, formato que o OpenRouter NÃO aceita para áudio → 99% dos áudios
 * caíam no placeholder e a IA ficava muda. OpenRouter exige `input_audio`
 * com base64 cru + `format` (ver docs OpenRouter Audio Inputs).
 *
 * Fallback: Gemini direto (generativelanguage) via `inline_data` — comprovado
 * transcrevendo ogg/mp3 do WhatsApp e descrevendo imagens nativamente. Cobre
 * o caso de o OpenRouter falhar ou não suportar o formato.
 *
 * Resiliência: retry em erros transitórios (429 rate-limit, 503 overload).
 * Nunca lança — retorna texto processado ou um placeholder de fallback.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MEDIA_MODEL = "google/gemini-2.5-flash";

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MEDIA_MODEL = "gemini-2.5-flash";

const MEDIA_FETCH_TIMEOUT_MS = 20_000;
const LLM_TIMEOUT_MS = 30_000;
const RETRY_STATUSES = new Set([429, 503]);
const MAX_LLM_ATTEMPTS = 3;

type MediaKind = "audio" | "image" | "video" | "document";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** OpenRouter `input_audio.format` aceita: mp3, wav, ogg, aac, m4a, flac, ... */
function openRouterAudioFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("webm")) return "ogg"; // closest; Gemini fallback cobre o resto
  return "mp3";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * POST JSON com retry em erros transitórios (429/503). Retorna o JSON parseado
 * ou null (nunca lança). Loga status/erro pra diagnóstico.
 */
async function postJsonWithRetry(
  url: string,
  init: RequestInit,
  tag: string,
): Promise<any | null> {
  for (let attempt = 1; attempt <= MAX_LLM_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(LLM_TIMEOUT_MS) });
      if (res.ok) return await res.json();

      const retriable = RETRY_STATUSES.has(res.status);
      if (!retriable || attempt === MAX_LLM_ATTEMPTS) {
        const body = await res.text().catch(() => "");
        console.error(`[media-understanding] ${tag} HTTP ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }
      console.warn(`[media-understanding] ${tag} transient ${res.status} (attempt ${attempt})`);
    } catch (err) {
      if (attempt === MAX_LLM_ATTEMPTS) {
        console.error(`[media-understanding] ${tag} failed: ${(err as Error).message}`);
        return null;
      }
    }
    await sleep(600 * attempt);
  }
  return null;
}

/**
 * Chamada primária via OpenRouter. Monta o content-part correto por tipo.
 * Retorna texto ou null (null → caller tenta Gemini direto).
 */
async function callOpenRouterWithMedia(
  base64Data: string,
  mimeType: string,
  prompt: string,
  kind: MediaKind,
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    console.error("[media-understanding] OPENROUTER_API_KEY not set");
    return null;
  }

  const dataUri = `data:${mimeType};base64,${base64Data}`;
  let mediaPart: Record<string, unknown>;
  const requestBody: Record<string, unknown> = {
    model: OPENROUTER_MEDIA_MODEL,
    temperature: 0,
    max_tokens: 2048,
  };

  if (kind === "document") {
    // PDF/doc → file-parser (pdf-text engine grátis, extrai texto selecionável)
    mediaPart = { type: "file", file: { filename: "document.pdf", file_data: dataUri } };
    requestBody.plugins = [{ id: "file-parser", pdf: { engine: "pdf-text" } }];
  } else if (kind === "audio") {
    // CORREÇÃO: áudio exige `input_audio` com base64 CRU + format. NÃO image_url.
    mediaPart = { type: "input_audio", input_audio: { data: base64Data, format: openRouterAudioFormat(mimeType) } };
  } else {
    // imagem (e vídeo best-effort) via image_url data-URI — Gemini aceita nesse slot.
    mediaPart = { type: "image_url", image_url: { url: dataUri } };
  }

  requestBody.messages = [{ role: "user", content: [mediaPart, { type: "text", text: prompt }] }];

  const data = await postJsonWithRetry(
    OPENROUTER_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://torquecrm.com.br",
        "X-Title": "Torque CRM Media Understanding",
      },
      body: JSON.stringify(requestBody),
    },
    `openrouter:${kind}`,
  );

  return data?.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Fallback via Gemini direto (inline_data). Suporta áudio/imagem/vídeo/pdf
 * nativamente. Usa GEMINI_API_KEY (mesma das embeddings/analyze-copilot-prompt).
 */
async function callGeminiWithMedia(
  base64Data: string,
  mimeType: string,
  prompt: string,
  kind: MediaKind,
): Promise<string | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const data = await postJsonWithRetry(
    `${GEMINI_API_URL}/models/${GEMINI_MEDIA_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    },
    `gemini:${kind}`,
  );

  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p: any) => p?.text ?? "").join("").trim();
  return text || null;
}

/**
 * Entende a mídia: OpenRouter primeiro, Gemini direto como fallback.
 */
async function understandMedia(
  base64Data: string,
  mimeType: string,
  prompt: string,
  kind: MediaKind,
): Promise<string | null> {
  const viaOpenRouter = await callOpenRouterWithMedia(base64Data, mimeType, prompt, kind);
  if (viaOpenRouter) return viaOpenRouter;

  const viaGemini = await callGeminiWithMedia(base64Data, mimeType, prompt, kind);
  if (viaGemini) {
    console.log(`[media-understanding] OpenRouter empty/failed for ${kind} → Gemini fallback OK`);
  }
  return viaGemini;
}

export async function transcribeAudio(
  audioBytes: Uint8Array,
  mimeType: string,
): Promise<string | null> {
  return understandMedia(
    toBase64(audioBytes),
    mimeType,
    "Transcreva este áudio em português. Retorne APENAS o texto falado, sem formatação, sem aspas, sem explicações.",
    "audio",
  );
}

/** Baixa bytes de uma URL (com timeout). Retorna {bytes, contentType} ou null. */
async function fetchMediaBytes(
  mediaUrl: string,
  mimeHint?: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[media-understanding] download failed HTTP ${res.status} for ${mediaUrl.slice(0, 80)}`);
      return null;
    }
    const contentType = mimeHint || res.headers.get("content-type") || "application/octet-stream";
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0) {
      console.error("[media-understanding] empty file");
      return null;
    }
    return { bytes, contentType };
  } catch (err) {
    console.error(`[media-understanding] download threw: ${(err as Error).message}`);
    return null;
  }
}

export async function downloadAndTranscribeAudio(
  mediaUrl: string,
  mimeType?: string,
): Promise<string | null> {
  const media = await fetchMediaBytes(mediaUrl, mimeType);
  if (!media) return null;
  return transcribeAudio(media.bytes, media.contentType);
}

const MEDIA_PROMPTS: Record<MediaKind, string> = {
  audio: "Transcreva este áudio em português. Retorne APENAS o texto falado, sem formatação, sem aspas, sem explicações.",
  image: "Descreva esta imagem em português de forma concisa. O que aparece nela? Se houver texto visível, inclua-o.",
  video: "Descreva este vídeo em português de forma concisa. O que acontece nele?",
  document: "Extraia em português o conteúdo relevante deste documento: dados cadastrais (CNPJ, razão social, endereço), valores, datas, itens e qualquer informação útil. Seja completo e fiel ao documento. Retorne apenas o conteúdo, sem comentários.",
};

const MEDIA_LABELS: Record<MediaKind, string> = {
  audio: "Áudio transcrito",
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

/** Mapeia o message_type do webhook (ptt/audio/image/...) para MediaKind. */
function messageTypeToKind(messageType: string): MediaKind | null {
  const t = messageType.toLowerCase();
  if (t === "audio" || t === "ptt") return "audio";
  if (t === "image") return "image";
  if (t === "video") return "video";
  if (t === "document") return "document";
  return null;
}

function fallbackFor(messageType: string): string {
  return MEDIA_FALLBACKS[messageType.toLowerCase()] || `[O lead enviou ${messageType}]`;
}

/**
 * Resolve o conteúdo de uma mensagem que pode conter mídia, transformando-a
 * em texto que o LLM entende. Baixa a mídia, entende via OpenRouter/Gemini e
 * formata. Em qualquer falha, devolve um placeholder (nunca lança).
 *
 * Caller deve passar uma `mediaUrl` FETCHÁVEL (URL persistida no Storage). URLs
 * cruas do WhatsApp (.enc) expiram/exigem token e falham — quem chama deve
 * resolver para a cópia do Storage antes (ver downloadAndPersistMedia).
 */
export async function resolveMediaContent(opts: {
  content: string | null;
  messageType: string;
  mediaUrl: string | null;
}): Promise<string> {
  const { content, messageType, mediaUrl } = opts;
  const kind = messageTypeToKind(messageType);

  // Texto puro (ou tipo não-mídia): devolve o conteúdo como está.
  if (!kind) return content && content.trim().length > 0 ? content : fallbackFor(messageType);

  // Sem URL: nada a entender → placeholder (mantém legenda do lead se houver).
  if (!mediaUrl) {
    return content && content.trim().length > 0 ? content : fallbackFor(messageType);
  }

  const media = await fetchMediaBytes(mediaUrl);
  if (!media) {
    return content && content.trim().length > 0 ? content : fallbackFor(messageType);
  }

  const understood = await understandMedia(
    toBase64(media.bytes),
    media.contentType,
    MEDIA_PROMPTS[kind],
    kind,
  );

  if (!understood) {
    return content && content.trim().length > 0 ? content : fallbackFor(messageType);
  }

  const label = MEDIA_LABELS[kind];
  // Lead pode mandar mídia COM legenda (content) — preserva ambos.
  if (content && content.trim().length > 0) {
    return `${content}\n[${label}]: ${understood}`;
  }
  return `[${label}]: ${understood}`;
}
