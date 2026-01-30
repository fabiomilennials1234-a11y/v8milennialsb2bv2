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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "media";

// Só permitir paths do chat (evitar expor outros objetos)
const ALLOWED_PREFIX = "whatsapp-media/";

serve(async (req) => {
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
  const path = url.searchParams.get("path");
  if (!path || path.includes("..") || !path.startsWith(ALLOWED_PREFIX)) {
    return new Response(JSON.stringify({ error: "Invalid or missing path" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);

    if (error || !data) {
      return new Response(JSON.stringify({ error: error?.message ?? "Not found" }), {
        status: error?.message === "Object not found" ? 404 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determinar Content-Type: usar o tipo do blob se disponível, senão inferir da extensão
    let contentType = data.type || "";
    if (!contentType || contentType === "application/octet-stream") {
      const ext = path.split(".").pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        mp3: "audio/mpeg",
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
      contentType = (ext && mimeMap[ext]) || "application/octet-stream";
    }
    return new Response(data, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("[stream-media] Error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
