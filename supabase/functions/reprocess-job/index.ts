/**
 * Onda 2 Fase E / F-E.1 — reprocess-job
 *
 * Master-only endpoint que reseta um job dead_letter / failed para retry.
 * Suporta 3 tipos:
 *   - pending_ai_action  → status='pending', retry_count=0, next_retry_at=null
 *   - workflow_execution → status='running', updated_at=null
 *   - automation_job     → status='retrying', next_retry_at=now()
 *
 * Auth: bearer token de usuário master_users.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface ReprocessPayload {
  type: "pending_ai_action" | "workflow_execution" | "automation_job";
  id: string;
}

Deno.serve(
  withErrorBoundary("reprocess-job", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth: bearer token + master_users check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Missing Authorization Bearer" }), { status: 401, headers });
    }
    const token = authHeader.slice(7);

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers });
    }

    const { data: masterRow } = await supabase
      .from("master_users")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (!masterRow) {
      return new Response(JSON.stringify({ error: "Master access required" }), { status: 403, headers });
    }

    let payload: ReprocessPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers });
    }

    if (!payload?.type || !payload?.id) {
      return new Response(JSON.stringify({ error: "type and id required" }), { status: 400, headers });
    }

    let updateError: { message: string } | null = null;

    if (payload.type === "pending_ai_action") {
      const { error } = await supabase
        .from("pending_ai_actions")
        .update({
          status: "pending",
          retry_count: 0,
          next_retry_at: null,
          error_message: null,
          processed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.id);
      updateError = error ? { message: error.message } : null;
    } else if (payload.type === "workflow_execution") {
      const { error } = await supabase
        .from("workflow_executions")
        .update({
          status: "running",
          error: null,
          next_run_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", payload.id);
      updateError = error ? { message: error.message } : null;
    } else if (payload.type === "automation_job") {
      const { error } = await supabase
        .from("automation_jobs")
        .update({
          status: "retrying",
          next_retry_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", payload.id);
      updateError = error ? { message: error.message } : null;
    } else {
      return new Response(JSON.stringify({ error: `Unsupported type: ${payload.type}` }), { status: 400, headers });
    }

    if (updateError) {
      return new Response(JSON.stringify({ error: "Update failed", detail: updateError.message }), {
        status: 500,
        headers,
      });
    }

    await logRuntime({
      module: "copilot",
      action: `reprocess:${payload.type}`,
      status: "success",
      entityType: payload.type,
      entityId: payload.id,
      triggeredBy: userData.user.id,
      payloadSnapshot: { master_user: userData.user.email },
    });

    return new Response(
      JSON.stringify({ success: true, type: payload.type, id: payload.id }),
      { status: 200, headers },
    );
  }),
);
