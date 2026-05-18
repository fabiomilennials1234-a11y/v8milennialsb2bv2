/**
 * KnowledgeRetriever — deep module for semantic knowledge retrieval.
 *
 * Consolidates rag.ts + search-knowledge.ts into single interface.
 * Mode-based thresholds eliminate duplicated embedding/RPC logic.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding } from "../embeddings.ts";

type RetrievalMode = "initial" | "tool";

const THRESHOLDS = {
  initial: { docThreshold: 0.6, docLimit: 6, faqThreshold: 0.65, faqLimit: 4 },
  tool: { docThreshold: 0.45, docLimit: 8, faqThreshold: 0.5, faqLimit: 4 },
} as const;

const MEMORY_CONFIG = { threshold: 0.7, limit: 5 } as const;

export class KnowledgeRetriever {
  constructor(private supabase: SupabaseClient) {}

  async retrieve(query: string, agentId: string, mode: RetrievalMode): Promise<string> {
    try {
      const embedding = await this.getEmbedding(query);
      if (!embedding) return mode === "tool" ? `Nenhuma informacao encontrada na base de conhecimento para: "${query}"` : "";

      const embeddingStr = `[${embedding.join(",")}]`;
      const config = THRESHOLDS[mode];
      const parts: string[] = [];

      const [chunksResult, faqsResult] = await Promise.all([
        (this.supabase as any).rpc("match_document_chunks", {
          query_embedding: embeddingStr,
          agent_id_filter: agentId,
          match_count: config.docLimit,
          similarity_threshold: config.docThreshold,
        }),
        (this.supabase as any).rpc("match_faqs", {
          query_embedding: embeddingStr,
          agent_id_filter: agentId,
          match_count: config.faqLimit,
          similarity_threshold: config.faqThreshold,
        }),
      ]);

      if (!chunksResult.error && chunksResult.data?.length > 0) {
        if (mode === "tool") parts.push("=== INFORMACOES ENCONTRADAS ===\n");
        const chunkTexts = (chunksResult.data as Array<{ content: string; similarity: number }>)
          .map((c) => c.content);
        parts.push(...chunkTexts);
        if (mode === "tool") parts.push("");
      }

      if (!faqsResult.error && faqsResult.data?.length > 0) {
        if (mode === "tool") parts.push("=== PERGUNTAS FREQUENTES ===\n");
        const faqTexts = (faqsResult.data as Array<{ question: string; answer: string; similarity: number }>)
          .map((f) => `P: ${f.question}\nR: ${f.answer}`);
        parts.push(...faqTexts);
      }

      if (mode === "tool") {
        const { data: docs } = await this.supabase
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
      }

      if (parts.length === 0) {
        return mode === "tool"
          ? `Nenhuma informacao encontrada na base de conhecimento para: "${query}"`
          : "";
      }

      return mode === "initial"
        ? "\n\n---\n" + parts.join("\n\n") + "\n---\n"
        : parts.join("\n");
    } catch (e) {
      console.warn("[KnowledgeRetriever] retrieve failed (non-fatal):", e);
      return mode === "tool" ? "Erro ao consultar a base de conhecimento." : "";
    }
  }

  async retrieveMemories(query: string, leadId: string): Promise<string> {
    try {
      const embedding = await this.getEmbedding(query);
      if (!embedding) return "";

      const embeddingStr = `[${embedding.join(",")}]`;

      const { data: memories, error } = await (this.supabase as any).rpc("match_lead_memories", {
        query_embedding: embeddingStr,
        lead_id_filter: leadId,
        match_count: MEMORY_CONFIG.limit,
        similarity_threshold: MEMORY_CONFIG.threshold,
      });

      if (error || !memories || memories.length === 0) return "";

      const lines = (memories as Array<{ memory_type: string; content: string; importance: number }>)
        .sort((a, b) => b.importance - a.importance)
        .map((m) => `[${m.memory_type.toUpperCase()}] ${m.content}`);

      return lines.join("\n");
    } catch (e) {
      console.warn("[KnowledgeRetriever] retrieveMemories failed (non-fatal):", e);
      return "";
    }
  }

  private async getEmbedding(text: string): Promise<number[] | null> {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return null;

    const embedding = await generateEmbedding(text, apiKey);
    if (!embedding || embedding.length === 0) return null;
    return embedding;
  }
}
