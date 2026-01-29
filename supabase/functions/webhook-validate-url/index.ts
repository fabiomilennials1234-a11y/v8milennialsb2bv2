/**
 * Valida URL para webhook (anti-SSRF): apenas HTTPS, bloqueio de localhost/rede privada.
 * POST { url: string } → { valid: boolean, error?: string }
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { validateUrl } from "../_shared/webhook-utils.ts";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let url: string;
  try {
    const body = await req.json();
    url = body?.url;
    if (typeof url !== "string" || !url.trim()) {
      return new Response(
        JSON.stringify({ valid: false, error: "url é obrigatório" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ valid: false, error: "Body JSON inválido" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const result = await validateUrl(url.trim());
  return new Response(
    JSON.stringify(result),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
