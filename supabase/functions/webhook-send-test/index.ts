/**
 * Envia evento de teste para um webhook e retorna o resultado (status, body, error).
 * Chamado pelo frontend ao clicar em "Enviar teste".
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { validateUrl, sendWebhook } from "../_shared/webhook-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

  let webhookId: string;
  try {
    const body = await req.json();
    webhookId = body.webhook_id;
    if (!webhookId || typeof webhookId !== "string") {
      return new Response(
        JSON.stringify({ error: "webhook_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: webhook, error: whError } = await supabase
    .from("webhooks")
    .select("id, url, secret, http_method, custom_headers, organization_id")
    .eq("id", webhookId)
    .single();

  if (whError || !webhook) {
    return new Response(
      JSON.stringify({ error: "Webhook not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let userId: string;
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    userId = payload.sub;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid token" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const orgId = (webhook as { organization_id: string }).organization_id;
  const { data: member } = await supabase
    .from("team_members")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .limit(1)
    .single();

  if (!member) {
    return new Response(
      JSON.stringify({ error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const wh = webhook as {
    id: string;
    url: string;
    secret: string | null;
    http_method: "POST" | "PUT" | "PATCH";
    custom_headers: Record<string, string>;
  };

  const urlValidation = await validateUrl(wh.url);
  if (!urlValidation.valid) {
    return new Response(
      JSON.stringify({
        success: false,
        status_code: null,
        response_body: "",
        error_message: urlValidation.error,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const payload = {
    event: "test",
    timestamp: new Date().toISOString(),
    message: "Evento de teste enviado pelo painel de webhooks",
    data: {},
  };

  const customHeaders = (wh.custom_headers && typeof wh.custom_headers === "object")
    ? (wh.custom_headers as Record<string, string>)
    : {};

  const result = await sendWebhook({
    url: wh.url,
    method: wh.http_method,
    payload,
    secret: wh.secret,
    customHeaders,
    deliveryId: `test-${Date.now()}`,
    event: "test",
  });

  const success = result.statusCode != null && result.statusCode >= 200 && result.statusCode < 300;
  return new Response(
    JSON.stringify({
      success,
      status_code: result.statusCode,
      response_body: result.responseBody,
      error_message: result.errorMessage ?? null,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
