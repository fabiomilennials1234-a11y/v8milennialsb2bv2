import { withErrorBoundary } from '../_shared/error-boundary.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { unzipSync } from "https://esm.sh/fflate@0.8.2";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateEmbedding, generateEmbeddingsBatch, generateMultimodalEmbedding, chunkText, formatEmbeddingForPg } from "../_shared/embeddings.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { splitPdfIntoBatches, encodeBatchAsBase64 } from "./pdf-chunking.ts";

// Threshold pra acionar chunking. PDFs >= esse tamanho viram batched
// background processing (evita WORKER_RESOURCE_LIMIT em isolate Deno).
const PDF_CHUNK_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB

// Limite duro absoluto. PDFs maiores que isso = erro imediato com mensagem
// pra usuario dividir o arquivo. Valor conservador: pdf-lib.load() carrega
// PDF inteiro em memoria e cria copias intermediarias durante o split, o que
// na pratica usa ~3x do tamanho do arquivo. Edge function Deno isolate tem
// ~150MB heap, mas OpenAI multimodal payload + outros buffers comem o resto.
// Empiricamente: PDFs >8MB travam silenciosamente em prod.
const PDF_MAX_BYTES = 8 * 1024 * 1024; // 8MB

// Configuração do chunking
const PDF_PAGES_PER_BATCH = 3;
const PDF_MAX_PAGES = 100;

// Modelos via OpenAI
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const VISION_MODEL = "gpt-4o";
const SUMMARY_MODEL = "gpt-4o-mini";
const TEXT_EXTRACTION_MODEL = "gpt-4o-mini";

// MIME types que sao imagens
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
// MIME types que sao videos
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
// MIME types que sao documentos binarios (precisam de processamento especial)
const DOCX_MIMES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

interface ProcessDocumentRequest {
  documentId: string;
}

/**
 * Extrai texto de um DOCX descompactando o ZIP e parseando word/document.xml
 */
function extractTextFromDocx(bytes: Uint8Array): string {
  try {
    // Descompactar ZIP
    const files = unzipSync(bytes);

    // Buscar word/document.xml (contem o texto principal)
    const docXmlKey = Object.keys(files).find(k => k.toLowerCase().includes("word/document.xml"));
    if (!docXmlKey) {
      console.warn("[DOCX] word/document.xml not found in ZIP");
      return "";
    }

    const xmlBytes = files[docXmlKey];
    const xmlText = new TextDecoder("utf-8").decode(xmlBytes);

    // Extrair texto de tags <w:t> (Word text runs)
    const textParts: string[] = [];
    const regex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
      if (match[1]) textParts.push(match[1]);
    }

    // Detectar quebras de paragrafo (<w:p>) para manter estrutura
    let result = xmlText
      .replace(/<w:p[^/]*>/g, "\n")           // Novo paragrafo
      .replace(/<w:br[^/]*\/>/g, "\n")         // Line break
      .replace(/<w:tab[^/]*\/>/g, "\t")        // Tab
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, "$1") // Texto
      .replace(/<[^>]+>/g, "")                  // Remove todas as outras tags
      .replace(/\n{3,}/g, "\n\n")              // Limpar linhas vazias extras
      .trim();

    if (result.length > 50) return result;
    if (textParts.length > 0) return textParts.join(" ");

    return "";
  } catch (e) {
    console.error("[DOCX] Extraction failed:", e);
    return "";
  }
}

/**
 * Chama LLM multimodal via OpenAI para extrair texto de PDFs ou imagens
 */
async function extractViaMultimodal(
  apiKey: string,
  base64Content: string,
  mimeType: string,
  isPdf: boolean,
  fileName: string,
): Promise<{ text: string; error?: string }> {
  const prompt = isPdf
    ? `Extraia TODO o texto deste documento PDF de forma completa e fiel. Transcreva tabelas em markdown. NAO resuma, NAO omita. Se houver imagens com texto, faca OCR. Responda APENAS com o texto extraido.`
    : `Descreva detalhadamente o conteudo desta imagem. Se for material comercial (catalogo, tabela de precos, flyer), transcreva TODOS os textos visiveis incluindo precos, nomes de produtos, especificacoes. Transcreva tabelas em markdown. Responda APENAS com o conteudo extraido.`;

  const contentPart = isPdf
    ? { type: "file", file: { filename: fileName, file_data: `data:${mimeType};base64,${base64Content}` } }
    : { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Content}` } };

  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          contentPart,
        ],
      }],
      temperature: 0.1,
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    return { text: "", error: `${VISION_MODEL} ${response.status}: ${errBody.substring(0, 200)}` };
  }

  const result = await response.json();
  const text = result.choices?.[0]?.message?.content || "";
  return { text };
}

/**
 * Envia conteudo de texto ao LLM para limpeza/extracao quando o texto bruto
 * contem muito lixo binario misturado (ex: DOCX mal parseado)
 */
async function cleanTextViaLLM(
  apiKey: string,
  rawText: string,
): Promise<string> {
  const response = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TEXT_EXTRACTION_MODEL,
      messages: [
        { role: "system", content: "Voce recebera texto bruto extraido de um documento que pode conter lixo binario. Extraia APENAS o texto legivel e util, ignorando caracteres estranhos. Mantenha a estrutura (titulos, listas). Responda APENAS com o texto limpo." },
        { role: "user", content: rawText.substring(0, 30000) },
      ],
      temperature: 0.1,
      max_tokens: 8000,
    }),
  });

  if (!response.ok) return "";
  const result = await response.json();
  return result.choices?.[0]?.message?.content || "";
}

serve(withErrorBoundary('process-agent-document', async (req) => {
  const origin = req.headers.get("Origin") ?? undefined;
  const corsHeaders = withSecurityHeaders(getCorsHeaders(origin));

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OpenAI API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Embeddings sao via OpenRouter (getOpenRouterHeaders usa Bearer <key>).
    // Bug fix (incidente VitrineVET 2026-06-01): aqui passava GEMINI_API_KEY
    // por engano -> OpenRouter respondia 401 "Missing Authentication header" e
    // o media path nao gerava embedding -> doc travava. Todos os outros
    // callers (generate-faq-embeddings, reembed-all) passam OPENROUTER_API_KEY.
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

    // 1. Buscar documento
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
    const mime = doc.mime_type || "";
    const isImage = IMAGE_MIMES.has(mime);
    const isPdf = mime === "application/pdf";
    const isDocx = DOCX_MIMES.has(mime);

    // ---------- Download do arquivo ----------
    const { data: signedUrlData, error: signedUrlErr } = await supabase.storage
      .from("agent-documents")
      .createSignedUrl(doc.file_path, 600);

    if (signedUrlErr || !signedUrlData?.signedUrl) {
      await supabase.from("copilot_agent_documents")
        .update({ status: "error", error_message: `Signed URL failed: ${signedUrlErr?.message}`, updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return new Response(JSON.stringify({ error: "Signed URL failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileResponse = await fetch(signedUrlData.signedUrl);
    if (!fileResponse.ok) {
      await supabase.from("copilot_agent_documents")
        .update({ status: "error", error_message: "Download failed", updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return new Response(JSON.stringify({ error: "Download failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const fileBytes = new Uint8Array(fileBuffer);
    console.log(`[process-agent-document] Downloaded ${doc.file_name}: ${fileBytes.length} bytes (${mime})`);

    // ---------- MEDIA PATH: embed directly, skip text extraction ----------
    const fileType = (doc as any).file_type || "document";
    const isMediaFile = fileType === "image" || fileType === "video";

    if (isMediaFile) {
      console.log(`[process-agent-document] Media file detected (${fileType}). Using multimodal embedding directly.`);

      // Validate size (20MB limit for Gemini inline)
      if (fileBytes.length > 20 * 1024 * 1024) {
        const errMsg = `Arquivo de midia muito grande (${(fileBytes.length / 1024 / 1024).toFixed(1)}MB). Limite: 20MB.`;
        await supabase.from("copilot_agent_documents")
          .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Generate multimodal embedding directly from raw bytes.
      // Bug fix (incidente VitrineVET 2026-06-01): se essa chamada falha
      // (timeout/quota Gemini), o erro propagava pro outer catch que NAO
      // resetava o status -> doc ficava preso em 'processing' pra sempre, sem
      // error_message. Resultado: tool send_document nunca oferecia o doc e o
      // modelo improvisava {"file":...} em texto. Agora marcamos 'error'
      // explicitamente pra o operador ver e reprocessar.
      let embedding: Awaited<ReturnType<typeof generateMultimodalEmbedding>>;
      try {
        embedding = await generateMultimodalEmbedding(fileBytes, mime, OPENROUTER_API_KEY);
      } catch (embErr) {
        const errMsg = `Falha ao gerar embedding multimodal: ${embErr instanceof Error ? embErr.message : String(embErr)}`;
        await supabase.from("copilot_agent_documents")
          .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
          .eq("id", documentId);
        console.error(`[process-agent-document] Media embedding failed for ${documentId}:`, errMsg);
        return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Use description as content (user-provided context about the media)
      const description = (doc as any).description || doc.file_name;
      const sendWhen = (doc as any).send_when || "";
      const summary = sendWhen
        ? `${description}\n\nQuando enviar: ${sendWhen}`
        : description;

      // Save summary and mark ready
      await supabase.from("copilot_agent_documents")
        .update({ summary: summary.trim(), status: "ready", error_message: null, updated_at: new Date().toISOString() })
        .eq("id", documentId);

      // Store chunks: multimodal embedding (visual) + text embedding (description-based)
      await supabase.from("copilot_agent_document_chunks").delete().eq("document_id", documentId);

      // Chunk 0: multimodal embedding from raw media bytes (visual similarity)
      const { error: chunkError } = await supabase.from("copilot_agent_document_chunks").insert({
        document_id: documentId,
        agent_id: doc.agent_id,
        organization_id: doc.organization_id,
        chunk_index: 0,
        content: summary,
        embedding: formatEmbeddingForPg(embedding),
      });
      if (chunkError) console.error("[process-agent-document] Media visual chunk error:", chunkError.message);

      // Chunk 1: text embedding from description+send_when (text-based RAG search)
      if (summary.length > 10) {
        try {
          const textEmbedding = await generateEmbedding(summary, OPENROUTER_API_KEY);
          await supabase.from("copilot_agent_document_chunks").insert({
            document_id: documentId,
            agent_id: doc.agent_id,
            organization_id: doc.organization_id,
            chunk_index: 1,
            content: summary,
            embedding: formatEmbeddingForPg(textEmbedding),
          });
          console.log("[process-agent-document] Media text embedding chunk stored");
        } catch (e) {
          console.warn("[process-agent-document] Text embedding for media failed (non-fatal):", e);
        }
      }

      await logRuntime({
        organizationId: doc.organization_id, module: "agent", action: "process_document",
        status: "success", entityType: "document", entityId: documentId,
        payloadSnapshot: { agentId: doc.agent_id, fileName: doc.file_name, mimeType: mime, fileType, mediaEmbedding: true },
      });

      return new Response(
        JSON.stringify({ success: true, summary: summary.trim(), mediaEmbedding: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ---------- DOCUMENT PATH: text extraction + chunking ----------

    if (isPdf || isImage) {
      // Limite duro absoluto pra PDFs (8MB). Imagens passam direto.
      if (isPdf && fileBytes.length > PDF_MAX_BYTES) {
        const sizeMB = (fileBytes.length / 1024 / 1024).toFixed(1);
        const errMsg = `PDF muito grande (${sizeMB}MB). Limite atual: ${PDF_MAX_BYTES / 1024 / 1024}MB por arquivo. Divida o PDF em partes menores e envie cada parte separadamente. Suporte para PDFs maiores via worker dedicado esta no roadmap.`;
        await supabase.from("copilot_agent_documents")
          .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
          .eq("id", documentId);
        return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // PDFs grandes vão pra background processing com chunking por páginas.
      // Imagens e PDFs pequenos seguem fluxo síncrono single-shot.
      if (isPdf && fileBytes.length >= PDF_CHUNK_THRESHOLD_BYTES) {
        console.log(`[process-agent-document] PDF grande detectado (${(fileBytes.length / 1024 / 1024).toFixed(1)}MB). Background chunking.`);

        // Schedule background processing — function retorna 202 imediato,
        // worker continua processando até completar (status=ready ou error).
        const bgPromise = processPdfInBackground({
          supabase,
          supabaseUrl,
          supabaseServiceKey,
          openaiApiKey: OPENAI_API_KEY,
          openrouterApiKey: OPENROUTER_API_KEY,
          documentId,
          doc,
          fileBytes,
        }).catch((bgErr) => {
          console.error("[process-agent-document] Background processing failed:", bgErr);
          return supabase
            .from("copilot_agent_documents")
            .update({
              status: "error",
              error_message: `Background processing failed: ${bgErr instanceof Error ? bgErr.message : String(bgErr)}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", documentId);
        });

        // EdgeRuntime.waitUntil mantém o promise vivo após o return
        if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
          (globalThis as any).EdgeRuntime.waitUntil(bgPromise);
        }

        return new Response(
          JSON.stringify({
            success: true,
            status: "processing",
            mode: "background",
            message: "PDF grande sera processado em background. Acompanhe via status do documento.",
            sizeMB: Number((fileBytes.length / 1024 / 1024).toFixed(1)),
          }),
          { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Fluxo síncrono single-shot (PDF pequeno OU imagem)
      const base64 = encodeBase64(fileBytes);
      const dataUri = isPdf ? "application/pdf" : mime;

      console.log(`[process-agent-document] Multimodal extraction via ${VISION_MODEL} (${base64.length} chars)`);
      const { text, error: extractError } = await extractViaMultimodal(OPENAI_API_KEY, base64, dataUri, isPdf, doc.file_name);

      if (text && text.length > 10) {
        textContent = text;
        console.log(`[process-agent-document] Multimodal OK: ${textContent.length} chars`);
      } else {
        console.warn(`[process-agent-document] Multimodal failed. Error: ${extractError || "none"}`);
      }
    } else if (isDocx) {
      // DOCX: extrair XML do ZIP
      console.log("[process-agent-document] Extracting text from DOCX (ZIP/XML)");
      const docxText = extractTextFromDocx(fileBytes);

      if (docxText && docxText.length > 50) {
        textContent = docxText;
        console.log(`[process-agent-document] DOCX extraction OK: ${textContent.length} chars`);
      } else {
        // Fallback: enviar o texto bruto ao LLM para limpeza
        console.log("[process-agent-document] DOCX extraction weak, trying LLM cleanup");
        const rawText = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
        textContent = await cleanTextViaLLM(OPENAI_API_KEY, rawText);
        console.log(`[process-agent-document] LLM cleanup got: ${textContent.length} chars`);
      }
    } else {
      // TXT, CSV, MD: leitura direta
      textContent = new TextDecoder("utf-8", { fatal: false }).decode(fileBytes);
    }

    // Validacao
    if (!textContent || textContent.trim().length < 10) {
      const errMsg = `Content too short (${textContent?.length || 0} chars). MIME: ${mime}, Size: ${doc.file_size}`;
      await supabase.from("copilot_agent_documents")
        .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return new Response(JSON.stringify({ error: errMsg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 4. Sanitizar para PostgreSQL
    const contentToSave = textContent.substring(0, 500000).replace(/\x00/g, "");

    // 5. Buscar contexto do agente
    const { data: agent } = await supabase
      .from("copilot_agents")
      .select("name, template_type, business_context")
      .eq("id", doc.agent_id)
      .single();

    const businessContext = (agent?.business_context || {}) as Record<string, string>;
    const companyName = businessContext.companyName || "a empresa";

    // 6. Gerar resumo via GPT-4o-mini
    const summaryResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        messages: [
          {
            role: "system",
            content: `Voce e um especialista em sumarizacao de documentos corporativos. Gere um resumo CONCISO e UTIL focando em informacoes que um agente de vendas B2B precisa: produtos, servicos, precos, condicoes, diferenciais. Max 2000 caracteres. Use bullet points. Empresa: ${companyName}. Responda APENAS com o resumo.`,
          },
          { role: "user", content: `Resumo deste documento:\n\n${contentToSave.substring(0, 50000)}` },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    let summary = "";
    if (summaryResponse.ok) {
      const summaryResult = await summaryResponse.json();
      summary = summaryResult.choices?.[0]?.message?.content || "";
    }

    if (!summary || summary.trim().length < 10) {
      await supabase.from("copilot_agent_documents")
        .update({ status: "error", error_message: "Summary generation failed", updated_at: new Date().toISOString() })
        .eq("id", documentId);
      return new Response(JSON.stringify({ error: "Summary generation failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 7. Salvar resumo e marcar como ready
    await supabase.from("copilot_agent_documents")
      .update({ summary: summary.trim(), status: "ready", error_message: null, updated_at: new Date().toISOString() })
      .eq("id", documentId);

    // 7.5. Salvar content via REST API direta
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
      if (!patchRes.ok) console.warn("[process-agent-document] Content save failed:", patchRes.status);
    } catch (e) {
      console.warn("[process-agent-document] Content save error:", e);
    }

    // 8. RAG: chunks + embeddings (fire-and-forget)
    generateAndStoreChunkEmbeddings(
      supabase, OPENROUTER_API_KEY, documentId, doc.agent_id, doc.organization_id,
      contentToSave.substring(0, 100000)
    ).catch(e => console.warn("[process-agent-document] Chunks failed:", e));

    await logRuntime({
      organizationId: doc.organization_id, module: "agent", action: "process_document",
      status: "success", entityType: "document", entityId: documentId,
      payloadSnapshot: { agentId: doc.agent_id, fileName: doc.file_name, mimeType: mime },
    });

    return new Response(
      JSON.stringify({ success: true, summary: summary.trim() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    await logRuntime({
      module: "agent", action: "process_document", status: "error",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));

/**
 * Background processing pra PDFs grandes (≥5MB).
 *
 * Fluxo:
 *   1. Split PDF em batches de 3 páginas via pdf-lib
 *   2. Cada batch vai pro multimodal LLM (sequencial pra economizar memória)
 *   3. Texto extraído é concatenado
 *   4. Continua fluxo normal: summary + status=ready + chunks + embeddings
 *
 * Erros em batches individuais são logados mas não interrompem o todo —
 * resto do PDF continua. Erro fatal (split falha, summary falha) marca
 * doc.status='error' com mensagem clara.
 */
async function processPdfInBackground(params: {
  supabase: ReturnType<typeof createClient>;
  supabaseUrl: string;
  supabaseServiceKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  documentId: string;
  doc: any;
  fileBytes: Uint8Array;
}): Promise<void> {
  const {
    supabase,
    supabaseUrl,
    supabaseServiceKey,
    openaiApiKey,
    openrouterApiKey,
    documentId,
    doc,
    fileBytes,
  } = params;

  const startedAt = Date.now();

  // 1. Split em batches
  let batches: Awaited<ReturnType<typeof splitPdfIntoBatches>>["batches"];
  let totalPages: number;
  try {
    const splitResult = await splitPdfIntoBatches(fileBytes, {
      pagesPerBatch: PDF_PAGES_PER_BATCH,
      maxPages: PDF_MAX_PAGES,
    });
    batches = splitResult.batches;
    totalPages = splitResult.totalPages;
    console.log(
      `[process-agent-document] PDF split: ${totalPages} páginas em ${batches.length} batches`,
    );
  } catch (splitErr) {
    const errMsg = `Falha ao dividir PDF: ${splitErr instanceof Error ? splitErr.message : String(splitErr)}`;
    await supabase
      .from("copilot_agent_documents")
      .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    throw splitErr;
  }

  // 2. Extrair texto de cada batch sequencialmente
  const textParts: string[] = [];
  let batchErrors = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchLabel = `págs ${batch.pageNumbers[0]}-${batch.pageNumbers[batch.pageNumbers.length - 1]}`;

    try {
      const base64 = encodeBatchAsBase64(batch);
      const { text, error: extractError } = await extractViaMultimodal(
        openaiApiKey,
        base64,
        "application/pdf",
        true,
        `${doc.file_name} (${batchLabel})`,
      );

      if (text && text.length > 10) {
        textParts.push(`--- ${batchLabel} ---\n${text}`);
        console.log(
          `[process-agent-document] Batch ${i + 1}/${batches.length} OK: ${text.length} chars (${batchLabel})`,
        );
      } else {
        batchErrors++;
        console.warn(
          `[process-agent-document] Batch ${i + 1}/${batches.length} falhou (${batchLabel}): ${extractError || "texto vazio"}`,
        );
      }
    } catch (batchErr) {
      batchErrors++;
      console.warn(
        `[process-agent-document] Batch ${i + 1}/${batches.length} exception (${batchLabel}):`,
        batchErr,
      );
    }
  }

  const textContent = textParts.join("\n\n");

  if (!textContent || textContent.trim().length < 10) {
    const errMsg = `Extracao de texto falhou em todos os ${batches.length} batches (${batchErrors} erros). PDF pode estar protegido, vazio ou ilegivel.`;
    await supabase
      .from("copilot_agent_documents")
      .update({ status: "error", error_message: errMsg, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    throw new Error(errMsg);
  }

  // 3. Sanitizar
  const contentToSave = textContent.substring(0, 500000).replace(/\x00/g, "");

  // 4. Buscar contexto do agente
  const { data: agent } = await supabase
    .from("copilot_agents")
    .select("name, template_type, business_context")
    .eq("id", doc.agent_id)
    .single();

  const businessContext = (agent?.business_context || {}) as Record<string, string>;
  const companyName = businessContext.companyName || "a empresa";

  // 5. Gerar resumo via GPT-4o-mini
  const summaryResponse = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      messages: [
        {
          role: "system",
          content: `Voce e um especialista em sumarizacao de documentos corporativos. Gere um resumo CONCISO e UTIL focando em informacoes que um agente de vendas B2B precisa: produtos, servicos, precos, condicoes, diferenciais. Max 2000 caracteres. Use bullet points. Empresa: ${companyName}. Responda APENAS com o resumo.`,
        },
        { role: "user", content: `Resumo deste documento:\n\n${contentToSave.substring(0, 50000)}` },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  let summary = "";
  if (summaryResponse.ok) {
    const summaryResult = await summaryResponse.json();
    summary = summaryResult.choices?.[0]?.message?.content || "";
  }

  if (!summary || summary.trim().length < 10) {
    await supabase
      .from("copilot_agent_documents")
      .update({
        status: "error",
        error_message: "Summary generation failed (background)",
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);
    throw new Error("Summary generation failed");
  }

  // 6. Salvar resumo + status=ready
  await supabase
    .from("copilot_agent_documents")
    .update({
      summary: summary.trim(),
      status: "ready",
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", documentId);

  // 7. Salvar content via REST API direta
  try {
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/copilot_agent_documents?id=eq.${documentId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ content: contentToSave }),
      },
    );
    if (!patchRes.ok) console.warn("[process-agent-document] Content save failed:", patchRes.status);
  } catch (e) {
    console.warn("[process-agent-document] Content save error:", e);
  }

  // 8. RAG chunks + embeddings
  await generateAndStoreChunkEmbeddings(
    supabase,
    openrouterApiKey,
    documentId,
    doc.agent_id,
    doc.organization_id,
    contentToSave.substring(0, 100000),
  ).catch((e) => console.warn("[process-agent-document] Chunks failed:", e));

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[process-agent-document] Background DONE: ${totalPages} páginas, ${batches.length} batches, ${batchErrors} erros, ${elapsedMs}ms`,
  );

  await logRuntime({
    organizationId: doc.organization_id,
    module: "agent",
    action: "process_document",
    status: "success",
    entityType: "document",
    entityId: documentId,
    payloadSnapshot: {
      agentId: doc.agent_id,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      mode: "background_chunked",
      totalPages,
      batches: batches.length,
      batchErrors,
      elapsedMs,
      textChars: contentToSave.length,
    },
  });
}

async function generateAndStoreChunkEmbeddings(
  supabase: ReturnType<typeof createClient>,
  apiKey: string, documentId: string, agentId: string,
  organizationId: string, textContent: string
): Promise<void> {
  await supabase.from("copilot_agent_document_chunks").delete().eq("document_id", documentId);

  const chunks = chunkText(textContent);
  if (chunks.length === 0) return;

  console.log(`[RAG] Gerando embeddings para ${chunks.length} chunks`);
  const embeddings = await generateEmbeddingsBatch(chunks, apiKey);

  const rows = chunks.map((content, i) => ({
    document_id: documentId, agent_id: agentId, organization_id: organizationId,
    chunk_index: i, content, embedding: `[${embeddings[i].join(",")}]`,
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from("copilot_agent_document_chunks").insert(rows.slice(i, i + 50));
    if (error) console.error(`[RAG] Insert error:`, error.message);
  }

  console.log(`[RAG] ${rows.length} chunks indexados`);
}
