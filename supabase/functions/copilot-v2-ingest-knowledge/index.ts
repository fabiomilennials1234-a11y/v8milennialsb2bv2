/**
 * copilot-v2-ingest-knowledge — Copilot v2 KB ingestion worker (Slice 7).
 *
 * Recebe { knowledgeId }. Marca 'ingesting' + ingesting_started_at, extrai
 * texto (multimodal OCR/PDF), chunka, embeda 1536d (com retry), grava chunks
 * org-scoped, e SEMPRE transiciona pra 'ready' (com ingested_at) ou 'failed'
 * (com error_message + log). NUNCA deixa preso em 'ingesting'.
 *
 * Auth: x-cron-secret (chamada pelo backend após upload). config.toml: verify_jwt=false.
 * org_id vem da row de copilot_v2_knowledge (org-scoped), NUNCA do payload.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { generateEmbeddingsBatch } from "../_shared/embeddings.ts";
import { decideIngestionExtractor, nextIngestionStatus, chunkForEmbedding } from "../_shared/copilot-v2/ingestion.ts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const VISION_MODEL = "gpt-4o";
const EMBED_RETRIES = 2;

serve(withSentry("copilot-v2-ingest-knowledge", async (req: Request) => {
  const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return json({ error: "unauthorized" }, 401);

  // ── Validar credenciais NO ENTRY (lição VitrineVET: sem fallback silencioso) ──
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY não configurada" }, 500);
  if (!OPENROUTER_API_KEY) return json({ error: "OPENROUTER_API_KEY não configurada" }, 500);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let knowledgeId: string;
  try { knowledgeId = (await req.json()).knowledgeId; } catch { return json({ error: "invalid_schema" }, 400); }
  if (!knowledgeId) return json({ error: "knowledgeId obrigatório" }, 400);

  const { data: kn, error: knErr } = await supabase
    .from("copilot_v2_knowledge")
    .select("id, organization_id, storage_path, source_kind, status")
    .eq("id", knowledgeId).maybeSingle();
  if (knErr || !kn) return json({ error: "knowledge não encontrado" }, 404);

  // Marca 'ingesting' + timestamp (o reaper da Task 2 desbloqueia se travar).
  await supabase.from("copilot_v2_knowledge")
    .update({ status: "ingesting", ingesting_started_at: new Date().toISOString(), updated_at: new Date().toISOString(), error_message: null })
    .eq("id", knowledgeId);

  let chunksStored = 0;
  let error: string | null = null;
  try {
    // Download org-scoped (bucket de KB; storage_path da row, não do payload).
    const { data: signed, error: signErr } = await supabase.storage.from("copilot-v2-knowledge").createSignedUrl(kn.storage_path, 600);
    if (signErr || !signed?.signedUrl) throw new Error(`signed url: ${signErr?.message ?? "vazio"}`);
    const fileRes = await fetch(signed.signedUrl);
    if (!fileRes.ok) throw new Error(`download ${fileRes.status}`);
    const bytes = new Uint8Array(await fileRes.arrayBuffer());

    const mime = (kn as any).mime_type ?? (kn.source_kind === "pdf" ? "application/pdf" : "application/octet-stream");
    const extractor = decideIngestionExtractor(kn.source_kind as any, mime);

    let text = "";
    if (extractor === "multimodal_text" || extractor === "multimodal_ocr") {
      const base64 = encodeBase64(bytes);
      const isPdf = extractor === "multimodal_text" && kn.source_kind === "pdf";
      const prompt = isPdf
        ? "Extraia TODO o texto deste PDF de forma fiel. Transcreva tabelas em markdown. NÃO resuma."
        : "Descreva e transcreva TODO o texto visível desta imagem (preços, produtos, specs). Tabelas em markdown.";
      const contentPart = isPdf
        ? { type: "file", file: { filename: kn.storage_path, file_data: `data:${mime};base64,${base64}` } }
        : { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } };
      const res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: VISION_MODEL, messages: [{ role: "user", content: [{ type: "text", text: prompt }, contentPart] }], temperature: 0.1, max_tokens: 16000 }),
      });
      if (!res.ok) throw new Error(`multimodal ${res.status}: ${(await res.text()).slice(0, 200)}`);
      text = (await res.json()).choices?.[0]?.message?.content ?? "";
    } else if (extractor === "docx_text") {
      text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } else {
      // 'transcript' (vídeo) — provider de transcrição é decisão aberta (ver Decisões abertas).
      // FAIL-CLOSED: vídeo vira 'failed' com motivo claro, NUNCA inventa provider nem trava.
      throw new Error("transcrição de vídeo ainda não suportada (decisão de provider pendente)");
    }

    if (!text || text.trim().length < 10) throw new Error(`texto extraído vazio (${text?.length ?? 0} chars)`);

    const chunks = chunkForEmbedding(text.substring(0, 500000).replace(/\x00/g, ""));
    if (chunks.length === 0) throw new Error("0 chunks após chunking");

    // Embedding com retry (sem fallback silencioso — falha propaga p/ 'failed').
    let embeddings: number[][] | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt <= EMBED_RETRIES; attempt++) {
      try { embeddings = await generateEmbeddingsBatch(chunks, OPENROUTER_API_KEY); break; }
      catch (e) { lastErr = e instanceof Error ? e.message : String(e); }
    }
    if (!embeddings) throw new Error(`embedding falhou após ${EMBED_RETRIES + 1} tentativas: ${lastErr}`);

    await supabase.from("copilot_v2_knowledge_chunks").delete().eq("knowledge_id", knowledgeId);
    const rows = chunks.map((content, i) => ({
      knowledge_id: knowledgeId,
      organization_id: kn.organization_id, // org da ROW, nunca do payload
      content,
      embedding: `[${embeddings![i].join(",")}]`,
    }));
    for (let i = 0; i < rows.length; i += 50) {
      const { error: insErr } = await supabase.from("copilot_v2_knowledge_chunks").insert(rows.slice(i, i + 50));
      if (insErr) throw new Error(`insert chunks: ${insErr.message}`);
    }
    chunksStored = rows.length;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Transição determinística — SEMPRE sai de 'ingesting'.
  const next = nextIngestionStatus({ chunksStored, error });
  await supabase.from("copilot_v2_knowledge").update({
    status: next.status,
    error_message: next.error_message,
    extracted_text: error ? null : undefined,
    ingested_at: next.status === "ready" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq("id", knowledgeId);

  // Falha NÃO-silenciosa: runtime_logs (metadata only, sem PII — sem conteúdo
  // do documento). Não usamos copilot_v2_trace_steps (trace_id é NOT NULL com FK
  // a copilot_v2_traces — a ingestão não tem turn-trace). O status failed +
  // error_message na row JÁ é o "não-silencioso" estrutural.
  await logRuntime({
    organizationId: kn.organization_id,
    module: "copilot-v2",
    action: "ingestion",
    status: next.status === "ready" ? "success" : "error",
    entityType: "copilot_v2_knowledge",
    entityId: knowledgeId,
    errorMessage: error ?? undefined,
    payloadSnapshot: { knowledge_id: knowledgeId, chunks: chunksStored, status: next.status },
  });

  return json({ status: next.status, chunks: chunksStored, error });
}));
