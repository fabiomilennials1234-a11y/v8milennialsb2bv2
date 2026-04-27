/**
 * Retry Dead Letter Jobs — reprocessa jobs retrying e permite retry manual de dead letters
 *
 * Dois modos:
 * 1. Cron (pg_cron a cada 5min): busca jobs com status='retrying' e next_retry_at <= now()
 * 2. Manual (POST com job_id): reseta um dead_letter específico para running e re-executa
 *
 * Re-execução: despacha para o engine de origem via HTTP call.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { finishJob, failJob } from "../_shared/job-tracker.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// Engine → Edge Function mapping for re-dispatch
const ENGINE_FUNCTIONS: Record<string, string> = {
  pipe_dispatch: "pipe-rule-dispatch",
  copilot: "process-ai-actions",
};

Deno.serve(
  withSentry("retry-dead-letter-jobs", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth: cron secret OR bearer token (master admin)
    let isCron = false;
    const cronSecret = req.headers.get("x-cron-secret");
    if (CRON_SECRET && cronSecret === CRON_SECRET) {
      isCron = true;
    }
    // CRON_SECRET must be set in env — no fallback for missing secret

    if (!isCron) {
      // Check bearer token for manual retry
      try {
        const authHeader = req.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
        }
        const token = authHeader.slice(7);
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
          return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers });
        }
        // Check master
        const { data: masterRow } = await supabase
          .from("master_users")
          .select("id")
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle();
        if (!masterRow) {
          return new Response(JSON.stringify({ error: "Master admin required" }), { status: 403, headers });
        }
      } catch {
        return new Response(JSON.stringify({ error: "Auth failed" }), { status: 401, headers });
      }
    }

    // Parse body
    let jobId: string | null = null;
    try {
      const body = await req.json();
      if (body?.job_id && typeof body.job_id === "string") {
        jobId = body.job_id;
      }
    } catch {
      // No body — cron mode
    }

    try {
      if (jobId) {
        // === Manual retry of a specific dead letter ===
        const result = await retrySpecificJob(supabase, jobId);
        return new Response(JSON.stringify(result), { headers });
      } else {
        // === Cron mode: process retrying jobs + detect dead_letter pattern ===
        const result = await processRetryingJobs(supabase);
        const alerts = await detectDeadLetterPatterns(supabase);
        return new Response(JSON.stringify({ ...result, alerts_created: alerts }), { headers });
      }
    } catch (err) {
      console.error("[retry-dead-letter-jobs] Error:", err);
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
    }
  }),
);

/**
 * Onda 2 / T2.D.2 — Detecta padrões de dead_letter
 *
 * Pra cada combinação (org, action_type) com >=5 dead_letter nas últimas 24h,
 * cria 1 system_alert. Dedup: pula se já existe alert unresolved categoria
 * 'dead_letter_pattern' pra mesma source nas últimas 24h.
 */
async function detectDeadLetterPatterns(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  try {
    const { data: patterns, error } = await supabase
      .from("automation_jobs")
      .select("organization_id, action_type")
      .eq("status", "dead_letter")
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    if (error || !patterns) return 0;

    const counts = new Map<string, { org: string; action: string; count: number }>();
    for (const row of patterns as Array<{ organization_id: string; action_type: string }>) {
      const key = `${row.organization_id}|${row.action_type}`;
      const cur = counts.get(key) ?? { org: row.organization_id, action: row.action_type, count: 0 };
      cur.count++;
      counts.set(key, cur);
    }

    let created = 0;
    for (const { org, action, count } of counts.values()) {
      if (count < 5) continue;

      // Dedup: existe alert unresolved < 24h?
      const { data: existing } = await supabase
        .from("system_alerts")
        .select("id")
        .eq("category", "dead_letter_pattern")
        .eq("organization_id", org)
        .eq("source_type", "action_type")
        .is("resolved_at", null)
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .contains("metadata", { action_type: action })
        .limit(1)
        .maybeSingle();

      if (existing) continue;

      await supabase.from("system_alerts").insert({
        organization_id: org,
        severity: "warning",
        category: "dead_letter_pattern",
        source_type: "action_type",
        title: `Padrão de falha: ${action}`,
        message: `${count} ações ${action} entraram em dead_letter nas últimas 24h. Investigar root cause.`,
        metadata: { action_type: action, count, window_hours: 24 },
      });
      created++;
    }

    return created;
  } catch (err) {
    console.warn("[detectDeadLetterPatterns] non-fatal:", err);
    return 0;
  }
}

/**
 * Manual retry: reseta dead_letter → running, tenta re-executar
 */
async function retrySpecificJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
): Promise<{ success: boolean; message: string }> {
  // Fetch the job
  const { data: job, error: fetchErr } = await supabase
    .from("automation_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job) {
    return { success: false, message: "Job not found" };
  }

  if (job.status !== "dead_letter" && job.status !== "failed" && job.status !== "retrying") {
    return { success: false, message: `Job status is '${job.status}', cannot retry` };
  }

  // Reset job to running
  await supabase
    .from("automation_jobs")
    .update({
      status: "running",
      retry_count: 0,
      error_message: null,
      finished_at: null,
      next_retry_at: null,
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  // Re-dispatch based on source engine
  const dispatched = await redispatchJob(supabase, job);

  if (dispatched) {
    await finishJob(supabase, jobId);
    await logRuntime({
      organizationId: job.organization_id,
      module: "job_monitor",
      action: "manual_retry",
      status: "success",
      entityType: job.entity_type,
      entityId: job.entity_id,
      payloadSnapshot: { job_id: jobId, source_engine: job.source_engine, action_type: job.action_type },
    });
    return { success: true, message: "Job retried successfully" };
  } else {
    await failJob(supabase, jobId, "Re-dispatch failed");
    return { success: false, message: "Re-dispatch failed" };
  }
}

/**
 * Cron mode: busca jobs com status='retrying' e next_retry_at <= now
 */
async function processRetryingJobs(
  supabase: ReturnType<typeof createClient>,
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const { data: jobs, error } = await supabase
    .from("automation_jobs")
    .select("*")
    .eq("status", "retrying")
    .lte("next_retry_at", new Date().toISOString())
    .order("next_retry_at", { ascending: true })
    .limit(20);

  if (error || !jobs || jobs.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0, failedCount = 0;

  for (const job of jobs) {
    // Mark as running
    await supabase
      .from("automation_jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id);

    const dispatched = await redispatchJob(supabase, job);

    if (dispatched) {
      await finishJob(supabase, job.id);
      succeeded++;
    } else {
      await failJob(supabase, job.id, "Retry re-dispatch failed");
      failedCount++;
    }
  }

  if (jobs.length > 0) {
    await logRuntime({
      module: "job_monitor",
      action: "cron_retry",
      status: "success",
      payloadSnapshot: { processed: jobs.length, succeeded, failed: failedCount },
    });
  }

  return { processed: jobs.length, succeeded, failed: failedCount };
}

/**
 * Re-dispatch a job by calling the appropriate Edge Function.
 * For pipe_dispatch: re-processes the source scheduled_pipe_message.
 * For copilot: re-processes the source pending_ai_action.
 */
async function redispatchJob(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<boolean> {
  try {
    const sourceEngine = job.source_engine as string;
    const sourceTable = job.source_table as string | null;
    const sourceId = job.source_id as string | null;

    if (sourceEngine === "pipe_dispatch" && sourceTable === "scheduled_pipe_messages" && sourceId) {
      // Reset the scheduled_pipe_message to scheduled so it gets re-claimed
      const { error } = await supabase
        .from("scheduled_pipe_messages")
        .update({
          status: "scheduled",
          error_message: null,
          scheduled_at: new Date().toISOString(),
        })
        .eq("id", sourceId);

      if (error) {
        console.error("[retry-dead-letter-jobs] Reset pipe message failed:", error.message);
        return false;
      }

      // Trigger pipe dispatch
      const functionName = ENGINE_FUNCTIONS[sourceEngine];
      if (functionName) {
        try {
          const { data: cronConfig } = await supabase
            .from("cron_config")
            .select("value")
            .eq("key", "cron_secret")
            .single();

          await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cron-secret": cronConfig?.value || "",
            },
            body: JSON.stringify({}),
          });
        } catch {
          // Fire and forget — the cron will pick it up anyway
        }
      }
      return true;

    } else if (sourceEngine === "copilot" && sourceTable === "pending_ai_actions" && sourceId) {
      // Reset the pending_ai_action to pending so it gets re-claimed
      const { error } = await supabase
        .from("pending_ai_actions")
        .update({
          status: "pending",
          retry_count: 0,
          error_message: null,
          next_retry_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sourceId);

      if (error) {
        console.error("[retry-dead-letter-jobs] Reset AI action failed:", error.message);
        return false;
      }
      return true;

    } else {
      // Unknown engine or missing source — can't re-dispatch automatically
      console.warn(`[retry-dead-letter-jobs] No re-dispatch strategy for engine '${sourceEngine}'`);
      return true; // Mark as success since there's nothing to retry
    }
  } catch (err) {
    console.error("[retry-dead-letter-jobs] redispatchJob error:", err);
    return false;
  }
}
