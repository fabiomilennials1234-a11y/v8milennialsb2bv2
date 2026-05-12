/**
 * Stream Media (proxy para áudio/imagem do Storage)
 *
 * Evita CORS: o navegador pede áudio à Edge Function (com CORS permitido);
 * a função baixa o arquivo do Storage (server-side, sem CORS) e devolve o stream.
 *
 * Query: path = caminho no bucket "media" (ex: whatsapp-media/org-id/file.mp3)
 * Resposta: binário do arquivo com Content-Type correto e CORS.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "media";

// Só permitir paths do chat (evitar expor outros objetos)
const ALLOWED_PREFIX = "whatsapp-media/";

serve(withSentry('stream-media', async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  let path = url.searchParams.get("path");
  if (path) {
    try {
      path = decodeURIComponent(path);
    } catch {
      path = path;
    }
  }
  if (!path || path.includes("..") || !path.startsWith(ALLOWED_PREFIX)) {
    console.warn("[stream-media] Invalid or missing path", { path: path ?? "(missing)" });
    return new Response(JSON.stringify({ error: "Invalid or missing path", code: "INVALID_PATH" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[stream-media] Server misconfiguration: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response(JSON.stringify({ error: "Server misconfiguration", code: "CONFIG" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);

    if (error || !data) {
      const isNotFound = error?.message === "Object not found";
      console.warn("[stream-media] Storage download failed", { path, error: error?.message, code: isNotFound ? "NOT_FOUND" : "STORAGE_ERROR" });
      return new Response(JSON.stringify({ error: error?.message ?? "Not found", code: isNotFound ? "NOT_FOUND" : "STORAGE_ERROR" }), {
        status: isNotFound ? 404 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determinar Content-Type: usar o tipo do blob se disponível, senão inferir da extensão
    const ext = path.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg",
      mpeg: "audio/mpeg",
      ogg: "audio/ogg",
      opus: "audio/ogg",
      webm: "audio/webm",
      m4a: "audio/mp4",
      aac: "audio/aac",
      wav: "audio/wav",
      mp4: "video/mp4",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
      pdf: "application/pdf",
    };
    let contentType = data.type || "";
    if (!contentType || contentType === "application/octet-stream") {
      contentType = (ext && mimeMap[ext]) || "application/octet-stream";
    }
    // Áudio: forçar audio/mpeg para .mp3 e Accept-Ranges (Safari)
    const finalContentType = (ext === "mp3" || ext === "mpeg") ? "audio/mpeg" : contentType;
    const headers: Record<string, string> = {
      ...corsHeaders,
      "Content-Type": finalContentType,
      "Cache-Control": "private, max-age=3600",
    };
    if (finalContentType.startsWith("audio/")) {
      headers["Accept-Ranges"] = "bytes";
    }
    await logRuntime({
      module: "media",
      action: "stream",
      status: "success",
      payloadSnapshot: { path, contentType: finalContentType },
    });

    return new Response(data, {
      status: 200,
      headers,
    });
  } catch (e) {
    console.error("[stream-media] Unexpected error", { error: e instanceof Error ? e.message : String(e), path });
    await logRuntime({
      module: "media",
      action: "stream",
      status: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
      payloadSnapshot: { path },
    });
    return new Response(JSON.stringify({ error: "Internal error", code: "INTERNAL" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
