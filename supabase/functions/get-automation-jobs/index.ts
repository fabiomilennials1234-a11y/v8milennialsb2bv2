/**
 * Get Automation Jobs — API para o Operations Center (Master Admin)
 *
 * Retorna lista paginada de automation_jobs com filtros.
 * Também retorna overview (cards de resumo) quando ?overview=true.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(
  withSentry("get-automation-jobs", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth: apenas master admin
    let auth;
    try {
      auth = await requireAuth(req);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err, corsHeaders);
      return new Response(JSON.stringify({ error: "Auth failed" }), { status: 401, headers });
    }

    if (!auth.isMaster) {
      return new Response(JSON.stringify({ error: "Apenas master admin" }), { status: 403, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);

    // --- Mode: overview ---
    if (url.searchParams.get("overview") === "true") {
      const interval = url.searchParams.get("interval") || "24 hours";
      const { data, error } = await supabase.rpc("get_jobs_overview", {
        interval_param: interval,
      });
      if (error) {
        await logRuntime({ module: "general", action: "list_jobs_overview", status: "error", errorMessage: error.message });
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }
      return new Response(JSON.stringify(data), { headers });
    }

    // --- Mode: list ---
    const status = url.searchParams.get("status") || "";
    const sourceEngine = url.searchParams.get("source_engine") || "";
    const organizationId = url.searchParams.get("organization_id") || "";
    const interval = url.searchParams.get("interval") || "24 hours";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Calculate time threshold
    const intervalMs = parseInterval(interval);
    const since = new Date(Date.now() - intervalMs).toISOString();

    // Count query
    let countQuery = supabase
      .from("automation_jobs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);

    if (status) countQuery = countQuery.eq("status", status);
    if (sourceEngine) countQuery = countQuery.eq("source_engine", sourceEngine);
    if (organizationId) countQuery = countQuery.eq("organization_id", organizationId);

    const { count, error: countError } = await countQuery;
    if (countError) {
      await logRuntime({ module: "general", action: "list_jobs", status: "error", errorMessage: countError.message });
      return new Response(JSON.stringify({ error: countError.message }), { status: 500, headers });
    }

    // Data query
    let query = supabase
      .from("automation_jobs")
      .select("*, organization:organizations(name)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (sourceEngine) query = query.eq("source_engine", sourceEngine);
    if (organizationId) query = query.eq("organization_id", organizationId);

    const { data: jobs, error: queryError } = await query;
    if (queryError) {
      await logRuntime({ module: "general", action: "list_jobs", status: "error", errorMessage: queryError.message });
      return new Response(JSON.stringify({ error: queryError.message }), { status: 500, headers });
    }

    await logRuntime({
      organizationId: organizationId || undefined,
      module: "general",
      action: "list_jobs",
      status: "success",
      payloadSnapshot: { total: count ?? 0, limit, offset },
    });

    return new Response(
      JSON.stringify({ jobs: jobs ?? [], total: count ?? 0 }),
      { headers },
    );
  }),
);

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)\s*(hour|day|minute)/i);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("minute")) return value * 60 * 1000;
  if (unit.startsWith("hour")) return value * 60 * 60 * 1000;
  if (unit.startsWith("day")) return value * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}
