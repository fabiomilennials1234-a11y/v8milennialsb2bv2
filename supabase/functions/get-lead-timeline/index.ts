/**
 * Get Lead Timeline — retorna histórico paginado de um lead com filtros e métricas.
 *
 * Auth: requireAuth() — usuário deve pertencer à organização do lead.
 * Query params: lead_id, source, period, search, page, page_size
 */

import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { requireAuth, AuthError, authErrorResponse } from "../_shared/user-auth.ts";
import { logRuntime } from "../_shared/logger.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PIPELINE_ACTIONS = [
  "stage_changed",
  "proposal_created",
  "proposal_status_changed",
  "proposal_deleted",
];

function getPeriodStart(period: string): string | null {
  if (period === "all" || !period) return null;
  const now = new Date();
  if (period === "today") {
    now.setHours(0, 0, 0, 0);
  } else if (period === "week") {
    now.setDate(now.getDate() - 7);
    now.setHours(0, 0, 0, 0);
  } else if (period === "month") {
    now.setMonth(now.getMonth() - 1);
    now.setHours(0, 0, 0, 0);
  }
  return now.toISOString();
}

Deno.serve(
  withSentry("get-lead-timeline", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth
    let auth;
    try {
      auth = await requireAuth(req);
    } catch (err) {
      if (err instanceof AuthError) return authErrorResponse(err, corsHeaders);
      return new Response(JSON.stringify({ error: "Auth failed" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(req.url);

    const leadId = url.searchParams.get("lead_id");
    if (!leadId) {
      return new Response(JSON.stringify({ error: "lead_id obrigatório" }), { status: 400, headers });
    }

    // Verify lead belongs to user's organization
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, organization_id")
      .eq("id", leadId)
      .maybeSingle();

    if (leadError || !lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado" }), { status: 404, headers });
    }

    if (lead.organization_id !== auth.organizationId && !auth.isMaster) {
      return new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403, headers });
    }

    // Parse filters
    const source = url.searchParams.get("source") || "all";
    const period = url.searchParams.get("period") || "all";
    const search = url.searchParams.get("search") || "";
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("page_size") || "20", 10)));

    // Build filtered query
    let q = supabase
      .from("lead_history")
      .select("id, action, description, source, metadata, entity_type, entity_id, created_at, created_by", { count: "exact" })
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false });

    if (source !== "all") {
      if (source === "pipeline") {
        q = q.in("action", PIPELINE_ACTIONS);
      } else {
        q = q.eq("source", source);
      }
    }

    const periodStart = getPeriodStart(period);
    if (periodStart) {
      q = q.gte("created_at", periodStart);
    }

    if (search.trim()) {
      q = q.ilike("description", `%${search.trim()}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    q = q.range(from, to);

    const { data: events, error: eventsError, count } = await q;
    if (eventsError) {
      await logRuntime({ organizationId: auth.organizationId, module: "lead", action: "get_timeline", status: "error", errorMessage: eventsError.message });
      return new Response(JSON.stringify({ error: "Erro ao buscar histórico" }), { status: 500, headers });
    }

    const totalFiltered = count ?? 0;

    // Metrics (only page 1)
    let metrics = null;
    if (page === 1) {
      const { data: allHistory, count: totalCount } = await supabase
        .from("lead_history")
        .select("source, created_at", { count: "exact" })
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });

      const total = totalCount ?? 0;
      const first = allHistory?.[0]?.created_at;
      const last = allHistory?.[allHistory.length - 1]?.created_at;

      const sourceCounts: Record<string, number> = {};
      for (const item of allHistory || []) {
        const src = (item as Record<string, unknown>).source as string || "manual";
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;
      }

      let topSource: string | null = null;
      let topCount = 0;
      for (const [src, cnt] of Object.entries(sourceCounts)) {
        if (cnt > topCount) {
          topSource = src;
          topCount = cnt;
        }
      }

      const daysSinceFirstContact = first
        ? Math.floor((Date.now() - new Date(first).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      metrics = { total, daysSinceFirstContact, lastContact: last || null, topSource };
    }

    await logRuntime({
      organizationId: auth.organizationId,
      module: "lead",
      action: "get_timeline",
      status: "success",
      entityType: "lead",
      entityId: leadId,
      payloadSnapshot: { source, period, page, results: events?.length ?? 0 },
    });

    return new Response(
      JSON.stringify({
        events: events || [],
        metrics,
        hasMore: totalFiltered > page * pageSize,
        totalFiltered,
      }),
      { status: 200, headers },
    );
  }),
);
