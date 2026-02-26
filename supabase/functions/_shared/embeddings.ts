/**
 * Shared Embedding Service
 *
 * Gera embeddings via OpenAI text-embedding-3-small usando a chave OpenRouter.
 * OpenRouter roteia /embeddings para OpenAI diretamente.
 * Dimensão: 1536 (compatível com pgvector vector(1536))
 */

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const MAX_TOKENS_PER_CHUNK = 512; // ~2000 chars por chunk
const CHUNK_OVERLAP = 50; // caracteres de sobreposição

/**
 * Gera embedding para um texto usando OpenRouter → OpenAI
 */
export async function generateEmbedding(
  text: string,
  apiKey: string
): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
      "X-Title": "V8 Millennials - Embeddings",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000), // limit input
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  return result.data?.[0]?.embedding as number[];
}

/**
 * Gera embeddings para múltiplos textos em batch (máx 20 por chamada)
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const BATCH_SIZE = 20;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.substring(0, 8000));

    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Embeddings Batch",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Embedding batch API error ${response.status}: ${err}`);
    }

    const result = await response.json();
    const embeddings = result.data?.map((d: any) => d.embedding) as number[][];
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
