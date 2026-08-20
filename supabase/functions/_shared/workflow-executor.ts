/**
 * Workflow Executor — central engine that processes a workflow execution
 *
 * Parses the definition JSON (nodes + edges), traverses the graph from
 * the trigger node, executes actions, evaluates conditions, handles
 * delays/pauses, and records every step in workflow_execution_steps.
 *
 * Respects loop_limit to prevent infinite loops.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateCondition, getLeadTags } from "./workflow-condition-evaluator.ts";
import { executeWorkflowAction, type ActionResult } from "./workflow-action-handler.ts";
import { getNextSendTime } from "./followupSchedule.ts";
import {
  resolveActiveWindow,
  computeNextSendWindowStart,
  windowSpanMinutes,
  windowMatches,
  getDayKeyInTimezone,
  getHourMinutesInTimezone,
  type WindowSchedule,
} from "./copilot/time-context.ts";
import { resolveWindowRole } from "./workflow-window-role.ts";
import { logRuntime } from "./logger.ts";
import { validateExternalUrl } from "./url-validator.ts";
import { fetchWithTimeout } from "./fetch-utils.ts";
import { personalizationName } from "./lead-name.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WorkflowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  data?: { loopLimit?: number };
}

interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/**
 * A single Split A/B path. `tags` (optional, by name) force a lead carrying
 * any of them into this path, with priority over sticky/random selection.
 * Mirrors src/types/workflow.ts SplitVariant (kept in sync manually — Deno
 * edge functions can't import from the frontend src/ tree).
 */
interface SplitVariant {
  id: string;
  label: string;
  percentage: number;
  tags?: string[];
}

interface ExecuteWorkflowParams {
  supabase: SupabaseClient;
  executionId: string;
  workflowId: string;
  organizationId: string;
  leadId: string;
  definition: WorkflowDefinition;
  loopLimit: number;
  context: Record<string, unknown>;
  currentNodeId?: string | null;
  loopCounters?: Record<string, number>;
  /**
   * `workflow_executions.next_run_at` da linha reclamada — o agendamento
   * ORIGINAL, não o instante do reclaim (a RPC de claim faz `RETURNING w.*`
   * pós-UPDATE e não toca esta coluna). É a única forma de o nó saber há quanto
   * tempo o resume está atrasado.
   */
  nextRunAt?: string | null;
}

export interface ExecuteWorkflowResult {
  success: boolean;
  status: "completed" | "failed" | "paused" | "waiting_response" | "loop_limit_reached" | "cancelled";
  error?: string;
  stepsExecuted: number;
}

/**
 * Atraso máximo tolerado num resume de janela. Acima disso a execução expira
 * SEM enviar: uma mensagem agendada para ontem e disparada hoje chega fora de
 * contexto, e o custo de mandá-la (reputação do número, resposta confusa) é
 * maior que o de não mandar. Decisão do CTO, 2026-08-19.
 */
const STALE_RESUME_MAX_MS = 24 * 60 * 60_000;

/**
 * Espalhamento máximo do release de janela. Quando N execuções acordam na mesma
 * abertura de janela, soltar todas no mesmo minuto é uma rajada — e a Chique já
 * tomou um 463 ("temporary restriction for starting new conversations") em
 * 2026-08-13. 30 min é escolha de projeto, não medida; `jitterMs` vai no
 * payload do step justamente para permitir medir depois.
 */
const JITTER_SPREAD_MS = 30 * 60_000;

/**
 * Hash determinístico (FNV-1a 32-bit) do executionId.
 *
 * Determinístico é o requisito, não a distribuição: a MESMA execução, se for
 * reavaliada, precisa cair no MESMO minuto. Com `Math.random()` cada reavaliação
 * sortearia de novo e o espalhamento viraria passeio aleatório — a execução
 * andaria para frente a cada tick em vez de convergir.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function executeWorkflow(params: ExecuteWorkflowParams): Promise<ExecuteWorkflowResult> {
  // Onda 2 / T2.C.3: timing total da execução
  const wfStart = Date.now();
  const {
    supabase,
    executionId,
    workflowId,
    organizationId,
    leadId,
    definition,
    loopLimit,
    context,
  } = params;

  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    nodeMap.set(node.id, node);
  }

  // Build adjacency: source → [{ target, sourceHandle }]
  const edgeMap = new Map<string, { target: string; sourceHandle?: string | null }[]>();
  for (const edge of definition.edges) {
    const list = edgeMap.get(edge.source) || [];
    list.push({ target: edge.target, sourceHandle: edge.sourceHandle });
    edgeMap.set(edge.source, list);
  }

  // Find starting node: either resume from currentNodeId or start from trigger
  let currentNodeId = params.currentNodeId;
  if (!currentNodeId) {
    const triggerNode = definition.nodes.find(n => n.type === "trigger");
    if (!triggerNode) {
      return { success: false, status: "failed", error: "No trigger node found", stepsExecuted: 0 };
    }
    currentNodeId = triggerNode.id;

    // Record trigger step
    await recordStep(supabase, executionId, triggerNode, "success", { context });
  }

  const loopCounters = { ...(params.loopCounters || {}) };
  let stepsExecuted = 0;
  const maxSteps = Math.min(loopLimit, 500); // Hard cap at 500 steps

  // Get next nodes after trigger (or current node if resuming)
  let nextNodes = getNextNodes(currentNodeId, edgeMap);
  if (!params.currentNodeId) {
    // Fresh start — move past trigger to first action
  } else {
    // Resuming — we need to process the current node
    nextNodes = [currentNodeId];
  }

  while (nextNodes.length > 0 && stepsExecuted < maxSteps) {
    const nodeId = nextNodes.shift()!;
    const node = nodeMap.get(nodeId);

    if (!node) {
      console.warn(`[workflow-executor] Node ${nodeId} not found in definition`);
      continue;
    }

    // Loop detection — skip increment for time_window/business_window re-evaluations (scheduled resume)
    const isTimeWindowResume = (
      (node.type === "condition" && (node.data.conditionMode as string) === "time_window") ||
      node.type === "wait_business_window"
    ) && params.currentNodeId === nodeId;

    if (!isTimeWindowResume) {
      loopCounters[nodeId] = (loopCounters[nodeId] || 0) + 1;
      if (loopCounters[nodeId] > loopLimit) {
        await updateExecution(supabase, executionId, "loop_limit_reached", nodeId, loopCounters, `Loop limit reached at node ${nodeId}`);
        return { success: false, status: "loop_limit_reached", error: `Loop limit at ${nodeId}`, stepsExecuted };
      }
    }

    stepsExecuted++;

    // Onda 1 / T1.1.1: heartbeat updated_at impede double-claim por
    // claim_workflow_executions (que reclama processing >10min). Combinado com
    // batch=20 + nodes individuais rápidos, custo desprezível (1 UPDATE por node).
    await supabase.from("workflow_executions")
      .update({
        current_node_id: nodeId,
        loop_counters: loopCounters,
        updated_at: new Date().toISOString(),
      })
      .eq("id", executionId);

    try {
      switch (node.type) {
        case "trigger":
          // Already processed at start — just skip
          await recordStep(supabase, executionId, node, "skipped");
          nextNodes.push(...getNextNodes(nodeId, edgeMap));
          break;

        case "action": {
          const retryCounts = (context._retry_counts as Record<string, number>) || {};
          const currentRetry = retryCounts[nodeId] || 0;

          const result = await executeWorkflowAction({
            supabase,
            organizationId,
            leadId,
            nodeData: node.data,
            executionContext: context,
          });

          await recordStep(supabase, executionId, node, result.success ? "success" : "failed",
            node.data,
            { ...result, ...(currentRetry > 0 ? { retry_attempt: currentRetry } : {}) },
            result.error,
          );

          if (!result.success) {
            const outEdges = edgeMap.get(nodeId) || [];
            const errorEdge = outEdges.find(e =>
              e.sourceHandle === "error" || e.sourceHandle === "on_error"
            );

            if (errorEdge) {
              context._last_error = result.error || "Unknown error";
              context._last_error_node = nodeId;
              nextNodes.push(errorEdge.target);
              break;
            }

            const retryable = result.retryable !== false;
            const MAX_RETRIES = 3;

            if (retryable && currentRetry < MAX_RETRIES) {
              const backoffMs = 30_000 * Math.pow(3, currentRetry);
              const nextRunAt = new Date(Date.now() + backoffMs).toISOString();
              retryCounts[nodeId] = currentRetry + 1;
              context._retry_counts = retryCounts;

              await supabase.from("workflow_executions").update({
                status: "running",
                current_node_id: nodeId,
                next_run_at: nextRunAt,
                loop_counters: loopCounters,
                context: { ...context },
              }).eq("id", executionId);

              console.log(`[workflow-executor] Retry ${currentRetry + 1}/${MAX_RETRIES} for node ${nodeId} in ${backoffMs}ms`);
              return { success: true, status: "paused", stepsExecuted };
            }

            await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, result.error);
            return { success: false, status: "failed", error: result.error, stepsExecuted };
          }

          if (context._retry_counts) {
            delete (context._retry_counts as Record<string, number>)[nodeId];
          }

          const actionType = (node.data.actionType as string) || "";
          if (actionType === "send_message" || actionType === "send_template" || actionType === "send_media") {
            await recordSplitEvent(supabase, {
              organizationId,
              workflowId,
              nodeId,
              leadId,
              executionId,
              eventType: result.success ? "message_sent" : "message_failed",
              stepNodeId: nodeId,
              stepNodeType: node.type,
            });
          }

          nextNodes.push(...getNextNodes(nodeId, edgeMap));
          break;
        }

        case "condition": {
          const conditionMode = (node.data.conditionMode as string) || "field";

          if (conditionMode === "time_window") {
            // ── Time window condition: check if "now" is inside the configured window ──
            const tw = node.data.timeWindow as {
              days?: string[];
              startTime?: string;
              endTime?: string;
              timezone?: string;
            } | undefined;

            const days = tw?.days || ["seg", "ter", "qua", "qui", "sex"];
            const startTime = tw?.startTime || "08:00";
            const endTime = tw?.endTime || "18:00";
            const timezone = tw?.timezone || "America/Sao_Paulo";

            const now = new Date();
            const nextSend = getNextSendTime(
              {
                sendOnlyBusinessHours: true,
                businessHoursStart: startTime,
                businessHoursEnd: endTime,
                sendDays: days,
                timezone,
              },
              now,
            );

            const isInsideWindow = nextSend.getTime() <= now.getTime() + 1000; // 1s tolerance

            if (isInsideWindow) {
              // Inside window — follow true path
              await recordStep(supabase, executionId, node, "success",
                { conditionMode: "time_window", days, startTime, endTime, timezone },
                { result: true, insideWindow: true, evaluatedAt: new Date().toISOString() },
              );

              const outEdges = edgeMap.get(nodeId) || [];
              const trueEdge = outEdges.find(e =>
                e.sourceHandle?.toLowerCase().includes("true") ||
                e.sourceHandle?.toLowerCase().includes("yes") ||
                e.sourceHandle === "a" ||
                e.sourceHandle === "source-true"
              );
              const nextNodeId = trueEdge?.target || outEdges[0]?.target;
              if (nextNodeId) nextNodes.push(nextNodeId);
            } else {
              // Outside window — pause and schedule resume at next window start
              const nextRunAt = nextSend.toISOString();

              await recordStep(supabase, executionId, node, "success",
                { conditionMode: "time_window", days, startTime, endTime, timezone },
                { result: "paused_until_window", insideWindow: false, nextRunAt, evaluatedAt: new Date().toISOString() },
              );

              // Pause execution: set current_node_id to THIS node so it re-evaluates on resume
              await supabase.from("workflow_executions").update({
                status: "running",
                current_node_id: nodeId,
                next_run_at: nextRunAt,
                loop_counters: loopCounters,
              }).eq("id", executionId);

              return { success: true, status: "paused", stepsExecuted };
            }
          } else {
            // ── Field condition: existing behavior unchanged ──
            const condResult = await evaluateCondition(supabase, leadId, {
              field: node.data.field as string || "",
              operator: node.data.operator as string || "equals",
              value: node.data.value as string || "",
            });

            await recordStep(supabase, executionId, node, "success",
              { field: node.data.field, operator: node.data.operator, value: node.data.value },
              { result: condResult },
            );

            const outEdges = edgeMap.get(nodeId) || [];
            let nextNodeId: string | undefined;

            if (condResult) {
              const trueEdge = outEdges.find(e =>
                e.sourceHandle?.toLowerCase().includes("true") ||
                e.sourceHandle?.toLowerCase().includes("yes") ||
                e.sourceHandle === "a" ||
                e.sourceHandle === "source-true"
              );
              nextNodeId = trueEdge?.target || outEdges[0]?.target;
            } else {
              const falseEdge = outEdges.find(e =>
                e.sourceHandle?.toLowerCase().includes("false") ||
                e.sourceHandle?.toLowerCase().includes("no") ||
                e.sourceHandle === "b" ||
                e.sourceHandle === "source-false"
              );
              nextNodeId = falseEdge?.target || outEdges[1]?.target || outEdges[0]?.target;
            }

            if (nextNodeId) nextNodes.push(nextNodeId);
          }
          break;
        }

        case "delay": {
          const amount = Number(node.data.amount) || 0;
          const unit = node.data.unit as string || "minutes";
          let delayMs = amount;

          // Handle randomized delay
          if (node.data.randomized && node.data.amountMin != null && node.data.amountMax != null) {
            const min = Number(node.data.amountMin);
            const max = Number(node.data.amountMax);
            delayMs = min + Math.random() * (max - min);
          }

          switch (unit) {
            case "seconds": delayMs *= 1000; break;
            case "minutes": delayMs *= 60_000; break;
            case "hours": delayMs *= 3_600_000; break;
            case "days": delayMs *= 86_400_000; break;
          }

          if (delayMs > 5000) {
            // Schedule for later — pause execution
            const nextRunAt = new Date(Date.now() + delayMs).toISOString();
            const nextAfterDelay = getNextNodes(nodeId, edgeMap);

            await recordStep(supabase, executionId, node, "success",
              { amount, unit, delayMs },
              { next_run_at: nextRunAt },
            );

            // Set next_run_at and the node to resume from
            const resumeNodeId = nextAfterDelay[0] || null;
            await supabase.from("workflow_executions").update({
              status: "running",
              current_node_id: resumeNodeId,
              next_run_at: nextRunAt,
              loop_counters: loopCounters,
            }).eq("id", executionId);

            return { success: true, status: "paused", stepsExecuted };
          } else {
            // Short delay — execute inline
            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
            await recordStep(supabase, executionId, node, "success", { amount, unit, delayMs });
            nextNodes.push(...getNextNodes(nodeId, edgeMap));
          }
          break;
        }

        case "copilot": {
          // Hand off to AI agent — insert pending_ai_actions
          const agentId = node.data.agentId as string;
          if (agentId && leadId) {
            await supabase.from("pending_ai_actions").insert({
              organization_id: organizationId,
              lead_id: leadId,
              action_type: "generate_message",
              payload: { source: "workflow", agent_id: agentId },
              status: "pending",
            });
          }
          await recordStep(supabase, executionId, node, "success", { agentId });
          nextNodes.push(...getNextNodes(nodeId, edgeMap));
          break;
        }

        case "wait_response": {
          // Check if we're resuming from a resolved wait (timeout or reply)
          const waitResolved = context._wait_resolved as string | undefined;

          if (waitResolved === "timeout") {
            // Timeout expired — follow the timeout branch
            delete context._wait_resolved;
            delete context._wait_started_at;
            await recordStep(supabase, executionId, node, "success",
              { resumeReason: "timeout", channel: node.data.channel },
              { branch: "timeout", resolved_at: new Date().toISOString() },
            );

            const nextId = getNextNodeByHandle(nodeId, "timeout", edgeMap);
            if (nextId) nextNodes.push(nextId);
            break;
          }

          if (waitResolved === "replied") {
            // Lead replied — follow the replied branch
            const repliedAt = context._replied_at as string | undefined;
            const replyChannel = context._reply_channel as string | undefined;
            delete context._wait_resolved;
            delete context._wait_started_at;
            delete context._replied_at;
            delete context._reply_channel;
            await recordStep(supabase, executionId, node, "success",
              { resumeReason: "replied", channel: node.data.channel, replyChannel },
              { branch: "replied", replied_at: repliedAt, resolved_at: new Date().toISOString() },
            );

            const nextId = getNextNodeByHandle(nodeId, "replied", edgeMap);
            if (nextId) nextNodes.push(nextId);
            break;
          }

          // First time entering the node — set up the wait
          const timeoutHours = Number(node.data.timeoutHours) || 0;
          const timeoutMinutes = Number(node.data.timeoutMinutes) || 0;
          // Minimum 1 minute to avoid instant timeout
          const totalMs = Math.max((timeoutHours * 3_600_000) + (timeoutMinutes * 60_000), 60_000);

          const timeoutAt = new Date(Date.now() + totalMs).toISOString();
          await recordStep(supabase, executionId, node, "success",
            { timeoutHours, timeoutMinutes, channel: node.data.channel },
            { timeout_at: timeoutAt, waiting: true },
          );

          await supabase.from("workflow_executions").update({
            status: "waiting_response",
            current_node_id: nodeId,
            next_run_at: timeoutAt,
            loop_counters: loopCounters,
            context: { ...context, _wait_started_at: new Date().toISOString() },
          }).eq("id", executionId);

          return { success: true, status: "waiting_response", stepsExecuted };
        }

        case "split_ab": {
          // Support both new variants[] format and legacy splitPercentA format
          let variants: SplitVariant[];

          if (Array.isArray(node.data.variants) && (node.data.variants as any[]).length > 0) {
            variants = node.data.variants as SplitVariant[];
          } else {
            const percentA = Number(node.data.splitPercentA) || 50;
            variants = [
              { id: "a", label: (node.data.variantALabel as string) || "A", percentage: percentA },
              { id: "b", label: (node.data.variantBLabel as string) || "B", percentage: 100 - percentA },
            ];
          }

          // Priority: tag override > sticky assignment > weighted random
          const { variant: chosenVariant, roll, reused, matchedByTag, matchedTag } =
            await resolveOrCreateSplitAssignment(
              supabase,
              {
                organizationId,
                workflowId,
                nodeId,
                leadId,
                executionId,
                variants,
              },
            );

          // Find the edge matching this variant
          const outEdges = edgeMap.get(nodeId) || [];
          let nextNodeId: string | undefined;

          const exactEdge = outEdges.find(e => e.sourceHandle === `variant_${chosenVariant.id}`);
          if (exactEdge) {
            nextNodeId = exactEdge.target;
          } else {
            const legacyEdge = outEdges.find(e =>
              e.sourceHandle?.toLowerCase().includes(chosenVariant.id.toLowerCase())
            );
            nextNodeId = legacyEdge?.target || outEdges[0]?.target;
          }

          await recordStep(supabase, executionId, node, "success",
            { variants, variantCount: variants.length },
            {
              chosenVariant: chosenVariant.label,
              chosenVariantId: chosenVariant.id,
              roll,
              reused,
              matchedByTag,
              matchedTag: matchedTag ?? null,
              nextNodeId: nextNodeId || null,
            },
          );

          if (!nextNodeId) {
            console.warn(`[workflow-executor] split_ab node ${nodeId}: no edge for variant ${chosenVariant.id}`);
          } else {
            nextNodes.push(nextNodeId);
          }
          break;
        }

        case "webhook_call": {
          const url = node.data.url as string;
          const method = (node.data.method as string || "POST").toUpperCase();
          const headers = node.data.headers as Record<string, string> || {};
          let bodyTemplate = node.data.bodyTemplate as string || "";

          if (!url) {
            await recordStep(supabase, executionId, node, "failed", node.data, undefined, "No URL configured");
            await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, "Webhook: no URL");
            return { success: false, status: "failed", error: "Webhook: no URL", stepsExecuted };
          }

          const urlCheck = validateExternalUrl(url);
          if (!urlCheck.valid) {
            await recordStep(supabase, executionId, node, "failed", { url, method }, undefined, `Blocked URL: ${urlCheck.reason}`);
            await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, `Webhook blocked: ${urlCheck.reason}`);
            return { success: false, status: "failed", error: `Webhook blocked: ${urlCheck.reason}`, stepsExecuted };
          }

          // Resolve variables in body
          bodyTemplate = await resolveWebhookBody(supabase, leadId, bodyTemplate);

          const fetchOpts: RequestInit = {
            method,
            headers: { "Content-Type": "application/json", ...headers },
          };
          if (method !== "GET" && bodyTemplate) {
            fetchOpts.body = bodyTemplate;
          }

          const res = await fetchWithTimeout(url, fetchOpts, 15_000);
          const responseText = await res.text();

          if (!res.ok) {
            await recordStep(supabase, executionId, node, "failed", { url, method }, { status: res.status, body: responseText.slice(0, 500) }, `HTTP ${res.status}`);
            // Don't fail the whole workflow for webhook errors — continue
            nextNodes.push(...getNextNodes(nodeId, edgeMap));
          } else {
            // Store output variable if configured
            if (node.data.outputVariable) {
              context[node.data.outputVariable as string] = responseText.slice(0, 2000);
            }
            await recordStep(supabase, executionId, node, "success", { url, method }, { status: res.status, body: responseText.slice(0, 500) });
            nextNodes.push(...getNextNodes(nodeId, edgeMap));
          }
          break;
        }

        case "goto": {
          const targetNodeId = node.data.targetNodeId as string;
          if (!targetNodeId || !nodeMap.has(targetNodeId)) {
            await recordStep(supabase, executionId, node, "failed", node.data, undefined, "Invalid goto target");
            await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, "Invalid goto target");
            return { success: false, status: "failed", error: "Invalid goto target", stepsExecuted };
          }

          await recordStep(supabase, executionId, node, "success", { targetNodeId });
          nextNodes.push(targetNodeId);
          break;
        }

        case "wait_business_window": {
          // ── Gate de horário. Dois caminhos, sem meio-termo: ──
          //   windows[] presente → resolução por PAPEL (`workflow-window-role.ts`);
          //   windows[] ausente  → caminho LEGACY via getNextSendTime, intocado
          //                        (624 execuções da Goletric já escalonadas nele).
          const wbw = node.data as {
            days?: string[];
            startTime?: string;
            endTime?: string;
            timezone?: string;
            windows?: Array<{ id: string; name: string; days: string[]; start: string; end: string; action: string }>;
            mode?: "hold" | "route" | "hybrid";
          };
          const wbwTz = wbw.timezone || "America/Sao_Paulo";
          const wbwWindows = Array.isArray(wbw.windows) ? wbw.windows : [];
          const wbwNow = new Date();

          if (wbwWindows.length > 0) {
            // ── Semântica (CTO 2026-08-19): a janela desenhada é o horário em
            // que a mensagem DISPARA. Dentro de janela de envio → passa. Fora de
            // toda janela (ou dentro de um blackout) → dorme até a próxima abrir.
            const wbwStepInput = { windows: wbwWindows, mode: wbw.mode ?? null };

            // ── Guarda de resume vencido ───────────────────────────────────
            // Agendado para ontem e reclamado hoje: expira SEM enviar. Fica ANTES
            // de qualquer resolução de janela justamente para que nenhum nó a
            // jusante execute — o WhatsApp enviado não volta.
            const scheduledFor = params.nextRunAt ? new Date(params.nextRunAt) : null;
            if (scheduledFor && !isNaN(scheduledFor.getTime())) {
              const lateByMs = wbwNow.getTime() - scheduledFor.getTime();
              if (lateByMs > STALE_RESUME_MAX_MS) {
                const staleError = "expired:stale_resume_24h";
                await recordStep(supabase, executionId, node, "skipped",
                  wbwStepInput,
                  {
                    insideWindow: null,
                    activeWindow: null,
                    action: null,
                    roleResolved: "expired",
                    jitterMs: 0,
                    nextRunAt: null,
                    scheduledFor: scheduledFor.toISOString(),
                    lateByMs,
                    evaluatedAt: wbwNow.toISOString(),
                  },
                  staleError,
                );
                await updateExecution(
                  supabase, executionId, "cancelled", nodeId, loopCounters, staleError,
                  { next_run_at: null },
                );
                return { success: true, status: "cancelled", error: staleError, stepsExecuted };
              }
            }

            const ctx = resolveActiveWindow(
              { behavior_windows: wbwWindows as any, availability: { timezone: wbwTz } },
              wbwNow,
            );
            const activeAction = ctx ? String((ctx.window as any).action ?? "") : null;
            const role = ctx ? resolveWindowRole(activeAction) : null;

            if (role?.kind === "send") {
              // Dentro do horário de envio: segue no MESMO tick, sem tocar
              // next_run_at. Escrever agendamento aqui é o que criava o livelock.
              await recordStep(supabase, executionId, node, "success",
                wbwStepInput,
                {
                  insideWindow: true,
                  activeWindow: ctx!.window.name,
                  action: activeAction,
                  roleResolved: "send",
                  jitterMs: 0,
                  nextRunAt: null,
                  evaluatedAt: wbwNow.toISOString(),
                },
              );
              nextNodes.push(...getNextNodes(nodeId, edgeMap));
              break;
            }

            if (role?.kind === "route") {
              const outEdges = edgeMap.get(nodeId) || [];
              const branchTargets = outEdges
                .filter((e) => (e.sourceHandle ?? "") === role.key)
                .map((e) => e.target);
              if (branchTargets.length === 0) {
                const routeError = `wait_business_window: edge "${role.key}" não encontrada`;
                await recordStep(supabase, executionId, node, "failed",
                  wbwStepInput,
                  {
                    insideWindow: true,
                    activeWindow: ctx!.window.name,
                    action: activeAction,
                    roleResolved: "route",
                    jitterMs: 0,
                    nextRunAt: null,
                    reason: `route branch "${role.key}" sem edge correspondente`,
                    evaluatedAt: wbwNow.toISOString(),
                  },
                  routeError,
                );
                await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, routeError);
                return { success: false, status: "failed", error: routeError, stepsExecuted };
              }
              await recordStep(supabase, executionId, node, "success",
                wbwStepInput,
                {
                  insideWindow: true,
                  activeWindow: ctx!.window.name,
                  action: activeAction,
                  roleResolved: "route",
                  jitterMs: 0,
                  nextRunAt: null,
                  routedTo: branchTargets,
                  evaluatedAt: wbwNow.toISOString(),
                },
              );
              nextNodes.push(...branchTargets);
              break;
            }

            // ── Dorme: nenhuma janela casou, ou casou um blackout ──────────
            // Escada (a ordem É o contrato):
            //   1. próxima abertura entre as janelas de ENVIO;
            //   2. se não existe nenhuma janela de envio, próxima abertura entre
            //      janelas de qualquer papel — um nó só-`route` (Happyneis) é
            //      legítimo e não pode expirar por não ter janela de envio;
            //   3. nada abre em 14 dias → expira;
            //   4. resultado <= agora em qualquer ponto → expira (contradição de
            //      config, não agendamento).
            const wbwSchedules = wbwWindows as unknown as WindowSchedule[];
            const sendWindows = wbwSchedules.filter((w) =>
              resolveWindowRole((w as unknown as { action?: string }).action).kind === "send"
            );
            const scanPool = sendWindows.length > 0 ? sendWindows : wbwSchedules;
            const nextOpen = computeNextSendWindowStart(scanPool, wbwTz, wbwNow);

            const holdBase = {
              insideWindow: !!ctx,
              activeWindow: ctx?.window.name ?? null,
              action: activeAction,
              roleResolved: role?.kind ?? "none",
              scannedPool: sendWindows.length > 0 ? "send" : "any_role",
              evaluatedAt: wbwNow.toISOString(),
            };

            if (!nextOpen) {
              const noWindowError = "expired:no_send_window";
              await recordStep(supabase, executionId, node, "failed",
                wbwStepInput,
                { ...holdBase, jitterMs: 0, nextRunAt: null, reason: "nenhuma janela abre nos próximos 14 dias" },
                noWindowError,
              );
              await updateExecution(
                supabase, executionId, "cancelled", nodeId, loopCounters, noWindowError,
                { next_run_at: null },
              );
              return { success: true, status: "cancelled", error: noWindowError, stepsExecuted };
            }

            // R2: JAMAIS gravar next_run_at <= agora. A verificação roda ANTES
            // do jitter, de propósito: o jitter é positivo e empurraria um
            // `nextOpen === agora` para o futuro, mascarando a contradição. O
            // caso real é um nó só de bloqueio com a janela ativa — a varredura
            // de "qualquer papel" casaria no offset 0 e o nó dormiria minutos
            // para acordar dentro do mesmo bloqueio, para sempre.
            if (nextOpen.getTime() <= wbwNow.getTime()) {
              const loopError = "expired:window_resolution_loop";
              await recordStep(supabase, executionId, node, "failed",
                wbwStepInput,
                {
                  ...holdBase,
                  jitterMs: 0,
                  nextRunAt: null,
                  windowOpensAt: nextOpen.toISOString(),
                  reason: "próxima abertura resolveu para o passado/presente",
                },
                loopError,
              );
              await updateExecution(
                supabase, executionId, "cancelled", nodeId, loopCounters, loopError,
                { next_run_at: null },
              );
              return { success: true, status: "cancelled", error: loopError, stepsExecuted };
            }

            // Jitter determinístico, limitado a metade da janela para nunca
            // vazar pelo fim dela.
            const openDayKey = getDayKeyInTimezone(nextOpen, wbwTz);
            const openClock = getHourMinutesInTimezone(nextOpen, wbwTz);
            const openMinutes = openClock.hour * 60 + openClock.minute;
            const openingWindow = scanPool.find((w) => windowMatches(w, openDayKey, openMinutes));
            const spanMs = openingWindow ? windowSpanMinutes(openingWindow) * 60_000 : JITTER_SPREAD_MS;
            const jitterCap = Math.max(0, Math.min(JITTER_SPREAD_MS, Math.floor(spanMs / 2)));
            const jitterMs = jitterCap > 0 ? fnv1a32(executionId) % jitterCap : 0;
            const resumeAt = new Date(nextOpen.getTime() + jitterMs);

            // Rede de segurança: mesmo com a checagem acima, nada é gravado se
            // o valor final não for estritamente futuro. Gravar passado ou
            // presente viraria livelock — reclamado a cada ciclo, para sempre,
            // consumindo o per_org_cap da org inteira.
            if (resumeAt.getTime() <= wbwNow.getTime()) {
              const loopError = "expired:window_resolution_loop";
              await recordStep(supabase, executionId, node, "failed",
                wbwStepInput,
                {
                  ...holdBase,
                  jitterMs,
                  nextRunAt: null,
                  windowOpensAt: nextOpen.toISOString(),
                  reason: "próxima abertura resolveu para o passado/presente",
                },
                loopError,
              );
              await updateExecution(
                supabase, executionId, "cancelled", nodeId, loopCounters, loopError,
                { next_run_at: null },
              );
              return { success: true, status: "cancelled", error: loopError, stepsExecuted };
            }

            const resumeIso = resumeAt.toISOString();
            await recordStep(supabase, executionId, node, "success",
              wbwStepInput,
              {
                ...holdBase,
                jitterMs,
                nextRunAt: resumeIso,
                windowOpensAt: nextOpen.toISOString(),
                openingWindow: openingWindow?.name ?? null,
              },
            );
            await supabase.from("workflow_executions").update({
              status: "running",
              current_node_id: nodeId,
              next_run_at: resumeIso,
              loop_counters: loopCounters,
            }).eq("id", executionId);
            return { success: true, status: "paused", stepsExecuted };
          }

          // ── Legacy single-window hold (retrocompat) ──
          const wbwDays = wbw.days || ["seg", "ter", "qua", "qui", "sex"];
          const wbwStart = wbw.startTime || "08:00";
          const wbwEnd = wbw.endTime || "18:00";

          const wbwNextSend = getNextSendTime(
            {
              sendOnlyBusinessHours: true,
              businessHoursStart: wbwStart,
              businessHoursEnd: wbwEnd,
              sendDays: wbwDays,
              timezone: wbwTz,
            },
            wbwNow,
          );

          const wbwInsideWindow = wbwNextSend.getTime() <= wbwNow.getTime() + 1000;

          if (wbwInsideWindow) {
            await recordStep(supabase, executionId, node, "success",
              { days: wbwDays, startTime: wbwStart, endTime: wbwEnd, timezone: wbwTz },
              { insideWindow: true, evaluatedAt: new Date().toISOString() },
            );
            nextNodes.push(...getNextNodes(nodeId, edgeMap));
          } else {
            const wbwNextRunAt = wbwNextSend.toISOString();
            await recordStep(supabase, executionId, node, "success",
              { days: wbwDays, startTime: wbwStart, endTime: wbwEnd, timezone: wbwTz },
              { insideWindow: false, nextRunAt: wbwNextRunAt, evaluatedAt: new Date().toISOString() },
            );

            await supabase.from("workflow_executions").update({
              status: "running",
              current_node_id: nodeId,
              next_run_at: wbwNextRunAt,
              loop_counters: loopCounters,
            }).eq("id", executionId);

            return { success: true, status: "paused", stepsExecuted };
          }
          break;
        }

        case "assign_responsible": {
          // ── Assign a team member to the lead ──
          const arMode = (node.data.assignMode as string) || "round_robin";
          const arTarget = (node.data.assignTarget as string) || "responsible";
          const arMemberFilter = node.data.memberIds as string[] | undefined;
          let arAssigneeId: string | undefined;
          let arAssigneeName: string | undefined;

          if (arMode === "manual") {
            arAssigneeId = node.data.assigneeId as string;
            arAssigneeName = node.data.assigneeName as string;
          } else {
            // Get eligible members
            let eligibleMembers: { id: string; name: string }[];

            if (arMemberFilter && arMemberFilter.length > 0) {
              const { data: filtered } = await supabase
                .from("team_members")
                .select("id, name")
                .eq("organization_id", organizationId)
                .eq("is_active", true)
                .in("id", arMemberFilter)
                .order("id");
              eligibleMembers = (filtered || []) as { id: string; name: string }[];
            } else {
              const { data: allActive } = await supabase
                .from("team_members")
                .select("id, name")
                .eq("organization_id", organizationId)
                .eq("is_active", true)
                .order("id");
              eligibleMembers = (allActive || []) as { id: string; name: string }[];
            }

            if (eligibleMembers.length === 0) {
              await recordStep(supabase, executionId, node, "failed", node.data, undefined, "Nenhum membro ativo disponível");
              await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, "Nenhum membro ativo disponível");
              return { success: false, status: "failed", error: "Nenhum membro ativo disponível", stepsExecuted };
            }

            if (arMode === "random") {
              // CSPRNG em vez de `Math.random()`. O sorteio aqui é de negócio —
              // qual vendedor da própria org recebe o lead —, mas o id sorteado
              // agora alimenta `responsible_user_id`, e o CodeQL trata
              // identidade derivada de PRNG fraco como falha ("Insecure
              // randomness", high). Trocar custa nada e mantém o portão verde
              // sem precisar dispensar alerta na mão.
              const buf = new Uint32Array(1);
              crypto.getRandomValues(buf);
              const randomIdx = buf[0] % eligibleMembers.length;
              arAssigneeId = eligibleMembers[randomIdx].id;
              arAssigneeName = eligibleMembers[randomIdx].name;
            } else {
              // round_robin: sequential via RPC with advisory lock
              const memberIds = eligibleMembers.map(m => m.id);
              const { data: nextId, error: rpcError } = await supabase.rpc("get_next_round_robin_member", {
                p_workflow_id: workflowId,
                p_node_id: nodeId,
                p_organization_id: organizationId,
                p_member_ids: memberIds,
              });

              if (rpcError || !nextId) {
                // Fallback: first member
                arAssigneeId = eligibleMembers[0].id;
                arAssigneeName = eligibleMembers[0].name;
                console.warn("[workflow-executor] round_robin RPC failed, using fallback:", rpcError);
              } else {
                arAssigneeId = nextId;
                arAssigneeName = eligibleMembers.find(m => m.id === nextId)?.name || "";
              }
            }
          }

          if (!arAssigneeId) {
            await recordStep(supabase, executionId, node, "failed", node.data, undefined, "Nenhum responsável para atribuir");
            await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, "Nenhum responsável para atribuir");
            return { success: false, status: "failed", error: "Nenhum responsável para atribuir", stepsExecuted };
          }

          // Update lead based on target
          //
          // `responsible_user_id` entra junto porque é a coluna que
          // `get_lead_write_instance` casa com `whatsapp_instances.owner_team_member_id`
          // — apesar do nome, a FK aponta para `team_members(id)`, igual às outras.
          // Sem ela, a política de roteamento `responsible` devolve NO_RESPONSIBLE
          // para TODO lead atribuído por automação: o nó de envio cai no recuo, ou
          // falha com `no_instance_resolved` quando não há recuo declarado.
          //
          // Nenhum dos dois triggers de `leads` cobre isso — `fn_sync_canonical_assignment`
          // só espelha sdr↔pre_sale e closer↔sale. Medido em prod (2026-08-04):
          // 0 de 82 leads da Cervejaria Insana tinham a coluna preenchida, e
          // 3.321 de 35.171 na plataforma — todos vindos de outros caminhos.
          const arUpdateFields: Record<string, string> = {
            responsible_id: arAssigneeId,
            responsible_user_id: arAssigneeId,
          };
          if (arTarget === "sdr") {
            arUpdateFields.sdr_id = arAssigneeId;
          } else if (arTarget === "closer") {
            arUpdateFields.closer_id = arAssigneeId;
          } else {
            arUpdateFields.sdr_id = arAssigneeId;
            arUpdateFields.closer_id = arAssigneeId;
          }

          await supabase.from("leads").update(arUpdateFields).eq("id", leadId);

          await recordStep(supabase, executionId, node, "success",
            { assignMode: arMode, assignTarget: arTarget },
            { assigneeId: arAssigneeId, assigneeName: arAssigneeName },
          );
          nextNodes.push(...getNextNodes(nodeId, edgeMap));
          break;
        }

        case "end": {
          await recordStep(supabase, executionId, node, "success");
          // Don't add more nodes — workflow ends
          break;
        }

        default:
          console.warn(`[workflow-executor] Unknown node type: ${node.type}`);
          await recordStep(supabase, executionId, node, "skipped", undefined, undefined, `Unknown type: ${node.type}`);
          nextNodes.push(...getNextNodes(nodeId, edgeMap));
      }
    } catch (nodeError) {
      const errMsg = nodeError instanceof Error
        ? nodeError.message
        : (nodeError as any)?.message ?? JSON.stringify(nodeError);
      console.error(`[workflow-executor] Node ${nodeId} threw:`, nodeError);
      await recordStep(supabase, executionId, node, "failed", node.data, undefined, errMsg);

      const outEdges = edgeMap.get(nodeId) || [];
      const errorEdge = outEdges.find(e =>
        e.sourceHandle === "error" || e.sourceHandle === "on_error"
      );
      if (errorEdge) {
        context._last_error = errMsg;
        context._last_error_node = nodeId;
        nextNodes.push(errorEdge.target);
      } else {
        await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, errMsg);
        return { success: false, status: "failed", error: errMsg, stepsExecuted };
      }
    }
  }

  // If we get here, workflow completed
  if (stepsExecuted >= maxSteps) {
    await updateExecution(supabase, executionId, "loop_limit_reached", null, loopCounters, "Max steps reached");
    return { success: false, status: "loop_limit_reached", error: "Max steps reached", stepsExecuted };
  }

  await updateExecution(supabase, executionId, "completed", null, loopCounters);
  // Onda 2 / T2.C.3: log latência total
  logRuntime({
    organizationId,
    module: "workflow",
    action: "execute",
    status: "success",
    entityType: "workflow_execution",
    entityId: executionId,
    durationMs: Date.now() - wfStart,
    payloadSnapshot: { workflow_id: workflowId, lead_id: leadId, steps: stepsExecuted },
  }).catch(() => {/* non-fatal */});

  return { success: true, status: "completed", stepsExecuted };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextNodes(
  nodeId: string,
  edgeMap: Map<string, { target: string; sourceHandle?: string | null }[]>,
): string[] {
  return (edgeMap.get(nodeId) || []).map(e => e.target);
}

/**
 * Get the next node for a specific sourceHandle (e.g. "replied", "timeout").
 * Falls back to first edge if no handle matches.
 */
function getNextNodeByHandle(
  nodeId: string,
  handle: string,
  edgeMap: Map<string, { target: string; sourceHandle?: string | null }[]>,
): string | undefined {
  const edges = edgeMap.get(nodeId) || [];
  const match = edges.find(e => e.sourceHandle === handle);
  return match?.target || edges[0]?.target;
}

async function recordStep(
  supabase: SupabaseClient,
  executionId: string,
  node: WorkflowNode,
  status: "success" | "failed" | "skipped",
  inputData?: Record<string, unknown>,
  outputData?: Record<string, unknown> | ActionResult,
  error?: string,
): Promise<void> {
  try {
    await supabase.from("workflow_execution_steps").insert({
      execution_id: executionId,
      node_id: node.id,
      node_type: node.type,
      node_label: (node.data?.label as string) || node.type,
      status,
      input_data: inputData || null,
      output_data: outputData ? sanitizeOutput(outputData) : null,
      error: error || null,
    });
  } catch (err) {
    console.warn("[workflow-executor] Failed to record step:", err);
  }
}

function sanitizeOutput(data: Record<string, unknown>): Record<string, unknown> {
  // Truncate large string values
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.length > 1000) {
      result[key] = value.slice(0, 1000) + "...";
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function updateExecution(
  supabase: SupabaseClient,
  executionId: string,
  status: string,
  currentNodeId: string | null,
  loopCounters: Record<string, number>,
  error?: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    current_node_id: currentNodeId,
    loop_counters: loopCounters,
  };

  // `cancelled` é desfecho TERMINAL (expiração deliberada). Sem carimbar
  // completed_at ele fica com nulo e parece aberto em qualquer consulta com
  // recorte de data — um terminal exibido como eterno.
  if (
    status === "completed" || status === "failed" ||
    status === "loop_limit_reached" || status === "cancelled"
  ) {
    update.completed_at = new Date().toISOString();
  }
  if (error) {
    update.error = error;
  }
  if (extra) {
    Object.assign(update, extra);
  }

  await supabase.from("workflow_executions").update(update).eq("id", executionId);
}

async function resolveWebhookBody(supabase: SupabaseClient, leadId: string, template: string): Promise<string> {
  if (!template || !template.includes("{{")) return template;

  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return template;

  let result = template;
  const vars: Record<string, string> = {
    nome: personalizationName(lead.name),
    empresa: lead.company || "",
    email: lead.email || "",
    telefone: lead.phone || "",
    lead_id: lead.id || "",
    score: String(lead.qualification_score ?? ""),
    rating: String(lead.rating ?? ""),
    estagio: lead.pipe_whatsapp || "",
  };

  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }

  return result;
}

async function resolveOrCreateSplitAssignment(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    workflowId: string;
    nodeId: string;
    leadId: string;
    executionId: string;
    variants: SplitVariant[];
  },
): Promise<{
  variant: SplitVariant;
  roll: number | null;
  reused: boolean;
  matchedByTag: boolean;
  matchedTag: string | null;
}> {
  const { organizationId, workflowId, nodeId, leadId, executionId, variants } = params;

  const persist = async (variant: SplitVariant) => {
    try {
      await supabase
        .from("workflow_split_assignments")
        .upsert({
          organization_id: organizationId,
          workflow_id: workflowId,
          node_id: nodeId,
          lead_id: leadId,
          variant_id: variant.id,
          variant_label: variant.label,
          execution_id: executionId,
        }, { onConflict: "workflow_id,node_id,lead_id" });
    } catch (err) {
      console.warn("[workflow-executor] Failed to persist split assignment:", err);
    }
  };

  // 0. Tag override (highest priority). Only queries lead tags when at least
  //    one variant declares tags — keeps tagless workflows on the exact same
  //    path (no extra query, no behaviour change).
  const hasTagRules = variants.some(v => Array.isArray(v.tags) && v.tags.length > 0);
  if (hasTagRules) {
    try {
      // getLeadTags returns a comma-separated list of tag names.
      const csv = await getLeadTags(supabase, leadId);
      const leadTags = csv
        .split(",")
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      if (leadTags.length > 0) {
        // First variant (in array order) with a tag the lead carries wins.
        let matchedTagName: string | null = null;
        const tagged = variants.find(v =>
          (v.tags ?? []).some(tag => {
            const t = tag.trim().toLowerCase();
            if (t && leadTags.includes(t)) {
              matchedTagName = tag;
              return true;
            }
            return false;
          })
        );

        if (tagged) {
          // Persist so metrics/edges stay consistent — overwrites any prior
          // sticky assignment when a tag rule forces a different path.
          await persist(tagged);
          return { variant: tagged, roll: null, reused: false, matchedByTag: true, matchedTag: matchedTagName };
        }
      }
    } catch (err) {
      console.warn("[workflow-executor] Failed to evaluate split tag override:", err);
    }
  }

  // 1. Check existing assignment (sticky)
  try {
    const { data: existing } = await supabase
      .from("workflow_split_assignments")
      .select("variant_id, variant_label")
      .eq("workflow_id", workflowId)
      .eq("node_id", nodeId)
      .eq("lead_id", leadId)
      .maybeSingle();

    if (existing) {
      const matched = variants.find(v => v.id === existing.variant_id);
      if (matched) {
        return { variant: matched, roll: null, reused: true, matchedByTag: false, matchedTag: null };
      }
      // Variant was removed from config — fall through to new assignment
    }
  } catch (err) {
    console.warn("[workflow-executor] Failed to check split assignment:", err);
  }

  // 2. Weighted random selection
  const roll = Math.random() * 100;
  let cumulative = 0;
  let chosenVariant = variants[variants.length - 1]; // Default to last variant (matches distributePercentages remainder)
  for (const v of variants) {
    cumulative += v.percentage;
    if (roll < cumulative) {
      chosenVariant = v;
      break;
    }
  }

  // 3. Persist assignment (upsert to handle race conditions)
  await persist(chosenVariant);

  return { variant: chosenVariant, roll: Math.round(roll * 100) / 100, reused: false, matchedByTag: false, matchedTag: null };
}

async function recordSplitEvent(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    workflowId: string;
    nodeId: string;
    leadId: string;
    executionId: string;
    eventType: string;
    stepNodeId?: string;
    stepNodeType?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Scope by execution_id to handle workflows with multiple split nodes
    const { data: assignment } = await supabase
      .from("workflow_split_assignments")
      .select("id")
      .eq("workflow_id", params.workflowId)
      .eq("lead_id", params.leadId)
      .eq("execution_id", params.executionId)
      .limit(1)
      .maybeSingle();

    if (!assignment) return;

    await supabase.from("workflow_split_events").insert({
      organization_id: params.organizationId,
      assignment_id: assignment.id,
      execution_id: params.executionId,
      event_type: params.eventType,
      node_id: params.stepNodeId || null,
      node_type: params.stepNodeType || null,
      metadata: params.metadata || {},
    });
  } catch (err) {
    console.warn("[workflow-executor] Failed to record split event:", err);
  }
}
