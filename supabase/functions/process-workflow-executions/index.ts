/**
 * Worker: Process workflow executions
 *
 * - Called by pg_cron every 1 minute via pg_net
 * - Also callable directly for immediate execution
 * - Modes:
 *   - default: claim batch of pending executions and process them
 *   - cron_triggers: fire cron-type workflow triggers
 *   - fire_trigger: fire a specific trigger (called by other Edge Functions)
 * - Integrates with job-tracker for automation_jobs tracking
 * - Retry: up to 3 attempts via job-tracker backoff
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import { startJob, finishJob, failJob } from "../_shared/job-tracker.ts";
import { executeWorkflow } from "../_shared/workflow-executor.ts";
import { fireTrigger, processCronTriggers, matchesTriggerConfig } from "../_shared/workflow-trigger.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH_SIZE = 20;

Deno.serve(
  withSentry("process-workflow-executions", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth: cron secret or service role
    const cronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("authorization");
    const isAuthorized =
      (CRON_SECRET && cronSecret === CRON_SECRET) ||
      (authHeader && authHeader.includes(SUPABASE_SERVICE_ROLE_KEY));

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    try {
      // Parse mode from body
      let mode = "default";
      let triggerParams: Record<string, unknown> | null = null;

      try {
        const body = await req.json();
        mode = body.mode || "default";
        if (mode === "fire_trigger") {
          triggerParams = body;
        }
      } catch {
        // No body or invalid JSON — use default mode
      }

      // ── Mode: cron_triggers ──
      if (mode === "cron_triggers") {
        const cronCount = await processCronTriggers(supabase);
        const periodicCount = await processPeriodicTriggers(supabase);
        return new Response(JSON.stringify({
          mode: "cron_triggers",
          cron_triggered: cronCount,
          periodic_triggered: periodicCount,
        }), { headers });
      }

      // ── Mode: fire_trigger ──
      if (mode === "fire_trigger" && triggerParams) {
        const count = await fireTrigger({
          supabase,
          organizationId: triggerParams.organization_id as string,
          triggerType: triggerParams.trigger_type as string,
          leadId: triggerParams.lead_id as string,
          context: (triggerParams.context as Record<string, unknown>) || {},
        });

        return new Response(JSON.stringify({ mode: "fire_trigger", triggered: count }), { headers });
      }

      // ── Mode: default — process pending executions ──
      const stats = { claimed: 0, completed: 0, failed: 0, paused: 0 };

      // 1. Claim batch
      const { data: executions, error: claimError } = await supabase.rpc("claim_workflow_executions", {
        batch_size: BATCH_SIZE,
      });

      if (claimError) {
        console.error("[process-workflow-executions] Claim RPC failed:", claimError);
        await logRuntime({
          module: "workflow",
          action: "claim_executions",
          status: "error",
          errorMessage: claimError.message,
        });
        return new Response(JSON.stringify({ error: "Claim failed", detail: claimError.message }), {
          status: 500,
          headers,
        });
      }

      if (!executions || executions.length === 0) {
        return new Response(JSON.stringify({ message: "No pending executions", stats }), { headers });
      }

      stats.claimed = executions.length;
      console.log(`[process-workflow-executions] Claimed ${executions.length} executions`);

      // 2. Process each execution
      for (const execution of executions) {
        await processExecution(supabase, execution, stats);
      }

      console.log("[process-workflow-executions] Batch complete:", stats);
      await logRuntime({
        module: "workflow",
        action: "process_batch",
        status: "success",
        payloadSnapshot: stats,
      });

      return new Response(JSON.stringify({ success: true, stats }), { headers });
    } catch (err) {
      console.error("[process-workflow-executions] Unexpected error:", err);
      await logRuntime({
        module: "workflow",
        action: "process_batch",
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers });
    }
  }),
);

async function processExecution(
  supabase: ReturnType<typeof createClient>,
  execution: Record<string, unknown>,
  stats: { claimed: number; completed: number; failed: number; paused: number },
): Promise<void> {
  const executionId = execution.id as string;
  const workflowId = execution.workflow_id as string;
  const organizationId = execution.organization_id as string;
  const leadId = execution.lead_id as string;
  const currentNodeId = execution.current_node_id as string | null;
  const loopCounters = (execution.loop_counters as Record<string, number>) || {};
  const context = (execution.context as Record<string, unknown>) || {};

  let jobId: string | null = null;

  try {
    // Fetch workflow definition + trigger_config for condition validation
    const { data: workflow, error: wfError } = await supabase
      .from("workflows")
      .select("definition, loop_limit, is_active, name, trigger_type, trigger_config")
      .eq("id", workflowId)
      .maybeSingle();

    if (wfError || !workflow) {
      console.error(`[process-workflow-executions] Workflow ${workflowId} not found`);
      await supabase.from("workflow_executions").update({
        status: "failed",
        error: "Workflow not found or deleted",
        completed_at: new Date().toISOString(),
      }).eq("id", executionId);
      stats.failed++;
      return;
    }

    if (!workflow.is_active) {
      await supabase.from("workflow_executions").update({
        status: "failed",
        error: "Workflow is disabled",
        completed_at: new Date().toISOString(),
      }).eq("id", executionId);
      stats.failed++;
      return;
    }

    // Validate trigger_config conditions (origin, pipe, stage, etc.)
    // The PG fire_workflow_trigger() creates executions for ALL active workflows
    // of a trigger type without filtering — this is the gate that enforces conditions.
    if (workflow.trigger_type && workflow.trigger_config && !currentNodeId) {
      const triggerConfig = workflow.trigger_config as Record<string, unknown>;
      if (!matchesTriggerConfig(workflow.trigger_type, triggerConfig, context)) {
        console.log(
          `[process-workflow-executions] Skipping execution ${executionId}: ` +
          `trigger_config mismatch for ${workflow.trigger_type} (workflow: ${workflow.name})`,
        );
        await supabase.from("workflow_executions").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          error: "Skipped: trigger conditions not met",
        }).eq("id", executionId);
        stats.completed++;
        return;
      }
    }

    // Start job tracking
    jobId = await startJob(supabase, {
      organizationId,
      sourceEngine: "workflow",
      entityType: "lead",
      entityId: leadId || executionId,
      actionType: `workflow:${workflow.name || workflowId}`,
      sourceTable: "workflow_executions",
      sourceId: executionId,
      payloadSnapshot: { workflow_id: workflowId, trigger: context.trigger_type },
    });

    // Execute workflow
    const result = await executeWorkflow({
      supabase,
      executionId,
      workflowId,
      organizationId,
      leadId,
      definition: workflow.definition as { nodes: { id: string; type: string; data: Record<string, unknown> }[]; edges: { id: string; source: string; target: string; sourceHandle?: string | null; data?: { loopLimit?: number } }[] },
      loopLimit: workflow.loop_limit || 100,
      context,
      currentNodeId,
      loopCounters,
    });

    if (result.success) {
      if (result.status === "paused" || result.status === "waiting_response") {
        stats.paused++;
        // Don't finish the job — it will be picked up again
        if (jobId) await finishJob(supabase, jobId);
      } else {
        stats.completed++;
        if (jobId) await finishJob(supabase, jobId);
      }

      // Track usage event
      trackEvent({
        organizationId,
        eventType: "workflow_triggered",
        entityType: "workflow",
        entityId: workflowId,
        metadata: {
          execution_id: executionId,
          lead_id: leadId,
          status: result.status,
          steps: result.stepsExecuted,
        },
      }).catch(() => {});
    } else {
      stats.failed++;
      if (jobId) await failJob(supabase, jobId, result.error || "Unknown error");

      await logRuntime({
        organizationId,
        module: "workflow",
        action: `execute:${workflow.name || workflowId}`,
        status: "error",
        errorMessage: result.error,
        entityType: "lead",
        entityId: leadId,
        payloadSnapshot: { execution_id: executionId, status: result.status },
      });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[process-workflow-executions] Execution ${executionId} threw:`, err);

    if (jobId) await failJob(supabase, jobId, errMsg);

    // Mark execution as failed
    await supabase.from("workflow_executions").update({
      status: "failed",
      error: errMsg,
      completed_at: new Date().toISOString(),
    }).eq("id", executionId);

    stats.failed++;
  }
}

/**
 * Process periodic triggers that need time-based checks:
 * - lead_no_reply: leads that haven't replied within timeout_hours
 * - meeting_not_confirmed: meetings within hours_before without confirmation
 * - followup_overdue: follow_ups past due_date without completed_at
 */
async function processPeriodicTriggers(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  let count = 0;

  try {
    // ── lead_no_reply ──
    const { data: noReplyWorkflows } = await supabase
      .from("workflows")
      .select("id, organization_id, trigger_config")
      .eq("trigger_type", "lead_no_reply")
      .eq("is_active", true);

    if (noReplyWorkflows?.length) {
      for (const wf of noReplyWorkflows) {
        const config = wf.trigger_config as { timeout_hours?: number };
        const timeoutHours = config.timeout_hours || 24;
        const cutoff = new Date(Date.now() - timeoutHours * 3_600_000).toISOString();

        // Find leads with last outbound message before cutoff and no inbound since
        const { data: candidates } = await supabase.rpc("find_leads_no_reply", {
          p_organization_id: wf.organization_id,
          p_cutoff: cutoff,
          p_limit: 50,
        }).catch(() => ({ data: null }));

        // Fallback: if RPC doesn't exist, skip
        if (candidates) {
          for (const lead of candidates) {
            // Check no existing execution for this workflow+lead in last 24h
            const { count: existingCount } = await supabase
              .from("workflow_executions")
              .select("*", { count: "exact", head: true })
              .eq("workflow_id", wf.id)
              .eq("lead_id", lead.id)
              .gte("started_at", cutoff);

            if ((existingCount ?? 0) === 0) {
              await supabase.from("workflow_executions").insert({
                workflow_id: wf.id,
                organization_id: wf.organization_id,
                lead_id: lead.id,
                status: "running",
                context: { trigger_type: "lead_no_reply", timeout_hours: timeoutHours },
              });
              count++;
            }
          }
        }
      }
    }

    // ── meeting_not_confirmed ──
    const { data: meetingWorkflows } = await supabase
      .from("workflows")
      .select("id, organization_id, trigger_config")
      .eq("trigger_type", "meeting_not_confirmed")
      .eq("is_active", true);

    if (meetingWorkflows?.length) {
      for (const wf of meetingWorkflows) {
        const config = wf.trigger_config as { hours_before?: number };
        const hoursBefore = config.hours_before || 24;
        const windowStart = new Date().toISOString();
        const windowEnd = new Date(Date.now() + hoursBefore * 3_600_000).toISOString();

        const { data: unconfirmed } = await supabase
          .from("pipe_confirmacao")
          .select("lead_id")
          .eq("organization_id", wf.organization_id)
          .or("is_confirmed.is.null,is_confirmed.eq.false")
          .gte("meeting_date", windowStart)
          .lte("meeting_date", windowEnd)
          .limit(50);

        if (unconfirmed?.length) {
          for (const row of unconfirmed) {
            const { count: existingCount } = await supabase
              .from("workflow_executions")
              .select("*", { count: "exact", head: true })
              .eq("workflow_id", wf.id)
              .eq("lead_id", row.lead_id)
              .gte("started_at", new Date(Date.now() - 24 * 3_600_000).toISOString());

            if ((existingCount ?? 0) === 0 && row.lead_id) {
              await supabase.from("workflow_executions").insert({
                workflow_id: wf.id,
                organization_id: wf.organization_id,
                lead_id: row.lead_id,
                status: "running",
                context: { trigger_type: "meeting_not_confirmed", hours_before: hoursBefore },
              });
              count++;
            }
          }
        }
      }
    }

    // ── followup_overdue ──
    const { data: followupWorkflows } = await supabase
      .from("workflows")
      .select("id, organization_id")
      .eq("trigger_type", "followup_overdue")
      .eq("is_active", true);

    if (followupWorkflows?.length) {
      for (const wf of followupWorkflows) {
        const { data: overdue } = await supabase
          .from("follow_ups")
          .select("lead_id")
          .lt("due_date", new Date().toISOString())
          .is("completed_at", null)
          .limit(50);

        if (overdue?.length) {
          for (const row of overdue) {
            if (!row.lead_id) continue;
            const { count: existingCount } = await supabase
              .from("workflow_executions")
              .select("*", { count: "exact", head: true })
              .eq("workflow_id", wf.id)
              .eq("lead_id", row.lead_id)
              .gte("started_at", new Date(Date.now() - 24 * 3_600_000).toISOString());

            if ((existingCount ?? 0) === 0) {
              await supabase.from("workflow_executions").insert({
                workflow_id: wf.id,
                organization_id: wf.organization_id,
                lead_id: row.lead_id,
                status: "running",
                context: { trigger_type: "followup_overdue" },
              });
              count++;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[process-workflow-executions] Periodic triggers error:", err);
  }

  return count;
}
