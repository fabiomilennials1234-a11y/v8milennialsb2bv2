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

    if (doc.mime_type === "application/pdf") {
      // PDFs: baixar via signed URL fetch (mais eficiente que supabase.storage.download),
      // limitar a 2MB para caber na memoria da Edge Function, e enviar como base64 multimodal
      const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
        .from("agent-documents")
        .createSignedUrl(doc.file_path, 600);

      if (signedUrlErr || !signedUrlData?.signedUrl) {
        await supabase
          .from("copilot_agent_documents")
          .update({ status: "error", error_message: `Failed to generate signed URL: ${signedUrlErr?.message || "unknown"}`, updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(
          JSON.stringify({ error: "Failed to generate signed URL for PDF" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Baixar PDF via fetch nativo (mais leve que supabase SDK)
      const pdfResponse = await fetch(signedUrlData.signedUrl);
      if (!pdfResponse.ok) {
        await supabase
          .from("copilot_agent_documents")
          .update({ status: "error", error_message: "Failed to download PDF", updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(
          JSON.stringify({ error: "Failed to download PDF" }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfBytes = new Uint8Array(pdfBuffer);

      // Para PDFs pequenos (< 4MB), usar multimodal API com base64 inline
      // Para PDFs grandes (>= 4MB), extrair texto programaticamente do binario
      const MAX_MULTIMODAL_SIZE = 4 * 1024 * 1024;

      if (pdfBytes.length < MAX_MULTIMODAL_SIZE) {
        // PDFs pequenos: multimodal com base64 inline
        const base64 = encodeBase64(pdfBytes);
        console.log(`[process-agent-document] Small PDF — multimodal extraction (${base64.length} chars base64)`);

        const extractionResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": Deno.env.get("OPENROUTER_REFERER_URL") || "https://v8millennials.com",
            "X-Title": "V8 Millennials - PDF Text Extraction",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-preview",
            messages: [{
              role: "user",
              content: [
                { type: "text", text: `Extraia TODO o texto deste documento PDF de forma completa e fiel. Transcreva tabelas em markdown. NAO resuma, NAO omita. Responda APENAS com o texto extraido.` },
                { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
              ],
            }],
            temperature: 0.1,
            max_tokens: 32000,
          }),
        });

        if (extractionResponse.ok) {
          const extractResult = await extractionResponse.json();
          textContent = extractResult.choices?.[0]?.message?.content || "";
          console.log("[process-agent-document] Multimodal extraction got", textContent.length, "chars");
        } else {
          console.error("[process-agent-document] Multimodal extraction failed:", await extractionResponse.text());
        }
      } else {
        // PDFs grandes (>= 4MB): extrair texto programaticamente do binario PDF
        console.log(`[process-agent-document] Large PDF (${pdfBytes.length} bytes) — extracting text from binary`);
        const decoder = new TextDecoder("latin1");
        const rawText = decoder.decode(pdfBytes);
        // Extrair texto entre operadores de texto do PDF (BT...ET blocks)
        const textBlocks: string[] = [];
        const btEtRegex = /BT\s([\s\S]*?)ET/g;
        let match;
        while ((match = btEtRegex.exec(rawText)) !== null) {
          // Extrair strings entre parenteses (operadores Tj/TJ)
          const blockContent = match[1];
          const stringRegex = /\(([^)]*)\)/g;
          let strMatch;
          while ((strMatch = stringRegex.exec(blockContent)) !== null) {
            const text = strMatch[1].replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\\(/g, "(").replace(/\\\)/g, ")");
            if (text.trim().length > 0) {
              textBlocks.push(text);
            }
          }
        }
        if (textBlocks.length > 0) {
          textContent = textBlocks.join(" ").replace(/\s{2,}/g, " ").trim();
          console.log(`[process-agent-document] Binary extraction got ${textContent.length} chars from ${textBlocks.length} blocks`);
        }

        // Se extracao binaria falhou, tentar decodificar como UTF-8
        if (!textContent || textContent.length < 100) {
          const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(pdfBytes);
          const printable = utf8Text.replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, " ").replace(/\s{3,}/g, " ").trim();
          const wordCount = printable.split(/\s+/).filter((w: string) => w.length > 2).length;
          if (printable.length > 500 && wordCount > 50) {
            textContent = printable;
            console.log(`[process-agent-document] UTF-8 fallback got ${textContent.length} chars, ${wordCount} words`);
          }
        }
      }
    } else {
      // Para texto/markdown/csv/docx: baixar e ler diretamente (arquivos menores)
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

      textContent = await fileData.text();
    }

    if (!textContent || textContent.trim().length < 10) {
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "error", error_message: "Document content too short or empty. The PDF may be image-only without readable text.", updated_at: new Date().toISOString() })
        .eq("id", documentId);

      return new Response(
        JSON.stringify({ error: "Document content too short" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4.5. Sanitizar content para PostgreSQL (remover null bytes que TEXT nao aceita)
    const contentToSave = textContent.substring(0, 500000).replace(/\x00/g, "");

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
- Responda APENAS com o resumo, sem explicações adicionais`;

    // Truncar conteudo extraido para caber no contexto do LLM
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
        model: "google/gemini-3-flash-preview",
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

    // 7.5. Salvar content extraido via fetch direto na REST API
    //      (contorna schema cache interno do PostgREST das Edge Functions)
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

    // 8. RAG: gerar chunks + embeddings do conteudo EXTRAIDO (texto real, nao base64)
    //    Sanitizar null bytes antes de chunking (PostgreSQL TEXT nao aceita \x00)
    //    (fire-and-forget: nao bloqueia o retorno ao usuario)
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
