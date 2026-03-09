/**
 * Natural Messaging — Smart message splitting for WhatsApp
 *
 * Breaks long agent responses into multiple short messages
 * with realistic typing delays, simulating a real person.
 *
 * Two strategies:
 * 1. Heuristic split (fast, no cost) — paragraphs/sentences
 * 2. LLM split (fallback) — when message is too long/complex
 */

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const LLM_SPLIT_MODEL = "google/gemini-2.0-flash-001";

// =====================================================
// INTENSITY PRESETS
// =====================================================

export type NaturalMessagingIntensity = "suave" | "natural" | "conversacional";

export interface NaturalMessagingConfig {
  enabled: boolean;
  intensity: NaturalMessagingIntensity;
}

interface IntensityParams {
  maxCharsPerChunk: number;
  delayBaseMs: number;      // ms per character
  delayCapMs: number;       // max delay per chunk
  llmThresholdChars: number;
  llmThresholdParagraphs: number;
  minChunkChars: number;    // avoid tiny messages
}

const INTENSITY_PRESETS: Record<NaturalMessagingIntensity, IntensityParams> = {
  suave: {
    maxCharsPerChunk: 450,
    delayBaseMs: 30,
    delayCapMs: 5000,
    llmThresholdChars: 800,
    llmThresholdParagraphs: 5,
    minChunkChars: 40,
  },
  natural: {
    maxCharsPerChunk: 250,
    delayBaseMs: 50,
    delayCapMs: 8000,
    llmThresholdChars: 500,
    llmThresholdParagraphs: 3,
    minChunkChars: 30,
  },
  conversacional: {
    maxCharsPerChunk: 150,
    delayBaseMs: 70,
    delayCapMs: 10000,
    llmThresholdChars: 300,
    llmThresholdParagraphs: 2,
    minChunkChars: 20,
  },
};

// =====================================================
// MAIN FUNCTION
// =====================================================

export interface SplitResult {
  chunks: string[];
  delays: number[]; // delay in ms BEFORE each chunk (first = 0)
}

/**
 * Smart split: decides between heuristic and LLM-based splitting
 */
export async function smartSplitMessage(
  message: string,
  config: NaturalMessagingConfig
): Promise<SplitResult> {
  if (!config.enabled) {
    return { chunks: [message], delays: [0] };
  }

  const params = INTENSITY_PRESETS[config.intensity] || INTENSITY_PRESETS.natural;
  const paragraphs = message.split(/\n\n+/).filter((p) => p.trim());
  const needsLlmSplit =
    message.length >= params.llmThresholdChars ||
    paragraphs.length >= params.llmThresholdParagraphs;

  let chunks: string[];

  if (needsLlmSplit) {
    console.log("[NaturalMessaging] Using LLM split — chars:", message.length, "paragraphs:", paragraphs.length);
    chunks = await llmSplit(message, params);
  } else {
    console.log("[NaturalMessaging] Using heuristic split — chars:", message.length);
    chunks = heuristicSplit(message, params);
  }

  // If splitting produced only 1 chunk, just return as-is
  if (chunks.length <= 1) {
    return { chunks: [message.trim()], delays: [0] };
  }

  // Calculate delays
  const delays = chunks.map((chunk, i) => {
    if (i === 0) return 0;
    const prevChunk = chunks[i - 1];
    return Math.min(prevChunk.length * params.delayBaseMs, params.delayCapMs);
  });

  console.log("[NaturalMessaging] Split into", chunks.length, "chunks, delays:", delays);
  return { chunks, delays };
}

// =====================================================
// HEURISTIC SPLIT
// =====================================================

function heuristicSplit(message: string, params: IntensityParams): string[] {
  const { maxCharsPerChunk, minChunkChars } = params;

  // If short enough, no split needed
  if (message.length <= maxCharsPerChunk) {
    return [message.trim()];
  }

  const paragraphs = message.split(/\n\n+/).filter((p) => p.trim());
  const rawChunks: string[] = [];

  let currentChunk = "";

  for (const paragraph of paragraphs) {
    // Paragraph fits in current chunk
    if (currentChunk.length + paragraph.length + 2 <= maxCharsPerChunk) {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
    // Paragraph too large — split by sentences
    else if (paragraph.length > maxCharsPerChunk) {
      if (currentChunk.trim()) {
        rawChunks.push(currentChunk.trim());
        currentChunk = "";
      }
      const sentenceChunks = splitBySentences(paragraph, maxCharsPerChunk);
      rawChunks.push(...sentenceChunks.slice(0, -1));
      currentChunk = sentenceChunks[sentenceChunks.length - 1] || "";
    }
    // Start new chunk
    else {
      if (currentChunk.trim()) {
        rawChunks.push(currentChunk.trim());
      }
      currentChunk = paragraph;
    }
  }

  if (currentChunk.trim()) {
    rawChunks.push(currentChunk.trim());
  }

  // Merge tiny chunks with neighbors
  return mergeTinyChunks(rawChunks, minChunkChars, maxCharsPerChunk);
}

function splitBySentences(text: string, maxLength: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 <= maxLength) {
      current += (current ? " " : "") + sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      // If single sentence exceeds max, just push it (don't break mid-sentence)
      current = sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function mergeTinyChunks(
  chunks: string[],
  minChars: number,
  maxChars: number
): string[] {
  if (chunks.length <= 1) return chunks;

  const result: string[] = [];
  let buffer = "";

  for (const chunk of chunks) {
    if (buffer && buffer.length + chunk.length + 2 <= maxChars && buffer.length < minChars) {
      buffer += "\n\n" + chunk;
    } else {
      if (buffer) result.push(buffer);
      buffer = chunk;
    }
  }

  if (buffer) result.push(buffer);

  // Check if last chunk is tiny — merge with previous
  if (result.length > 1) {
    const last = result[result.length - 1];
    if (last.length < minChars) {
      const prev = result[result.length - 2];
      if (prev.length + last.length + 2 <= maxChars) {
        result[result.length - 2] = prev + "\n\n" + last;
        result.pop();
      }
    }
  }

  return result;
}

// =====================================================
// LLM SPLIT
// =====================================================

async function llmSplit(
  message: string,
  params: IntensityParams
): Promise<string[]> {
  if (!OPENROUTER_API_KEY) {
    console.warn("[NaturalMessaging] No OPENROUTER_API_KEY, falling back to heuristic");
    return heuristicSplit(message, params);
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_SPLIT_MODEL,
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content: `Você é um assistente que divide mensagens longas em múltiplas mensagens curtas de WhatsApp, como uma pessoa real digitaria.

Regras:
- Máximo ${params.maxCharsPerChunk} caracteres por mensagem
- Mínimo ${params.minChunkChars} caracteres por mensagem
- NÃO altere o conteúdo, apenas divida
- NÃO adicione saudações, emojis ou texto extra
- Mantenha a ordem original
- Retorne APENAS um JSON array de strings, sem markdown, sem explicação

Exemplo de retorno: ["Primeira mensagem aqui", "Segunda mensagem aqui", "Terceira mensagem"]`,
          },
          {
            role: "user",
            content: message,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error("[NaturalMessaging] LLM split failed:", response.status);
      return heuristicSplit(message, params);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content?.trim() || "";

    // Parse JSON array — handle possible markdown wrapping
    const jsonStr = content.replace(/^```json?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);

    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((s: unknown) => typeof s === "string")) {
      const filtered = parsed.map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      if (filtered.length > 0) {
        console.log("[NaturalMessaging] LLM split success:", filtered.length, "chunks");
        return filtered;
      }
    }

    console.warn("[NaturalMessaging] LLM returned invalid format, falling back to heuristic");
    return heuristicSplit(message, params);
  } catch (error) {
    console.error("[NaturalMessaging] LLM split error:", error);
    return heuristicSplit(message, params);
  }
}
