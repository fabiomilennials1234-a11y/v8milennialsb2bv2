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
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { checkRateLimit, validateApiKey } from "../_shared/auth.ts";
import { apiResource } from "../_shared/api/responses.ts";
import { handleApiRequest, type ApiRoute } from "../_shared/api/router.ts";
import { getLead, getLeadTimeline, listLeads } from "../_shared/api/routes/leads.ts";
import { listCustomFields, listPipelines, listTags } from "../_shared/api/routes/catalogs.ts";
import {
  addLeadTags,
  moveLeadStage,
  patchLead,
  putCustomFields,
  removeLeadTag,
} from "../_shared/api/routes/leads-write.ts";

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
  { method: "GET", pattern: "/api/v1/leads", scope: "lead:read", handler: listLeads },
  { method: "GET", pattern: "/api/v1/leads/{id}", scope: "lead:read", handler: getLead },
  { method: "GET", pattern: "/api/v1/leads/{id}/timeline", scope: "lead:read", handler: getLeadTimeline },
  { method: "GET", pattern: "/api/v1/pipelines", scope: "pipeline:read", handler: listPipelines },
  { method: "GET", pattern: "/api/v1/tags", scope: "metadata:read", handler: listTags },
  { method: "GET", pattern: "/api/v1/custom-fields", scope: "metadata:read", handler: listCustomFields },
  // P2 — writes (lead:write)
  { method: "PATCH", pattern: "/api/v1/leads/{id}", scope: "lead:write", handler: patchLead },
  { method: "POST", pattern: "/api/v1/leads/{id}/stage", scope: "lead:write", handler: moveLeadStage },
  { method: "POST", pattern: "/api/v1/leads/{id}/tags", scope: "lead:write", handler: addLeadTags },
  { method: "DELETE", pattern: "/api/v1/leads/{id}/tags/{tag}", scope: "lead:write", handler: removeLeadTag },
  { method: "PUT", pattern: "/api/v1/leads/{id}/custom-fields", scope: "lead:write", handler: putCustomFields },
];

Deno.serve(
  withErrorBoundary("api", async (req) => {
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
