/**
 * Edge Function: generate-faq-embeddings
 *
 * Item #6: FAQ retrieval semântico
 * Gera embeddings para FAQs de um agente e salva no banco.
 * Chamada após criar/editar FAQs no wizard.
 *
 * Body: { agentId: string }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbeddingsBatch } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
    if (!OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenRouter API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { agentId } = body;

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "agentId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar FAQs do agente (sem embedding ou desatualizadas)
    const { data: faqs, error: faqError } = await supabase
      .from("copilot_agent_faqs")
      .select("id, question, answer")
      .eq("agent_id", agentId);

    if (faqError || !faqs || faqs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, updated: 0, message: "No FAQs found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[FAQ Embeddings] Gerando embeddings para ${faqs.length} FAQs do agente ${agentId}`);

    // Combinar pergunta + resposta para embedding rico
    const texts = faqs.map(f => `Pergunta: ${f.question}\nResposta: ${f.answer}`);

    const embeddings = await generateEmbeddingsBatch(texts, OPENROUTER_API_KEY);

    // Atualizar cada FAQ com seu embedding
    let updated = 0;
    for (let i = 0; i < faqs.length; i++) {
      const embeddingStr = `[${embeddings[i].join(",")}]`;
      const { error } = await supabase
        .from("copilot_agent_faqs")
        .update({ embedding: embeddingStr } as any)
        .eq("id", faqs[i].id);

      if (!error) updated++;
      else console.warn(`[FAQ Embeddings] Erro ao atualizar FAQ ${faqs[i].id}:`, error.message);
    }

    console.log(`[FAQ Embeddings] ${updated}/${faqs.length} FAQs atualizadas para agente ${agentId}`);

    return new Response(
      JSON.stringify({ success: true, updated, total: faqs.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[FAQ Embeddings] Erro:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
