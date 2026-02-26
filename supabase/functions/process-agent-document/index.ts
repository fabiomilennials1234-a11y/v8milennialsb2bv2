import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbeddingsBatch, chunkText } from "../_shared/embeddings.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessDocumentRequest {
  documentId: string;
}

serve(async (req) => {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: ProcessDocumentRequest = await req.json();
    const { documentId } = body;

    if (!documentId) {
      return new Response(
        JSON.stringify({ error: "documentId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Buscar o documento no banco
    const { data: doc, error: docError } = await supabase
      .from("copilot_agent_documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError || !doc) {
      return new Response(
        JSON.stringify({ error: "Document not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Marcar como processing
    await supabase
      .from("copilot_agent_documents")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", documentId);

    // 3. Baixar o arquivo do storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("agent-documents")
      .download(doc.file_path);

    if (downloadError || !fileData) {
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "Failed to download file from storage", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Failed to download file" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Extrair texto do documento
    let textContent = "";

    if (doc.mime_type === "application/pdf") {
      // Para PDFs, enviar como base64 para o LLM processar
      const arrayBuffer = await fileData.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      textContent = `[PDF Document: ${doc.file_name}]\n\nConteúdo base64 do PDF (o LLM deve extrair o texto):\n${base64.substring(0, 50000)}`;
    } else {
      // Para texto/markdown/csv, ler diretamente
      textContent = await fileData.text();
    }

    if (!textContent || textContent.trim().length < 10) {
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "Document content too short or empty", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Document content too short" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Buscar contexto do agente para o resumo ser relevante
    const { data: agent } = await supabase
      .from("copilot_agents")
      .select("name, template_type, business_context")
      .eq("id", doc.agent_id)
      .single();

    const businessContext = (agent?.business_context || {}) as Record<string, string>;
    const companyName = businessContext.companyName || "a empresa";

    // 6. Chamar LLM para gerar resumo
    const systemPrompt = `Você é um especialista em extração e sumarização de documentos corporativos.

Sua tarefa é gerar um RESUMO CONCISO e ÚTIL do documento fornecido, focando em informações que um agente de vendas B2B precisa saber.

Contexto:
- Empresa: ${companyName}
- Tipo de agente: ${agent?.template_type || "vendas B2B"}

REGRAS:
- Máximo 2000 caracteres no resumo
- Foque em: produtos/serviços, preços, condições, diferenciais, processos, políticas
- Ignore headers, footers, números de página e formatação
- Use bullet points para organizar as informações
- Comece com uma frase resumo do que é o documento
- Se o documento for um PDF em base64, extraia o máximo de texto legível possível
- Responda APENAS com o resumo, sem explicações adicionais`;

    // Truncar conteúdo para não estourar tokens
    const truncatedContent = textContent.substring(0, 30000);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Document Summary",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Gere o resumo deste documento:\n\n---\n${truncatedContent}\n---` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("OpenRouter error:", error);
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "LLM failed to generate summary", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Failed to generate summary" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const summary = result.choices?.[0]?.message?.content || "";

    if (!summary || summary.trim().length < 10) {
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "Generated summary too short", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Generated summary too short" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Salvar resumo e marcar como ready
    await supabase
      .from("copilot_agent_documents")
      .update({
        summary: summary.trim(),
        status: "ready",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    // 8. Item #5 RAG: gerar chunks + embeddings do conteúdo original
    //    (fire-and-forget: não bloqueia o retorno ao usuário)
    generateAndStoreChunkEmbeddings(
      supabase,
      OPENROUTER_API_KEY,
      documentId,
      doc.agent_id,
      doc.organization_id,
      textContent.substring(0, 60000) // max 60k chars para chunking
    ).catch(e => console.warn("[process-agent-document] Chunk embeddings failed (non-fatal):", e));

    return new Response(
      JSON.stringify({ success: true, summary: summary.trim() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * Item #5 RAG: Divide o conteúdo em chunks, gera embeddings e salva na tabela
 * copilot_agent_document_chunks. Chamada em background (fire-and-forget).
 */
async function generateAndStoreChunkEmbeddings(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  documentId: string,
  agentId: string,
  organizationId: string,
  textContent: string
): Promise<void> {
  // Limpar chunks antigos do documento (re-processamento)
  await supabase
    .from("copilot_agent_document_chunks")
    .delete()
    .eq("document_id", documentId);

  const chunks = chunkText(textContent);
  if (chunks.length === 0) return;

  console.log(`[RAG] Gerando embeddings para ${chunks.length} chunks do documento ${documentId}`);

  // Gerar embeddings em batch
  const embeddings = await generateEmbeddingsBatch(chunks, apiKey);

  // Montar linhas para inserção
  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    agent_id: agentId,
    organization_id: organizationId,
    chunk_index: i,
    content,
    embedding: `[${embeddings[i].join(",")}]`,
  }));

  // Inserir em batches de 50
  const INSERT_BATCH = 50;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase
      .from("copilot_agent_document_chunks")
      .insert(batch);
    if (error) {
      console.error(`[RAG] Erro ao inserir chunks ${i}-${i + INSERT_BATCH}:`, error.message);
    }
  }

  console.log(`[RAG] ${rows.length} chunks indexados para documento ${documentId}`);
}
