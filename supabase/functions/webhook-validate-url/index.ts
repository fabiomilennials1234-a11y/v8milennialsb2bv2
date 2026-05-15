/**
 * Valida URL para webhook (anti-SSRF): apenas HTTPS, bloqueio de localhost/rede privada.
 * POST { url: string } → { valid: boolean, error?: string }
 */

import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { validateUrl } from "../_shared/webhook-utils.ts";
import { withSentry } from '../_shared/sentry.ts';
import { logRuntime } from "../_shared/logger.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";

Deno.serve(withSentry('webhook-validate-url', async (req) => {
  const corsHeaders = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Validate JWT
  try {
    await requireAuth(req);
  } catch (e) {
    if (e instanceof AuthError) return authErrorResponse(e, corsHeaders);
    throw e;
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

  await logRuntime({
    module: "webhook",
    action: "validate_url",
    status: result.valid ? "success" : "error",
    payloadSnapshot: { url: url.trim() },
    errorMessage: result.valid ? undefined : result.error,
  });

  return new Response(
    JSON.stringify(result),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}));
