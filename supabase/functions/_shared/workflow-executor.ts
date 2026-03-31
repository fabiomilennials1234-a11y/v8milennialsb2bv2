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
import { evaluateCondition } from "./workflow-condition-evaluator.ts";
import { executeWorkflowAction, type ActionResult } from "./workflow-action-handler.ts";

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
}

export interface ExecuteWorkflowResult {
  success: boolean;
  status: "completed" | "failed" | "paused" | "waiting_response" | "loop_limit_reached";
  error?: string;
  stepsExecuted: number;
}

// ─── Main Executor ──────────────────────────────────────────────────────────

export async function executeWorkflow(params: ExecuteWorkflowParams): Promise<ExecuteWorkflowResult> {
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

    // Loop detection
    loopCounters[nodeId] = (loopCounters[nodeId] || 0) + 1;
    if (loopCounters[nodeId] > loopLimit) {
      await updateExecution(supabase, executionId, "loop_limit_reached", nodeId, loopCounters, `Loop limit reached at node ${nodeId}`);
      return { success: false, status: "loop_limit_reached", error: `Loop limit at ${nodeId}`, stepsExecuted };
    }

    stepsExecuted++;

    // Update current_node_id
    await supabase.from("workflow_executions")
      .update({ current_node_id: nodeId, loop_counters: loopCounters })
      .eq("id", executionId);

    try {
      switch (node.type) {
        case "trigger":
          // Already processed at start — just skip
          await recordStep(supabase, executionId, node, "skipped");
          nextNodes.push(...getNextNodes(nodeId, edgeMap));
          break;

        case "action": {
          const result = await executeWorkflowAction({
            supabase,
            organizationId,
            leadId,
            nodeData: node.data,
            executionContext: context,
          });

          await recordStep(supabase, executionId, node, result.success ? "success" : "failed", node.data, result, result.error);

          if (!result.success) {
            await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, result.error);
            return { success: false, status: "failed", error: result.error, stepsExecuted };
          }

          // Record split funnel event for message-type actions
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
          const condResult = await evaluateCondition(supabase, leadId, {
            field: node.data.field as string || "",
            operator: node.data.operator as string || "equals",
            value: node.data.value as string || "",
          });

          await recordStep(supabase, executionId, node, "success",
            { field: node.data.field, operator: node.data.operator, value: node.data.value },
            { result: condResult },
          );

          // Condition routing: true → sourceHandle "true" or first edge, false → sourceHandle "false" or second edge
          const outEdges = edgeMap.get(nodeId) || [];
          let nextNodeId: string | undefined;

          if (condResult) {
            // True path: look for sourceHandle containing "true" or "yes", or first edge
            const trueEdge = outEdges.find(e =>
              e.sourceHandle?.toLowerCase().includes("true") ||
              e.sourceHandle?.toLowerCase().includes("yes") ||
              e.sourceHandle === "a" ||
              e.sourceHandle === "source-true"
            );
            nextNodeId = trueEdge?.target || outEdges[0]?.target;
          } else {
            // False path: look for sourceHandle containing "false" or "no", or second edge
            const falseEdge = outEdges.find(e =>
              e.sourceHandle?.toLowerCase().includes("false") ||
              e.sourceHandle?.toLowerCase().includes("no") ||
              e.sourceHandle === "b" ||
              e.sourceHandle === "source-false"
            );
            nextNodeId = falseEdge?.target || outEdges[1]?.target || outEdges[0]?.target;
          }

          if (nextNodeId) nextNodes.push(nextNodeId);
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
          const timeoutHours = Number(node.data.timeoutHours) || 0;
          const timeoutMinutes = Number(node.data.timeoutMinutes) || 0;
          const totalMs = (timeoutHours * 3_600_000) + (timeoutMinutes * 60_000);

          const timeoutAt = new Date(Date.now() + totalMs).toISOString();
          await recordStep(supabase, executionId, node, "success",
            { timeoutHours, timeoutMinutes, channel: node.data.channel },
            { timeout_at: timeoutAt },
          );

          await supabase.from("workflow_executions").update({
            status: "waiting_response",
            current_node_id: nodeId,
            next_run_at: timeoutAt, // Resume after timeout
            loop_counters: loopCounters,
          }).eq("id", executionId);

          return { success: true, status: "waiting_response", stepsExecuted };
        }

        case "split_ab": {
          // Support both new variants[] format and legacy splitPercentA format
          let variants: { id: string; label: string; percentage: number }[];

          if (Array.isArray(node.data.variants) && (node.data.variants as any[]).length > 0) {
            variants = node.data.variants as { id: string; label: string; percentage: number }[];
          } else {
            const percentA = Number(node.data.splitPercentA) || 50;
            variants = [
              { id: "a", label: (node.data.variantALabel as string) || "A", percentage: percentA },
              { id: "b", label: (node.data.variantBLabel as string) || "B", percentage: 100 - percentA },
            ];
          }

          // Sticky assignment: same lead always gets same variant in this split
          const { variant: chosenVariant, roll, reused } = await resolveOrCreateSplitAssignment(
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

          // Resolve variables in body
          bodyTemplate = await resolveWebhookBody(supabase, leadId, bodyTemplate);

          const fetchOpts: RequestInit = {
            method,
            headers: { "Content-Type": "application/json", ...headers },
          };
          if (method !== "GET" && bodyTemplate) {
            fetchOpts.body = bodyTemplate;
          }

          const res = await fetch(url, fetchOpts);
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
      const errMsg = nodeError instanceof Error ? nodeError.message : String(nodeError);
      console.error(`[workflow-executor] Node ${nodeId} threw:`, nodeError);
      await recordStep(supabase, executionId, node, "failed", node.data, undefined, errMsg);
      await updateExecution(supabase, executionId, "failed", nodeId, loopCounters, errMsg);
      return { success: false, status: "failed", error: errMsg, stepsExecuted };
    }
  }

  // If we get here, workflow completed
  if (stepsExecuted >= maxSteps) {
    await updateExecution(supabase, executionId, "loop_limit_reached", null, loopCounters, "Max steps reached");
    return { success: false, status: "loop_limit_reached", error: "Max steps reached", stepsExecuted };
  }

  await updateExecution(supabase, executionId, "completed", null, loopCounters);
  return { success: true, status: "completed", stepsExecuted };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextNodes(
  nodeId: string,
  edgeMap: Map<string, { target: string; sourceHandle?: string | null }[]>,
): string[] {
  return (edgeMap.get(nodeId) || []).map(e => e.target);
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
): Promise<void> {
  const update: Record<string, unknown> = {
    status,
    current_node_id: currentNodeId,
    loop_counters: loopCounters,
  };

  if (status === "completed" || status === "failed" || status === "loop_limit_reached") {
    update.completed_at = new Date().toISOString();
  }
  if (error) {
    update.error = error;
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
    nome: lead.name || "",
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
    variants: { id: string; label: string; percentage: number }[];
  },
): Promise<{ variant: { id: string; label: string; percentage: number }; roll: number | null; reused: boolean }> {
  const { organizationId, workflowId, nodeId, leadId, executionId, variants } = params;

  // 1. Check existing assignment
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
        return { variant: matched, roll: null, reused: true };
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
  try {
    await supabase
      .from("workflow_split_assignments")
      .upsert({
        organization_id: organizationId,
        workflow_id: workflowId,
        node_id: nodeId,
        lead_id: leadId,
        variant_id: chosenVariant.id,
        variant_label: chosenVariant.label,
        execution_id: executionId,
      }, { onConflict: "workflow_id,node_id,lead_id" });
  } catch (err) {
    console.warn("[workflow-executor] Failed to persist split assignment:", err);
  }

  return { variant: chosenVariant, roll: Math.round(roll * 100) / 100, reused: false };
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
