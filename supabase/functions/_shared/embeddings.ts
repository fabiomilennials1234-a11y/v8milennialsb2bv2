/**
 * Shared Embedding Service
 *
 * Gera embeddings via Google Gemini Embedding 2 (multimodal).
 * Dimensão: 1536 (compatível com pgvector vector(1536))
 * Suporta: texto, imagens, áudio, vídeo e PDF.
 */

const EMBEDDING_MODEL = "gemini-embedding-2-preview";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_DIM = 1536;
const CHUNK_OVERLAP = 50;

/**
 * Gera embedding para um texto usando Gemini Embedding 2
 */
export async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const response = await fetch(
    `${GEMINI_API_URL}/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: {
          parts: [{ text: text.substring(0, 8000) }],
        },
        outputDimensionality: EMBEDDING_DIM,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Embedding API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.embedding?.values as number[];
}

/**
 * Gera embedding multimodal (imagem, áudio, vídeo, PDF)
 * usando Gemini Embedding 2 nativamente.
 */
export async function generateMultimodalEmbedding(
  data: Uint8Array,
  mimeType: string,
  apiKey: string
): Promise<number[]> {
  // Chunked base64 encoding — btoa(String.fromCharCode(...data)) crashes on files >100KB
  let binary = "";
  const CHUNK = 32768;
  for (let i = 0; i < data.length; i += CHUNK) {
    binary += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);

  const response = await fetch(
    `${GEMINI_API_URL}/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: {
          parts: [{
            inline_data: {
              mime_type: mimeType,
              data: base64,
            },
          }],
        },
        outputDimensionality: EMBEDDING_DIM,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini Multimodal Embedding API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.embedding?.values as number[];
}

/**
 * Gera embeddings para múltiplos textos em batch via batchEmbedContents
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const BATCH_SIZE = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const requests = batch.map(t => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: {
        parts: [{ text: t.substring(0, 8000) }],
      },
      outputDimensionality: EMBEDDING_DIM,
    }));

    const response = await fetch(
      `${GEMINI_API_URL}/models/${EMBEDDING_MODEL}:batchEmbedContents`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({ requests }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini Embedding batch API error ${response.status}: ${err}`);
    }

    const result = await response.json();
    const embeddings = result.embeddings?.map((e: any) => e.values) as number[][];
    allEmbeddings.push(...embeddings);
  }

  return allEmbeddings;
}

/**
 * Divide texto em chunks sobrepostos para RAG
 */
export function chunkText(text: string, chunkSize = 1800, overlap = CHUNK_OVERLAP): string[] {
  if (!text || text.trim().length === 0) return [];

  // Limpar texto
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= chunkSize) return [cleaned];

  const chunks: string[] = [];

  // Dividir por parágrafos primeiro
  const paragraphs = cleaned.split(/\n\n+/);
  let currentChunk = "";

  for (const para of paragraphs) {
    const candidate = currentChunk ? currentChunk + "\n\n" + para : para;

    if (candidate.length <= chunkSize) {
      currentChunk = candidate;
    } else {
      // Salvar chunk atual se tiver conteúdo
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        // Adicionar sobreposição: últimas N chars do chunk anterior
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + "\n\n" + para;
      } else {
        // Parágrafo maior que chunk: dividir por frases
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

/**
 * Formata vetor para inserção no Postgres como string literal
 */
export function formatEmbeddingForPg(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
