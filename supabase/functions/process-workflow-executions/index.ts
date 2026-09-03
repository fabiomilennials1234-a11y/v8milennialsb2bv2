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
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { trackEvent } from "../_shared/track.ts";
import { startJob, finishJob, failJob } from "../_shared/job-tracker.ts";
import { executeWorkflow } from "../_shared/workflow-executor.ts";
import { fireTrigger, processCronTriggers, processScheduledDateTriggers, matchesTriggerConfig } from "../_shared/workflow-trigger.ts";
import { tryResolvePipelineId } from "../_shared/pipeline-adapter.ts";
import { getOrgDefaultPipelineRef } from "../_shared/pipeline-destination.ts";
import { requireCronAuth } from "../_shared/auth.ts";
import { assertPlanFeature, PlanFeatureDeniedError } from "../_shared/plan-gate.ts";
import {
  readPoolConfig,
  persistPoolDecision,
  releaseClaimed,
  runWithPool,
  decidePool,
  CONTROLLER,
  RPC_PER_ORG_CAP,
} from "../_shared/workflow-dispatch-pool.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";


Deno.serve(
  withErrorBoundary("process-workflow-executions", async (req: Request): Promise<Response> => {
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const authHeader = req.headers.get("authorization");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let authMode: "cron" | "jwt" | null = null;
    if (requireCronAuth(req).authorized) {
      authMode = "cron";
    } else if (authHeader?.startsWith("Bearer ")) {
      try {
        const { data: { user } } = await supabase.auth.getUser(authHeader.slice(7));
        if (user) authMode = "jwt";
      } catch { /* invalid token */ }
    }

    try {
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

      // JWT auth only allowed for fire_trigger mode
      if (!authMode || (authMode === "jwt" && mode !== "fire_trigger")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      }

      // ── Mode: cron_triggers ──
      if (mode === "cron_triggers") {
        const cronCount = await processCronTriggers(supabase);
        const periodicCount = await processPeriodicTriggers(supabase);
        const scheduledDateCount = await processScheduledDateTriggers(supabase);
        return new Response(JSON.stringify({
          mode: "cron_triggers",
          cron_triggered: cronCount,
          periodic_triggered: periodicCount,
          scheduled_date_triggered: scheduledDateCount,
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
      //
      // Carga I/O-bound (medido: 4,88s por execução, ~94% espera). O loop sequencial
      // que existia aqui dava vazão de ~12/min por invocação, e nenhum batch_size
      // mudava isso. Agora: claim em PEDAÇOS + pool concorrente + orçamento de
      // wall-clock. Ver ADR-0023.
      const runStartedAt = Date.now();
      const stats = {
        claimed: 0, completed: 0, failed: 0, paused: 0,
        cancelled: 0, skipped_plan: 0, released: 0,
      };

      const cfg = await readPoolConfig(supabase);
      const deadlineMs = runStartedAt + cfg.budgetMs;
      const planGateCache = new Map<string, boolean>();
      const lags: number[] = [];

      let drained = false;      // a fila secou dentro do orçamento
      let lastChunkFull = false; // último pedaço veio cheio ⇒ provavelmente há mais
      let leftoverTotal = 0;

      while (Date.now() < deadlineMs) {
        const { data: batch, error: claimError } = await supabase.rpc("claim_workflow_executions", {
          batch_size: cfg.chunk,
          // per_org_cap deixa de ser o freio (era 5 por default e estrangulava tudo).
          // O freio agora é orçamento + concorrência. Ver ADR-0023, decisão 3.
          per_org_cap: RPC_PER_ORG_CAP,
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

        if (!batch || batch.length === 0) {
          drained = true;
          lastChunkFull = false;
          break;
        }

        lastChunkFull = batch.length >= cfg.chunk;
        stats.claimed += batch.length;
        for (const e of batch) {
          const lag = (e as { claimed_lag_ms?: number | null }).claimed_lag_ms;
          if (typeof lag === "number") lags.push(lag);
        }

        const { leftover } = await runWithPool(
          batch as Record<string, unknown>[],
          (e) => e.organization_id as string,
          (e) => processExecution(supabase, e, stats, planGateCache),
          { size: cfg.size, perOrg: cfg.perOrg, deadlineMs },
        );

        if (leftover.length > 0) {
          // Devolve o que o orçamento não alcançou, em vez de deixar preso em
          // `processing` até o stale de 10 min. Melhor esforço: se a função for
          // morta pelo teto de wall-clock, o stale ainda é a rede.
          leftoverTotal += leftover.length;
          stats.released += await releaseClaimed(supabase, leftover.map((e) => e.id as string));
          break;
        }

        if (!lastChunkFull) {
          drained = true;
          break;
        }
      }

      const elapsedMs = Date.now() - runStartedAt;

      // Sinal do controlador: SATURAÇÃO, não Lag. Lag é indicador atrasado —
      // quando ele sobe, o cliente já esperou. Ver ADR-0023, decisão 3.
      const outcome = {
        saturated: leftoverTotal > 0 || (!drained && lastChunkFull),
        idle: drained && elapsedMs < cfg.budgetMs * CONTROLLER.IDLE_BUDGET_FRACTION,
      };
      const decision = decidePool(cfg, outcome, Date.now());
      await persistPoolDecision(supabase, cfg, decision);

      const lagStats = summarizeLag(lags);
      console.log("[process-workflow-executions] Batch complete:", { ...stats, ...lagStats });
      await logRuntime({
        module: "workflow",
        action: "process_batch",
        status: "success",
        payloadSnapshot: {
          ...stats,
          elapsed_ms: elapsedMs,
          pool_size: cfg.size,
          pool_per_org: cfg.perOrg,
          pool_mode: cfg.mode,
          pool_next: decision.size,
          pool_reason: decision.reason,
          saturated: outcome.saturated,
          ...lagStats,
        },
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

/**
 * Plan gate por org, cacheado por batch. Isola a decisão POR EXECUÇÃO —
 * uma org sem plano não derruba o batch inteiro. Fail-open em erro de
 * resolução (RPC): marcar skipped_plan por erro transiente perderia a
 * execução pra sempre (o catch abaixo marca failed terminal). A negação
 * só acontece com features.automations !== true explícito.
 */
async function orgAutomationsAllowed(
  supabase: ReturnType<typeof createClient>,
  organizationId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const cached = cache.get(organizationId);
  if (cached !== undefined) return cached;
  let allowed = true;
  try {
    await assertPlanFeature(supabase, organizationId, "automations");
  } catch (err) {
    if (err instanceof PlanFeatureDeniedError) {
      allowed = false;
    } else {
      console.error(
        `[process-workflow-executions] plan-gate falhou pra org ${organizationId}, seguindo fail-open:`,
        err,
      );
    }
  }
  cache.set(organizationId, allowed);
  return allowed;
}

async function processExecution(
  supabase: ReturnType<typeof createClient>,
  execution: Record<string, unknown>,
  stats: { claimed: number; completed: number; failed: number; paused: number; cancelled: number; skipped_plan: number },
  planGateCache: Map<string, boolean>,
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
    // Plan gate — org sem automations no plano: marca skipped_plan e segue o batch
    if (!(await orgAutomationsAllowed(supabase, organizationId, planGateCache))) {
      await supabase.from("workflow_executions").update({
        status: "skipped_plan",
        error: "Plano da organização não inclui automations",
        completed_at: new Date().toISOString(),
      }).eq("id", executionId);
      stats.skipped_plan++;
      return;
    }

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
      // O sujeito completo, gravado no disparo (fatia 1). Vem nulo nas
      // execuções antigas e nos gatilhos da pessoa — as ações de funil sabem
      // cair no critério de sempre quando não recebem.
      entryId: (execution.pipeline_entry_id as string | null) ?? null,
      dealId: (execution.deal_id as string | null) ?? null,
      definition: workflow.definition as { nodes: { id: string; type: string; data: Record<string, unknown> }[]; edges: { id: string; source: string; target: string; sourceHandle?: string | null; data?: { loopLimit?: number } }[] },
      loopLimit: workflow.loop_limit || 100,
      context,
      currentNodeId,
      loopCounters,
      // Agendamento ORIGINAL da linha (a RPC de claim faz RETURNING pós-UPDATE
      // e não toca next_run_at). O nó de janela usa isto para saber se o resume
      // está vencido e expirar em vez de enviar fora de contexto.
      nextRunAt: execution.next_run_at as string | null,
    });

    if (result.success) {
      if (result.status === "paused" || result.status === "waiting_response") {
        stats.paused++;
        if (jobId) await finishJob(supabase, jobId);
      } else if (result.status === "cancelled") {
        // Expiração deliberada: a execução terminou SEM enviar. Contar isso como
        // `completed` era mentira em duas superfícies ao mesmo tempo — a stat do
        // batch e o `automation_jobs`, que viraria "success". Como
        // `useAutomationHealth` só alerta em `failed`, um backlog inteiro
        // expirando ficaria invisível em todo lugar.
        //
        // `failJob` também não serve: aplica backoff e incrementa `retry_count`,
        // e ao estourar `max_retries` manda para `dead_letter` — retentar uma
        // expiração deliberada é justamente o que não pode acontecer. Por isso
        // `finishJob` (o job de fato rodou até o fim, sem erro) mais uma stat
        // própria, que é o sinal honesto para quem observa o batch.
        stats.cancelled++;
        if (jobId) await finishJob(supabase, jobId);
        console.log(
          `[process-workflow-executions] Execution ${executionId} expirou sem enviar: ${result.error}`,
        );
        await logRuntime({
          organizationId,
          module: "workflow",
          action: `expire:${workflow.name || workflowId}`,
          // `logRuntime` aceita success|error|skipped. `skipped` é o honesto: a
          // execução não falhou, ela deliberadamente não enviou.
          status: "skipped",
          errorMessage: result.error,
          entityType: "lead",
          entityId: leadId,
          payloadSnapshot: { execution_id: executionId, status: result.status },
        });
      } else {
        stats.completed++;
        if (jobId) await finishJob(supabase, jobId);
      }

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

      checkWorkflowFailureAlert(supabase, workflowId, organizationId, workflow.name || workflowId).catch(() => {});

      // ── Backstop de estado ────────────────────────────────────────────────
      // Impede que QUALQUER `success:false` — deste nó ou de um nó futuro —
      // volte a deixar a linha em `processing` para sempre. Foi assim que 77
      // execuções da Chique consumiram as 5 vagas de `per_org_cap` por ciclo e
      // mataram de fome a org inteira.
      //
      // `.eq("status","processing")` é a guarda de idempotência: a RPC de claim
      // carimba a linha como `processing`, e qualquer escrita do executor tira
      // a linha desse estado. Logo o backstop só dispara quando ninguém
      // escreveu; se o executor já gravou (com current_node_id, loop_counters e
      // erro específico), o predicado erra e a linha mais rica dele sobrevive.
      // Uma statement, sem read-then-write, sem TOCTOU.
      await supabase.from("workflow_executions").update({
        status: "failed",
        error: result.error || "Executor returned failure without writing a terminal row",
        completed_at: new Date().toISOString(),
      })
        .eq("id", executionId)
        .eq("status", "processing");
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

        // SCRUM-641: destino preferido segue 'confirmacao' (org antiga:
        // idêntico); org sem esse funil ancora a reunião no funil PADRÃO —
        // é lá que as portas (calcom/new-lead/lead-webhook) gravam
        // metadata.meeting_date pós-funil-único. Sem os dois → pula.
        const wfOrgId = (wf as { organization_id: string }).organization_id;
        let confirmacaoPipelineId = await tryResolvePipelineId(supabase, wfOrgId, "confirmacao");
        if (!confirmacaoPipelineId) {
          const defaultRef = await getOrgDefaultPipelineRef(supabase, wfOrgId);
          if (defaultRef) {
            confirmacaoPipelineId = await tryResolvePipelineId(supabase, wfOrgId, defaultRef);
          }
        }
        if (!confirmacaoPipelineId) continue;

        // Query pipeline_entries for unconfirmed meetings
        // meeting_date and is_confirmed are stored in metadata
        const { data: entries } = await supabase
          .from("pipeline_entries")
          .select("lead_id, metadata")
          .eq("pipeline_id", confirmacaoPipelineId)
          .limit(200);

        // Filter in-memory for meeting window + not confirmed
        const unconfirmed = (entries || []).filter((e: any) => {
          const meta = (e.metadata || {}) as Record<string, unknown>;
          const meetingDate = meta.meeting_date as string | undefined;
          const isConfirmed = meta.is_confirmed as boolean | undefined;
          if (!meetingDate) return false;
          if (isConfirmed === true) return false;
          return meetingDate >= windowStart && meetingDate <= windowEnd;
        });

        if (unconfirmed.length > 0) {
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

async function checkWorkflowFailureAlert(
  supabase: ReturnType<typeof createClient>,
  workflowId: string,
  organizationId: string,
  workflowName: string,
): Promise<void> {
  // O Aviso nasce na PRIMEIRA falha (#1886, ADR-0035). O limiar de três falhas
  // por hora existia só para não repetir aviso; o coalescing por chave de
  // agrupamento resolve isso melhor — e sem esconder a primeira falha, que é
  // justamente quando dá para agir antes da fila engrossar.
  //
  // A supressão anterior era por organização + tipo: dois workflows quebrados na
  // mesma hora e o segundo NUNCA notificava ninguém. Agora a chave é o workflow.
  try {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count: falhas } = await supabase
      .from("workflow_executions")
      .select("*", { count: "exact", head: true })
      .eq("workflow_id", workflowId)
      .eq("status", "failed")
      .gte("completed_at", oneHourAgo);

    const { count: parados } = await supabase
      .from("workflow_executions")
      .select("*", { count: "exact", head: true })
      .eq("workflow_id", workflowId)
      .in("status", ["running", "waiting"]);

    const n = falhas ?? 1;
    const descricao = [
      `${n} ${n === 1 ? "falha" : "falhas"} na última hora`,
      (parados ?? 0) > 0 ? `${parados} ${parados === 1 ? "lead parado" : "leads parados"}` : null,
    ].filter(Boolean).join(" · ");

    const { error } = await supabase.rpc("fn_emit_aviso_admins", {
      p_organization_id: organizationId,
      p_type: "workflow_alert",
      p_group_key: `wf:${workflowId}`,
      p_title: `Automação parou: ${workflowName}`,
      p_description: descricao,
      p_link: "/automacoes",
      p_entity_id: workflowId,
    });

    if (error) {
      console.warn("[process-workflow-executions] aviso de automação falhou:", error.message);
      return;
    }
    console.log(`[workflow-alert] ${workflowName}: ${descricao}`);
  } catch (err) {
    console.warn("[process-workflow-executions] Alert check failed:", err);
  }
}

/** Resumo de Lag do batch. Lag = Claimed − Due (ver CONTEXT.md). Distinto de Wait. */
function summarizeLag(lags: number[]): Record<string, number | null> {
  if (lags.length === 0) return { lag_n: 0, lag_p50_ms: null, lag_p90_ms: null, lag_max_ms: null };
  const s = [...lags].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { lag_n: s.length, lag_p50_ms: at(0.5), lag_p90_ms: at(0.9), lag_max_ms: s[s.length - 1] };
}
