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

export const EMBEDDING_DIMENSIONS = 1536; // gemini-embedding-2

// ─── retrieveSemanticContext (extracted from agent-engine.ts:736) ────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Recupera contexto semântico (chunks docs + FAQs) via pgvector.
 * Retorna string formatada pra injeção no prompt LLM.
 */
export async function retrieveSemanticContext(
  supabase: SupabaseClient,
  userMessage: string,
  agentId: string,
): Promise<string> {
  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return "";

    const queryEmbedding = await generateEmbedding(userMessage, apiKey);
    if (!queryEmbedding || queryEmbedding.length === 0) return "";

    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const parts: string[] = [];

    const { data: chunks, error: chunksErr } = await (supabase as any).rpc("match_document_chunks", {
      query_embedding: embeddingStr,
      agent_id_filter: agentId,
      match_count: 6,
      similarity_threshold: 0.6,
    });

    if (!chunksErr && chunks && chunks.length > 0) {
      const chunkTexts = (chunks as Array<{ content: string; similarity: number }>)
        .map((c) => c.content)
        .join("\n\n");
      parts.push(chunkTexts);
    }

    const { data: faqs, error: faqsErr } = await (supabase as any).rpc("match_faqs", {
      query_embedding: embeddingStr,
      agent_id_filter: agentId,
      match_count: 4,
      similarity_threshold: 0.65,
    });

    if (!faqsErr && faqs && faqs.length > 0) {
      const faqTexts = (faqs as Array<{ question: string; answer: string; similarity: number }>)
        .map((f) => `P: ${f.question}\nR: ${f.answer}`)
        .join("\n\n");
      parts.push(faqTexts);
    }

    if (parts.length === 0) return "";
    return "\n\n---\n" + parts.join("\n\n") + "\n---\n";
  } catch (e) {
    console.warn("[rag] retrieveSemanticContext failed (non-fatal):", e);
    return "";
  }
}

/**
 * Recupera memórias longo-prazo do lead via pgvector.
 */
export async function retrieveLongTermMemories(
  supabase: SupabaseClient,
  userMessage: string,
  leadId: string,
): Promise<string> {
  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return "";

    const queryEmbedding = await generateEmbedding(userMessage, apiKey);
    if (!queryEmbedding || queryEmbedding.length === 0) return "";

    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const { data: memories, error } = await (supabase as any).rpc("match_lead_memories", {
      query_embedding: embeddingStr,
      lead_id_filter: leadId,
      match_count: 5,
      similarity_threshold: 0.7,
    });

    if (error || !memories || memories.length === 0) return "";

    const lines = (memories as Array<{ memory_type: string; content: string; importance: number }>)
      .sort((a, b) => b.importance - a.importance)
      .map((m) => `[${m.memory_type.toUpperCase()}] ${m.content}`);

    return lines.join("\n");
  } catch (e) {
    console.warn("[rag] retrieveLongTermMemories failed (non-fatal):", e);
    return "";
  }
}
