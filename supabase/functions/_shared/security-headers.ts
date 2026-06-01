/**
 * Security headers for Supabase Edge Functions responses
 * Per project rules: always prioritize security headers when coding
 * @see https://owasp.org/www-project-secure-headers/
 */

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

/**
 * Merge security headers with existing headers (CORS, Content-Type, etc.)
 */
export function withSecurityHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...SECURITY_HEADERS, ...headers };
}
