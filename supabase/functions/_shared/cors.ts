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

  let corsOrigin = "*";

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
    }
  } else if (allowedOrigins) {
    corsOrigin = allowedOrigins.split(",")[0].trim();
  }

  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-webhook-key, x-api-key, x-api-version",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}
