/**
 * Edge Function: reembed-all
 *
 * Re-gera todos os embeddings do sistema usando Gemini Embedding 2.
 * Usado na migração de OpenAI → Gemini.
 *
 * Processa em batch:
 *   1. copilot_agent_document_chunks (conteúdo de documentos)
 *   2. copilot_agent_faqs (perguntas frequentes)
 *   3. lead_memories (memórias de longo prazo dos leads)
 *
 * POST /reembed-all
 * Headers: Authorization: Bearer <service_role_key>
 * Body (opcional): { "target": "all" | "chunks" | "faqs" | "memories", "batch_size": 50 }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbeddingsBatch } from "../_shared/embeddings.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";

const BATCH_SIZE_DEFAULT = 50;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let target = "all";
  let batchSize = BATCH_SIZE_DEFAULT;

  try {
    const body = await req.json().catch(() => ({}));
    target = body.target || "all";
    batchSize = body.batch_size || BATCH_SIZE_DEFAULT;
  } catch { /* use defaults */ }

  const results: Record<string, { total: number; updated: number; errors: number }> = {};

  // ─── 1. Document Chunks ───
  if (target === "all" || target === "chunks") {
    console.log("[reembed] Starting document chunks...");
    const stats = { total: 0, updated: 0, errors: 0 };

    const { data: chunks, error } = await supabase
      .from("copilot_agent_document_chunks")
      .select("id, content")
      .not("content", "is", null)
      .order("id");

    if (error) {
      console.error("[reembed] Error fetching chunks:", error.message);
    } else if (chunks && chunks.length > 0) {
      stats.total = chunks.length;
      console.log(`[reembed] Re-embedding ${chunks.length} chunks in batches of ${batchSize}`);

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map(c => c.content);

        try {
          const embeddings = await generateEmbeddingsBatch(texts, GEMINI_API_KEY);

          for (let j = 0; j < batch.length; j++) {
            const embeddingStr = `[${embeddings[j].join(",")}]`;
            const { error: updateErr } = await supabase
              .from("copilot_agent_document_chunks")
              .update({ embedding: embeddingStr } as any)
              .eq("id", batch[j].id);

            if (updateErr) {
              stats.errors++;
              console.error(`[reembed] Chunk ${batch[j].id} error:`, updateErr.message);
            } else {
              stats.updated++;
            }
          }

          console.log(`[reembed] Chunks: ${Math.min(i + batchSize, chunks.length)}/${chunks.length}`);
        } catch (e) {
          stats.errors += batch.length;
          console.error(`[reembed] Chunk batch error:`, e);
        }
      }
    }
    results.chunks = stats;
  }

  // ─── 2. FAQs ───
  if (target === "all" || target === "faqs") {
    console.log("[reembed] Starting FAQs...");
    const stats = { total: 0, updated: 0, errors: 0 };

    const { data: faqs, error } = await supabase
      .from("copilot_agent_faqs")
      .select("id, question, answer")
      .order("id");

    if (error) {
      console.error("[reembed] Error fetching FAQs:", error.message);
    } else if (faqs && faqs.length > 0) {
      stats.total = faqs.length;
      console.log(`[reembed] Re-embedding ${faqs.length} FAQs`);

      const texts = faqs.map(f => `Pergunta: ${f.question}\nResposta: ${f.answer}`);

      for (let i = 0; i < faqs.length; i += batchSize) {
        const batchTexts = texts.slice(i, i + batchSize);
        const batchFaqs = faqs.slice(i, i + batchSize);

        try {
          const embeddings = await generateEmbeddingsBatch(batchTexts, GEMINI_API_KEY);

          for (let j = 0; j < batchFaqs.length; j++) {
            const embeddingStr = `[${embeddings[j].join(",")}]`;
            const { error: updateErr } = await supabase
              .from("copilot_agent_faqs")
              .update({ embedding: embeddingStr } as any)
              .eq("id", batchFaqs[j].id);

            if (updateErr) {
              stats.errors++;
            } else {
              stats.updated++;
            }
          }

          console.log(`[reembed] FAQs: ${Math.min(i + batchSize, faqs.length)}/${faqs.length}`);
        } catch (e) {
          stats.errors += batchFaqs.length;
          console.error(`[reembed] FAQ batch error:`, e);
        }
      }
    }
    results.faqs = stats;
  }

  // ─── 3. Lead Memories ───
  if (target === "all" || target === "memories") {
    console.log("[reembed] Starting lead memories...");
    const stats = { total: 0, updated: 0, errors: 0 };

    const { data: memories, error } = await supabase
      .from("lead_memories")
      .select("id, content")
      .not("content", "is", null)
      .order("id");

    if (error) {
      console.error("[reembed] Error fetching memories:", error.message);
    } else if (memories && memories.length > 0) {
      stats.total = memories.length;
      console.log(`[reembed] Re-embedding ${memories.length} lead memories`);

      for (let i = 0; i < memories.length; i += batchSize) {
        const batch = memories.slice(i, i + batchSize);
        const texts = batch.map(m => m.content);

        try {
          const embeddings = await generateEmbeddingsBatch(texts, GEMINI_API_KEY);

          for (let j = 0; j < batch.length; j++) {
            const embeddingStr = `[${embeddings[j].join(",")}]`;
            const { error: updateErr } = await supabase
              .from("lead_memories")
              .update({ embedding: embeddingStr } as any)
              .eq("id", batch[j].id);

            if (updateErr) {
              stats.errors++;
            } else {
              stats.updated++;
            }
          }

          console.log(`[reembed] Memories: ${Math.min(i + batchSize, memories.length)}/${memories.length}`);
        } catch (e) {
          stats.errors += batch.length;
          console.error(`[reembed] Memory batch error:`, e);
        }
      }
    }
    results.memories = stats;
  }

  console.log("[reembed] Complete:", JSON.stringify(results));

  return new Response(
    JSON.stringify({ success: true, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
