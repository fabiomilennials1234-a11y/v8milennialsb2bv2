/**
 * Authentication helpers for Supabase Edge Functions
 * 
 * SECURITY: Validates webhook requests to prevent unauthorized access
 */

import { createHmac, timingSafeEqual } from "https://deno.land/std@0.177.0/node/crypto.ts";

/**
 * Comparação de tempo constante.
 *
 * `crypto.subtle.timingSafeEqual` NÃO existe — foi extensão não-padrão do Deno 1.x
 * e saiu no Deno 2 (medido neste runtime: `typeof` devolve `undefined`). Procurá-lo
 * ali custava dois erros `TS2339` a todo `deno check` que tocasse este arquivo, e o
 * ramo "nativo" nunca rodou uma vez sequer.
 *
 * A primitiva vive no mesmo módulo de onde `createHmac` já vem: sem dependência
 * nova, sem versão nova, e é o acumulador XOR de `std/crypto` — percorre os N bytes
 * sempre, sem sair no primeiro que difere. Esse laço integral é o ponto da função:
 * `===` sairia no primeiro byte diferente e o tempo dessa saída é o vazamento.
 *
 * `DataView` explícito com `byteOffset`/`byteLength`: é a única sobrecarga que o
 * shim aceita sem cast, e evita o caso em que `.buffer` de uma view parcial traria
 * bytes de fora da fatia.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) {
    // O comprimento vaza de qualquer jeito (está no tamanho do corpo/cabeçalho).
    // O laço mantém o custo proporcional ao candidato, como antes.
    let _xor = 0;
    for (let i = 0; i < bufA.length; i++) _xor |= bufA[i] ^ 0;
    return false;
  }
  return timingSafeEqual(
    new DataView(bufA.buffer, bufA.byteOffset, bufA.byteLength),
    new DataView(bufB.buffer, bufB.byteOffset, bufB.byteLength),
  );
}

/**
 * Result of authentication validation
 */
export interface AuthResult {
  valid: boolean;
  error?: string;
  organizationId?: string;
}

/**
 * Rate limiting storage (in-memory, resets on function cold start)
 * For production, use Redis or Supabase table
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Validates cron requests via x-cron-secret header.
 * Fail-closed: rejects when CRON_SECRET env var is missing or empty.
 */
export function requireCronAuth(req: Request): { authorized: boolean } {
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  const cronSecret = req.headers.get("x-cron-secret");
  if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
    return { authorized: false };
  }
  return { authorized: true };
}

/**
 * Validates Evolution API webhook requests
 * Checks for API key in header
 */
export function validateEvolutionWebhook(req: Request): AuthResult {
  const apiKey = req.headers.get("apikey") || req.headers.get("x-api-key");
  const expectedKey = Deno.env.get("EVOLUTION_WEBHOOK_SECRET");

  // Fail closed: if secret not configured, reject all requests
  if (!expectedKey) {
    console.error("[AUTH] EVOLUTION_WEBHOOK_SECRET not configured — rejecting request");
    return { valid: false, error: "EVOLUTION_WEBHOOK_SECRET not configured" };
  }
  
  if (!apiKey) {
    return { valid: false, error: "Missing API key in request headers" };
  }
  
  if (!timingSafeCompare(apiKey, expectedKey)) {
    return { valid: false, error: "Invalid API key" };
  }

  return { valid: true };
}

/**
 * Validates Cal.com webhook requests using HMAC signature
 * Cal.com sends signature in x-cal-signature-256 header
 */
export function validateCalcomWebhook(req: Request, body: string): AuthResult {
  const signature = req.headers.get("x-cal-signature-256");
  const secret = Deno.env.get("CALCOM_WEBHOOK_SECRET");
  
  // If no secret configured, allow but log warning (for backward compatibility)
  if (!secret) {
    console.warn("[AUTH] CALCOM_WEBHOOK_SECRET not configured - webhook authentication disabled");
    return { valid: true };
  }
  
  if (!signature) {
    return { valid: false, error: "Missing Cal.com signature header" };
  }
  
  // Verify HMAC signature
  const expectedSignature = createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  
  if (!timingSafeCompare(signature, expectedSignature) && !timingSafeCompare(signature, `sha256=${expectedSignature}`)) {
    return { valid: false, error: "Invalid Cal.com signature" };
  }
  
  return { valid: true };
}

/**
 * Validates generic webhook requests with API key
 */
export function validateWebhookApiKey(req: Request): AuthResult {
  const apiKey = req.headers.get("x-webhook-key") || req.headers.get("authorization")?.replace("Bearer ", "");
  const expectedKey = Deno.env.get("WEBHOOK_API_KEY");
  
  if (!expectedKey) {
    console.warn("[AUTH] WEBHOOK_API_KEY not configured - using default (INSECURE!)");
    return { valid: false, error: "Webhook API key not configured on server" };
  }
  
  if (!apiKey) {
    return { valid: false, error: "Missing API key" };
  }
  
  if (!timingSafeCompare(apiKey, expectedKey)) {
    return { valid: false, error: "Invalid API key" };
  }

  return { valid: true };
}

/**
 * Rate limiting check
 * Returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(
  identifier: string, 
  maxRequests = 100, 
  windowMs = 60000
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitStore.get(identifier);
  
  if (!record || now > record.resetTime) {
    // First request or window expired
    rateLimitStore.set(identifier, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }
  
  if (record.count >= maxRequests) {
    // Rate limit exceeded
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: record.resetTime - now 
    };
  }
  
  // Increment counter
  record.count++;
  return { 
    allowed: true, 
    remaining: maxRequests - record.count, 
    resetIn: record.resetTime - now 
  };
}

/**
 * Get client identifier for rate limiting
 */
export function getClientIdentifier(req: Request): string {
  // Try to get real IP from common headers
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfConnectingIp = req.headers.get("cf-connecting-ip");
  
  return cfConnectingIp || realIp || forwardedFor?.split(",")[0]?.trim() || "unknown";
}

/**
 * Validates that organization_id belongs to authenticated user
 */
export async function validateOrganizationAccess(
  supabase: ReturnType<typeof import("https://esm.sh/@supabase/supabase-js@2").createClient>,
  userId: string,
  organizationId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("team_members")
    .select("id")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  
  if (error) {
    console.error("[AUTH] Error validating organization access:", error);
    return false;
  }
  
  return !!data;
}

/**
 * Create unauthorized response
 */
export function unauthorizedResponse(
  message: string, 
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized", message }),
    { 
      status: 401, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    }
  );
}

/**
 * Persistent rate limiting via Supabase RPC (check_rate_limit)
 * Falls back to "allowed" on DB errors to avoid blocking requests.
 */
export async function checkRateLimitPersistent(
  supabase: any,
  key: string,
  maxRequests = 100,
  windowSeconds = 60
): Promise<{ allowed: boolean; remaining: number; resetAt: string }> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error("[AUTH] Persistent rate limit check failed:", error.message);
      return { allowed: true, remaining: maxRequests, resetAt: "" };
    }

    // RPC returns a single row as an array or object depending on client
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      console.warn("[AUTH] Persistent rate limit returned no data");
      return { allowed: true, remaining: maxRequests, resetAt: "" };
    }

    return {
      allowed: row.allowed,
      remaining: row.remaining,
      resetAt: row.reset_at ?? "",
    };
  } catch (err) {
    console.error("[AUTH] Persistent rate limit unexpected error:", err);
    return { allowed: true, remaining: maxRequests, resetAt: "" };
  }
}

/**
 * Create rate limited response
 */
export function rateLimitedResponse(
  resetIn: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message: "Rate limit exceeded",
      retryAfter: Math.ceil(resetIn / 1000)
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(resetIn / 1000))
      }
    }
  );
}

/**
 * Result of per-org API key validation
 */
export interface ApiKeyValidation {
  valid: boolean;
  organizationId?: string;
  keyId?: string;
  rateLimitPerMinute?: number;
  scopes?: string[];
  error?: string;
}

/**
 * Validates per-organization API keys (tq_live_*) stored as SHA-256 hashes.
 * Falls back to legacy single WEBHOOK_API_KEY for backward compatibility.
 *
 * Key extraction priority:
 *   1. X-Webhook-Key header
 *   2. X-API-Key header
 *   3. Authorization: Bearer tq_live_*
 */
export async function validateApiKey(
  supabase: any,
  req: Request
): Promise<ApiKeyValidation> {
  // --- Extract raw key from headers ---
  const rawKey =
    req.headers.get("x-webhook-key") ||
    req.headers.get("x-api-key") ||
    (() => {
      const auth = req.headers.get("authorization") || "";
      if (auth.startsWith("Bearer tq_live_")) return auth.slice(7); // strip "Bearer "
      return null;
    })();

  if (!rawKey) {
    return {
      valid: false,
      error: "API key obrigatória. Use o header X-API-Key ou X-Webhook-Key.",
    };
  }

  // --- Legacy: single shared key (no org context) ---
  if (!rawKey.startsWith("tq_live_")) {
    const legacyKey = Deno.env.get("WEBHOOK_API_KEY");
    if (legacyKey && rawKey === legacyKey) {
      return { valid: true };
    }
    return { valid: false, error: "API key inválida ou expirada" };
  }

  // --- Per-org tq_live_* key ---
  const prefix = rawKey.slice(0, 12);

  const { data: rows, error: dbError } = await supabase
    .from("api_keys")
    .select("id, organization_id, key_hash, rate_limit_per_minute, scopes")
    .eq("key_prefix", prefix)
    .eq("is_active", true)
    .or("expires_at.is.null,expires_at.gt.now()");

  if (dbError) {
    console.error("[AUTH] Error querying api_keys:", dbError);
    return { valid: false, error: "Erro interno ao validar API key" };
  }

  if (!rows || rows.length === 0) {
    return { valid: false, error: "API key inválida ou expirada" };
  }

  // Compute SHA-256 of the provided key using Web Crypto API (Deno-native)
  const encoder = new TextEncoder();
  const data = encoder.encode(rawKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Check each candidate row (prefix collisions are theoretically possible)
  for (const row of rows) {
    if (hashHex === row.key_hash) {
      // Fire-and-forget: update last_used_at
      supabase
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", row.id)
        .then(() => {})
        .catch((err: unknown) =>
          console.error("[AUTH] Failed to update last_used_at:", err)
        );

      return {
        valid: true,
        organizationId: row.organization_id,
        keyId: row.id,
        rateLimitPerMinute: row.rate_limit_per_minute,
        scopes: row.scopes ?? [],
      };
    }
  }

  return { valid: false, error: "API key inválida ou expirada" };
}
