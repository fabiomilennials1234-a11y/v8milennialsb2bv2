/**
 * Authentication helpers for Supabase Edge Functions
 * 
 * SECURITY: Validates webhook requests to prevent unauthorized access
 */

import { createHmac } from "https://deno.land/std@0.177.0/node/crypto.ts";

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
 * Validates Evolution API webhook requests
 * Checks for API key in header
 */
export function validateEvolutionWebhook(req: Request): AuthResult {
  const apiKey = req.headers.get("apikey") || req.headers.get("x-api-key");
  const expectedKey = Deno.env.get("EVOLUTION_WEBHOOK_SECRET");
  
  // If no secret configured, allow but log warning (for backward compatibility)
  if (!expectedKey) {
    console.warn("[AUTH] EVOLUTION_WEBHOOK_SECRET not configured - webhook authentication disabled");
    return { valid: true };
  }
  
  if (!apiKey) {
    return { valid: false, error: "Missing API key in request headers" };
  }
  
  if (apiKey !== expectedKey) {
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
  
  if (signature !== expectedSignature && signature !== `sha256=${expectedSignature}`) {
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
  
  if (apiKey !== expectedKey) {
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
