/**
 * Trilha 3.B Fase B1 / T3B.7b — RAG (skeleton)
 *
 * Status: SKELETON — embeddings + pgvector queries.
 *
 * Funções alvo:
 *   - generateEmbedding (já em _shared/embeddings.ts — re-export)
 *   - queryFaqsBySimilarity (~ linha 837) — RPC search_copilot_faqs
 *   - queryDocsBySimilarity (~ linha 821) — RPC search_copilot_documents
 *
 * Estimativa: 3h.
 */

export { generateEmbedding, generateEmbeddingsBatch } from "../embeddings.ts";

export const EMBEDDING_DIMENSIONS = 1536; // gemini-embedding-2-preview

// TODO: extrair queries pgvector de agent-engine.ts
