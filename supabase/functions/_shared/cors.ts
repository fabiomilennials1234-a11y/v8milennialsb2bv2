/**
 * CORS helper for Supabase Edge Functions
 * 
 * SECURITY: Use specific origins in production instead of "*"
 * Configure allowed origins via environment variable ALLOWED_ORIGINS
 */

export function getCorsHeaders(origin?: string | null): Record<string, string> {
  // In production, use specific origins from environment variable
  // Format: "https://example.com,https://app.example.com"
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS");

  // SECURITY: Default to rejecting unknown origins (null origin) instead of "*".
  // Only allow "*" as a last resort when no ALLOWED_ORIGINS is configured AND
  // the request has no origin header (e.g. server-to-server calls).
  let corsOrigin = "null";

  if (origin) {
    const isLocalhost =
      origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:");
    if (isLocalhost) {
      corsOrigin = origin;
    } else if (allowedOrigins) {
      const origins = allowedOrigins.split(",").map((o) => o.trim());
      if (origins.includes(origin)) {
        corsOrigin = origin;
      }
      // If origin is not in the allowed list, corsOrigin stays "null" → browser rejects
    }
    // If no ALLOWED_ORIGINS configured and not localhost, corsOrigin stays "null"
  } else if (allowedOrigins) {
    // No origin header (server-to-server) — use first allowed origin
    corsOrigin = allowedOrigins.split(",")[0].trim();
  }
  // else: no origin and no ALLOWED_ORIGINS → corsOrigin = "null" (reject)

  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-api-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}
