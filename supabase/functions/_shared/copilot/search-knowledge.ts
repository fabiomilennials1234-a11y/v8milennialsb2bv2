/**
 * Trilha 3.B Fase B1 / T3B.7a — Search Knowledge (skeleton)
 *
 * Status: SKELETON — execução SEARCH_KNOWLEDGE inline (multi-turn LLM).
 *
 * Funções alvo:
 *   - executeSearchKnowledge (linha 799) — busca semântica em FAQs + docs
 *   - Loop multi-turn (linhas 168-221) — já tem MAX_TOOL_TURNS=3 (Onda 1 fix)
 *
 * Estimativa: 3h.
 */

export const MAX_SEARCH_KNOWLEDGE_ITERATIONS = 3;
export const FAQ_SIMILARITY_THRESHOLD = 0.65;
export const DOC_SIMILARITY_THRESHOLD = 0.6;
export const FAQ_RESULT_LIMIT = 3;
export const DOC_RESULT_LIMIT = 5;

// ─── executeSearchKnowledge (extracted from agent-engine.ts:727) ─────────────

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding } from "../embeddings.ts";

/**
 * Busca conhecimento (chunks + FAQs + documentos) por similaridade pgvector.
 * Retorna string formatada pra injeção no prompt LLM (multi-turn search).
 *
 * Comportamento:
 *   1. Gera embedding da query via Gemini
 *   2. Busca chunks via match_document_chunks RPC (limit 8, threshold 0.45)
 *   3. Busca FAQs via match_faqs RPC (limit 4, threshold 0.5)
 *   4. Lista docs disponíveis (status=ready) pra send_document
 *   5. Concatena tudo em string formatada
 *
 * Retorna mensagem de erro se Gemini key ausente, embedding falha, ou exceção.
 */
export async function executeSearchKnowledge(
  supabase: SupabaseClient,
  query: string,
  agentId: string,
): Promise<string> {
  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return "Erro: API key nao configurada.";

    const queryEmbedding = await generateEmbedding(query, apiKey);
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return "Nao foi possivel processar a busca.";
    }

    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const parts: string[] = [];

    const { data: chunks } = await (supabase as any).rpc("match_document_chunks", {
      query_embedding: embeddingStr,
      agent_id_filter: agentId,
      match_count: 5,
      similarity_threshold: 0.55,
    });

    if (chunks && chunks.length > 0) {
      parts.push("=== INFORMACOES ENCONTRADAS ===\n");
      for (const chunk of chunks as Array<{ content: string; similarity: number }>) {
        parts.push(chunk.content);
        parts.push("");
      }
    }

    const { data: faqs } = await (supabase as any).rpc("match_faqs", {
      query_embedding: embeddingStr,
      agent_id_filter: agentId,
      match_count: 4,
      similarity_threshold: 0.5,
    });

    if (faqs && faqs.length > 0) {
      parts.push("=== PERGUNTAS FREQUENTES ===\n");
      for (const faq of faqs as Array<{ question: string; answer: string }>) {
        parts.push(`P: ${faq.question}\nR: ${faq.answer}\n`);
      }
    }

    const { data: docs } = await supabase
      .from("copilot_agent_documents")
      .select("id, file_name")
      .eq("agent_id", agentId)
      .eq("status", "ready");

    if (docs && docs.length > 0) {
      parts.push("=== DOCUMENTOS DISPONIVEIS PARA ENVIO ===");
      for (const doc of docs as Array<{ id: string; file_name: string }>) {
        parts.push(`- "${doc.file_name.trim()}" (id: ${doc.id}) — use send_document para enviar ao lead`);
      }
    }

    if (parts.length === 0) {
      return `Nenhuma informacao encontrada na base de conhecimento para: "${query}"`;
    }

    return parts.join("\n");
  } catch (e) {
    console.error("[search-knowledge] error:", e);
    return "Erro ao consultar a base de conhecimento.";
  }
}
