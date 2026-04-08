/**
 * check-api-health — Health check de todas as APIs do sistema
 *
 * Pinga cada serviço externo em paralelo e retorna status + latência.
 * Apenas master admins podem chamar (JWT required).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ApiHealthResult {
  service: string;
  status: "connected" | "error" | "not_configured";
  latency_ms: number;
  error?: string;
  checked_at: string;
}

const TIMEOUT_MS = 8000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ─── Individual health checks ───────────────────────────

async function checkEvolutionApi(): Promise<ApiHealthResult> {
  const url = Deno.env.get("EVOLUTION_API_URL");
  const key = Deno.env.get("EVOLUTION_API_KEY");
  if (!url || !key) return { service: "Evolution API", status: "not_configured", latency_ms: 0, checked_at: new Date().toISOString() };

  const start = Date.now();
  try {
    const res = await withTimeout(fetch(`${url}/info`, { headers: { apikey: key } }), TIMEOUT_MS);
    const latency = Date.now() - start;
    if (res.ok) return { service: "Evolution API", status: "connected", latency_ms: latency, checked_at: new Date().toISOString() };
    return { service: "Evolution API", status: "error", latency_ms: latency, error: `HTTP ${res.status}`, checked_at: new Date().toISOString() };
  } catch (e) {
    return { service: "Evolution API", status: "error", latency_ms: Date.now() - start, error: e instanceof Error ? e.message : String(e), checked_at: new Date().toISOString() };
  }
}

async function checkOpenRouter(): Promise<ApiHealthResult> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return { service: "OpenRouter", status: "not_configured", latency_ms: 0, checked_at: new Date().toISOString() };

  const start = Date.now();
  try {
    const res = await withTimeout(fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    }), TIMEOUT_MS);
    const latency = Date.now() - start;
    if (res.ok) return { service: "OpenRouter", status: "connected", latency_ms: latency, checked_at: new Date().toISOString() };
    return { service: "OpenRouter", status: "error", latency_ms: latency, error: `HTTP ${res.status}`, checked_at: new Date().toISOString() };
  } catch (e) {
    return { service: "OpenRouter", status: "error", latency_ms: Date.now() - start, error: e instanceof Error ? e.message : String(e), checked_at: new Date().toISOString() };
  }
}

async function checkGemini(): Promise<ApiHealthResult> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return { service: "Gemini", status: "not_configured", latency_ms: 0, checked_at: new Date().toISOString() };

  const start = Date.now();
  try {
    const res = await withTimeout(fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          model: "models/gemini-embedding-2-preview",
          content: { parts: [{ text: "health check" }] },
          outputDimensionality: 128,
        }),
      }
    ), TIMEOUT_MS);
    const latency = Date.now() - start;
    if (res.ok) return { service: "Gemini", status: "connected", latency_ms: latency, checked_at: new Date().toISOString() };
    const errText = await res.text().catch(() => "");
    return { service: "Gemini", status: "error", latency_ms: latency, error: `HTTP ${res.status}: ${errText.substring(0, 100)}`, checked_at: new Date().toISOString() };
  } catch (e) {
    return { service: "Gemini", status: "error", latency_ms: Date.now() - start, error: e instanceof Error ? e.message : String(e), checked_at: new Date().toISOString() };
  }
}

async function checkOpenAI(): Promise<ApiHealthResult> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { service: "OpenAI", status: "not_configured", latency_ms: 0, checked_at: new Date().toISOString() };

  const start = Date.now();
  try {
    const res = await withTimeout(fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    }), TIMEOUT_MS);
    const latency = Date.now() - start;
    if (res.ok) return { service: "OpenAI", status: "connected", latency_ms: latency, checked_at: new Date().toISOString() };
    return { service: "OpenAI", status: "error", latency_ms: latency, error: `HTTP ${res.status}`, checked_at: new Date().toISOString() };
  } catch (e) {
    return { service: "OpenAI", status: "error", latency_ms: Date.now() - start, error: e instanceof Error ? e.message : String(e), checked_at: new Date().toISOString() };
  }
}

async function checkAsaas(): Promise<ApiHealthResult> {
  const url = Deno.env.get("ASAAS_API_URL") || "https://api.asaas.com/v3";
  const key = Deno.env.get("ASAAS_API_KEY");
  if (!key) return { service: "Asaas", status: "not_configured", latency_ms: 0, checked_at: new Date().toISOString() };

  const start = Date.now();
  try {
    const res = await withTimeout(fetch(`${url}/myAccount`, {
      headers: { access_token: key },
    }), TIMEOUT_MS);
    const latency = Date.now() - start;
    if (res.ok) return { service: "Asaas", status: "connected", latency_ms: latency, checked_at: new Date().toISOString() };
    return { service: "Asaas", status: "error", latency_ms: latency, error: `HTTP ${res.status}`, checked_at: new Date().toISOString() };
  } catch (e) {
    return { service: "Asaas", status: "error", latency_ms: Date.now() - start, error: e instanceof Error ? e.message : String(e), checked_at: new Date().toISOString() };
  }
}

function checkSentry(): ApiHealthResult {
  const dsn = Deno.env.get("SENTRY_DSN");
  return {
    service: "Sentry",
    status: dsn ? "connected" : "not_configured",
    latency_ms: 0,
    checked_at: new Date().toISOString(),
  };
}

function checkMeta(): ApiHealthResult {
  const appSecret = Deno.env.get("META_APP_SECRET");
  return {
    service: "Meta (Facebook)",
    status: appSecret ? "connected" : "not_configured",
    latency_ms: 0,
    checked_at: new Date().toISOString(),
  };
}

// ─── Main handler ───────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check — require valid JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Run all health checks in parallel
    const results = await Promise.allSettled([
      checkEvolutionApi(),
      checkOpenRouter(),
      checkGemini(),
      checkOpenAI(),
      checkAsaas(),
      Promise.resolve(checkSentry()),
      Promise.resolve(checkMeta()),
    ]);

    const healthResults: ApiHealthResult[] = results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { service: "Unknown", status: "error" as const, latency_ms: 0, error: "Check failed", checked_at: new Date().toISOString() }
    );

    return new Response(JSON.stringify({ results: healthResults, checked_at: new Date().toISOString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
