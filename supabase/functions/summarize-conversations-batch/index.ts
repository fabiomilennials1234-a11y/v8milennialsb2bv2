import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronAuth } from "../_shared/auth.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { processSummaryBatch, type SummaryJob } from "../_shared/oraculo/summary-batch.ts";

interface ClaimedRow {
  id: string;
  lead_id: string;
  instance_id: string;
}

Deno.serve(withErrorBoundary("summarize-conversations-batch", async (req) => {
  const headers = withSecurityHeaders({
    ...getCorsHeaders(req.headers.get("origin")),
    "Content-Type": "application/json",
  });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!requireCronAuth(req).authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase environment is incomplete");
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let requestedLimit = 10;
  try {
    const body = await req.json();
    if (typeof body?.limit === "number") requestedLimit = body.limit;
  } catch {
    // Corpo opcional. Teto continua aplicado no núcleo.
  }

  const result = await processSummaryBatch({
    claim: async (limit): Promise<SummaryJob[]> => {
      const { data, error } = await db.rpc("claim_conversation_summary_jobs", { p_limit: limit });
      if (error) throw new Error("Falha ao reservar conversas para resumo");
      return ((data ?? []) as ClaimedRow[]).map((row) => ({
        id: row.id,
        leadId: row.lead_id,
        instanceId: row.instance_id,
      }));
    },
    summarize: async (job) => {
      const response = await fetch(`${supabaseUrl}/functions/v1/summarize-conversation`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: job.leadId,
          instance_id: job.instanceId,
          force_regenerate: true,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.saved === false) {
        throw new Error(
          typeof body?.error === "string" ? body.error : `Resumo falhou: HTTP ${response.status}`,
        );
      }
    },
    finish: async (jobId, errorMessage) => {
      const { error } = await db.rpc("finish_conversation_summary_job", {
        p_job_id: jobId,
        p_error: errorMessage,
      });
      if (error) throw new Error("Falha ao finalizar job de resumo");
    },
  }, requestedLimit);

  return new Response(JSON.stringify({ success: true, stats: result }), { status: 200, headers });
}));
