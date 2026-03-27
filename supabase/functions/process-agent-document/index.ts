import { withSentry } from '../_shared/sentry.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbeddingsBatch, chunkText } from "../_shared/embeddings.ts";
import { logRuntime } from "../_shared/logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Modelo para extracao de texto de PDFs (suporte nativo a PDF via multimodal)
const PDF_EXTRACTION_MODEL = "google/gemini-2.5-flash";
// Modelo para extracao de texto de imagens (GPT-4o vision — melhor OCR)
const IMAGE_EXTRACTION_MODEL = "openai/gpt-4o";
// Modelo para geracao de resumo (rapido e barato)
const SUMMARY_MODEL = "openai/gpt-4o-mini";
// Limite para envio multimodal inline (base64)
const MAX_MULTIMODAL_BYTES = 4 * 1024 * 1024; // 4MB

// MIME types que sao imagens (processados via vision)
const IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif",
]);

interface ProcessDocumentRequest {
  documentId: string;
}

serve(withSentry('process-agent-document', async (req) => {
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

    // 3. Extrair texto do documento
    let textContent = "";
    const isImage = IMAGE_MIMES.has(doc.mime_type || "");
    const isPdf = doc.mime_type === "application/pdf";
    const needsVision = isPdf || isImage;

    if (needsVision) {
      // ========== PDFs e IMAGENS: usar GPT-4o Vision via OpenRouter ==========
      const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
        .from("agent-documents")
        .createSignedUrl(doc.file_path, 600);

      if (signedUrlErr || !signedUrlData?.signedUrl) {
        await supabase
          .from("copilot_agent_documents")
          .update({ status: "error", error_message: `Signed URL failed: ${signedUrlErr?.message || "unknown"}`, updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(
          JSON.stringify({ error: "Failed to generate signed URL" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Baixar arquivo via fetch nativo
      const fileResponse = await fetch(signedUrlData.signedUrl);
      if (!fileResponse.ok) {
        await supabase
          .from("copilot_agent_documents")
          .update({ status: "error", error_message: "Failed to download file", updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(
          JSON.stringify({ error: "Failed to download file" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const fileBuffer = await fileResponse.arrayBuffer();
      const fileBytes = new Uint8Array(fileBuffer);
      console.log(`[process-agent-document] Downloaded ${isPdf ? "PDF" : "image"}: ${fileBytes.length} bytes`);

      if (fileBytes.length < MAX_MULTIMODAL_BYTES) {
        // Arquivo cabe no multimodal inline — usar GPT-4o Vision
        const base64 = encodeBase64(fileBytes);
        const mimeForDataUri = isImage ? (doc.mime_type || "image/png") : "application/pdf";

        const extractionPrompt = isImage
          ? `Descreva detalhadamente o conteudo desta imagem. Se for um catalogo, tabela de precos, flyer ou material comercial, transcreva TODOS os textos visiveis, incluindo precos, nomes de produtos, especificacoes e informacoes de contato. Transcreva tabelas em formato markdown. Responda APENAS com o conteudo extraido.`
          : `Extraia TODO o texto deste documento PDF de forma completa e fiel. Transcreva tabelas em markdown. NAO resuma, NAO omita. Se houver imagens com texto, transcreva o texto visivel (OCR). Responda APENAS com o texto extraido.`;

        // PDFs usam Gemini (suporte nativo), imagens usam GPT-4o (melhor OCR)
        const model = isPdf ? PDF_EXTRACTION_MODEL : IMAGE_EXTRACTION_MODEL;
        console.log(`[process-agent-document] Calling ${model} for ${mimeForDataUri} (${base64.length} chars base64)`);

        const extractionResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
            "X-Title": "V8 Millennials - Document Extraction",
          },
          body: JSON.stringify({
            model,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: extractionPrompt },
                { type: "image_url", image_url: { url: `data:${mimeForDataUri};base64,${base64}` } },
              ],
            }],
            temperature: 0.1,
            max_tokens: 16000,
          }),
        });

        if (extractionResponse.ok) {
          const extractResult = await extractionResponse.json();
          textContent = extractResult.choices?.[0]?.message?.content || "";
          console.log(`[process-agent-document] GPT-4o extraction got ${textContent.length} chars`);
        } else {
          const errBody = await extractionResponse.text();
          console.error(`[process-agent-document] GPT-4o extraction failed: ${extractionResponse.status}`, errBody.substring(0, 300));
        }
      } else {
        // PDF grande (>= 4MB): extrair texto programaticamente do binario
        console.log(`[process-agent-document] Large PDF (${fileBytes.length} bytes) — binary text extraction`);
        const rawText = new TextDecoder("latin1").decode(fileBytes);
        const textBlocks: string[] = [];
        const btEtRegex = /BT\s([\s\S]*?)ET/g;
        let match;
        while ((match = btEtRegex.exec(rawText)) !== null) {
          const blockContent = match[1];
          const stringRegex = /\(([^)]*)\)/g;
          let strMatch;
          while ((strMatch = stringRegex.exec(blockContent)) !== null) {
            const text = strMatch[1].replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
            if (text.trim().length > 0) textBlocks.push(text);
          }
        }
        if (textBlocks.length > 0) {
          textContent = textBlocks.join(" ").replace(/\s{2,}/g, " ").trim();
          console.log(`[process-agent-document] Binary extraction got ${textContent.length} chars`);
        }
      }
    } else {
      // ========== Texto/Markdown/CSV/DOCX: baixar e ler diretamente ==========
      const { data: fileData, error: downloadError } = await supabase.storage
        .from("agent-documents")
        .download(doc.file_path);

      if (downloadError || !fileData) {
        await supabase
          .from("copilot_agent_documents")
          .update({ status: "error", error_message: "Failed to download file", updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(
          JSON.stringify({ error: "Failed to download file" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      textContent = await fileData.text();
    }

    if (!textContent || textContent.trim().length < 10) {
      const errMsg = `Content too short (${textContent?.length || 0} chars). MIME: ${doc.mime_type}, Size: ${doc.file_size}`;
      console.error("[process-agent-document]", errMsg);
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Sanitizar content para PostgreSQL (remover null bytes)
    const contentToSave = textContent.substring(0, 500000).replace(/\x00/g, "");

    // 5. Buscar contexto do agente para o resumo
    const { data: agent } = await supabase
      .from("copilot_agents")
      .select("name, template_type, business_context")
      .eq("id", doc.agent_id)
      .single();

    const businessContext = (agent?.business_context || {}) as Record<string, string>;
    const companyName = businessContext.companyName || "a empresa";

    // 6. Gerar resumo via GPT-4o-mini (rapido e barato)
    const systemPrompt = `Voce e um especialista em extracao e sumarizacao de documentos corporativos.

Sua tarefa e gerar um RESUMO CONCISO e UTIL do documento fornecido, focando em informacoes que um agente de vendas B2B precisa saber.

Contexto:
- Empresa: ${companyName}
- Tipo de agente: ${agent?.template_type || "vendas B2B"}

REGRAS:
- Maximo 2000 caracteres no resumo
- Foque em: produtos/servicos, precos, condicoes, diferenciais, processos, politicas
- Ignore headers, footers, numeros de pagina e formatacao
- Use bullet points para organizar as informacoes
- Comece com uma frase resumo do que e o documento
- Responda APENAS com o resumo, sem explicacoes adicionais`;

    const truncatedContent = textContent.substring(0, 50000);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
        "X-Title": "V8 Millennials - Document Summary",
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
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
      console.error("Summary generation error:", error);
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

    // 7.5. Salvar content extraido via fetch direto na REST API
    try {
      const patchRes = await fetch(
        `${supabaseUrl}/rest/v1/copilot_agent_documents?id=eq.${documentId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": supabaseServiceKey,
            "Authorization": `Bearer ${supabaseServiceKey}`,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({ content: contentToSave }),
        }
      );
      if (patchRes.ok) {
        console.log(`[process-agent-document] Content saved: ${contentToSave.length} chars`);
      } else {
        console.warn("[process-agent-document] Content save failed:", patchRes.status, await patchRes.text());
      }
    } catch (e) {
      console.warn("[process-agent-document] Content save error (non-fatal):", e);
    }

    // 8. RAG: gerar chunks + embeddings (fire-and-forget)
    const textForChunking = contentToSave.substring(0, 100000);
    generateAndStoreChunkEmbeddings(
      supabase,
      OPENROUTER_API_KEY,
      documentId,
      doc.agent_id,
      doc.organization_id,
      textForChunking
    ).catch(e => console.warn("[process-agent-document] Chunk embeddings failed (non-fatal):", e));

    await logRuntime({
      organizationId: doc.organization_id,
      module: "agent",
      action: "process_document",
      status: "success",
      entityType: "document",
      entityId: documentId,
      payloadSnapshot: { agentId: doc.agent_id, fileName: doc.file_name, mimeType: doc.mime_type },
    });

    return new Response(
      JSON.stringify({ success: true, summary: summary.trim() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    await logRuntime({
      module: "agent",
      action: "process_document",
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));

/**
 * RAG: Divide conteudo em chunks, gera embeddings e salva.
 * Fire-and-forget — nao bloqueia a resposta.
 */
async function generateAndStoreChunkEmbeddings(
  supabase: ReturnType<typeof createClient>,
  apiKey: string,
  documentId: string,
  agentId: string,
  organizationId: string,
  textContent: string
): Promise<void> {
  await supabase
    .from("copilot_agent_document_chunks")
    .delete()
    .eq("document_id", documentId);

  const chunks = chunkText(textContent);
  if (chunks.length === 0) return;

  console.log(`[RAG] Gerando embeddings para ${chunks.length} chunks do documento ${documentId}`);

  const embeddings = await generateEmbeddingsBatch(chunks, apiKey);

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    agent_id: agentId,
    organization_id: organizationId,
    chunk_index: i,
    content,
    embedding: `[${embeddings[i].join(",")}]`,
  }));

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
