/**
 * Public REST API — `/api/v1/*` (ADR-0008).
 *
 * Single path-based router edge function. Thin wiring only: CORS/OPTIONS,
 * Supabase service_role client, and the real API-key validator + rate limiter
 * injected into the tested `handleApiRequest` front controller.
 *
 * Multi-tenancy: runs as service_role and resolves `organization_id` from the
 * API key (fail-closed). Every route handler MUST scope queries by it — RLS
 * does not protect this path alone.
 */
import { withSentry } from "../_shared/sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { checkRateLimit, validateApiKey } from "../_shared/auth.ts";
import { apiResource } from "../_shared/api/responses.ts";
import { handleApiRequest, type ApiRoute } from "../_shared/api/router.ts";

const routes: ApiRoute[] = [
  {
    method: "GET",
    pattern: "/api/v1/ping",
    scope: null, // authenticated, no specific scope — smoke check for partners
    handler: (ctx) =>
      Promise.resolve(
        apiResource(
          {
            pong: true,
            organization_id: ctx.organizationId,
            timestamp: new Date().toISOString(),
          },
          ctx.cors,
        ),
      ),
  },
];

Deno.serve(
  withSentry("api", async (req) => {
    const origin = req.headers.get("Origin") ?? undefined;
    const cors = withSecurityHeaders(getCorsHeaders(origin));

    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: cors });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    return handleApiRequest(req, {
      routes,
      cors,
      supabase,
      authenticate: (r) => validateApiKey(supabase, r),
      checkLimit: (key, limit) => {
        const rl = checkRateLimit(key, limit, 60_000);
        return { allowed: rl.allowed, resetIn: rl.resetIn };
      },
    });
  }),
);
