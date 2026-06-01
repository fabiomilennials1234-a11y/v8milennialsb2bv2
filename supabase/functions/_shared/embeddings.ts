/**
 * Shared Embedding Service
 *
 * Gera embeddings via OpenRouter → Google Gemini Embedding 2 (multimodal).
 * Dimensão: 1536 (compatível com pgvector vector(1536))
 * Centralizado no OpenRouter para billing unificado.
 */

const EMBEDDING_MODEL = "google/gemini-embedding-2";
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const EMBEDDING_DIM = 1536;
const CHUNK_OVERLAP = 50;

function getOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "HTTP-Referer": "https://torquecrm.com.br",
    "X-Title": "Torque CRM Embeddings",
  };
}

export async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const response = await fetch(
    `${OPENROUTER_URL}/embeddings`,
    {
      method: "POST",
      headers: getOpenRouterHeaders(apiKey),
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: text.substring(0, 8000),
        dimensions: EMBEDDING_DIM,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter Embedding API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data?.[0]?.embedding as number[];
}

export async function generateMultimodalEmbedding(
  data: Uint8Array,
  mimeType: string,
  apiKey: string
): Promise<number[]> {
  let binary = "";
  const CHUNK = 32768;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  const dataUri = `data:${mimeType};base64,${base64}`;

  const response = await fetch(
    `${OPENROUTER_URL}/embeddings`,
    {
      method: "POST",
      headers: getOpenRouterHeaders(apiKey),
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: dataUri,
        dimensions: EMBEDDING_DIM,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter Multimodal Embedding API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data?.[0]?.embedding as number[];
}

export async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const BATCH_SIZE = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.substring(0, 8000));

    const response = await fetch(
      `${OPENROUTER_URL}/embeddings`,
      {
        method: "POST",
        headers: getOpenRouterHeaders(apiKey),
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batch,
          dimensions: EMBEDDING_DIM,
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter Embedding batch API error ${response.status}: ${err}`);
    }

    const result = await response.json();
    const embeddings = (result.data as Array<{ embedding: number[]; index: number }>)
      .sort((a, b) => a.index - b.index)
      .map(d => d.embedding);
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

export function chunkText(text: string, chunkSize = 1800, overlap = CHUNK_OVERLAP): string[] {
  if (!text || text.trim().length === 0) return [];

  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];
  const paragraphs = cleaned.split(/\n\n+/);
  let currentChunk = "";

  for (const para of paragraphs) {
    const candidate = currentChunk ? currentChunk + "\n\n" + para : para;

    if (candidate.length <= chunkSize) {
      currentChunk = candidate;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + "\n\n" + para;
      } else {
        const sentences = para.split(/(?<=[.!?])\s+/);
        for (const sent of sentences) {
          const sentCandidate = currentChunk ? currentChunk + " " + sent : sent;
          if (sentCandidate.length <= chunkSize) {
            currentChunk = sentCandidate;
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sent;
          }
        }
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(c => c.length > 50);
}

export function formatEmbeddingForPg(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
