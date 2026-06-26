/**
 * Pure workflow-graph validator (docs/adr/0013). Graph integrity is universal + strict;
 * cycles are ALLOWED (bounded by loop_limit at runtime) but a "hot" cycle — a loop with no
 * pausing node (delay / wait_response / wait_business_window) — is flagged as a warning
 * because it would burn the loop limit. `ok` is false iff there is at least one error.
 */
import type { WorkflowDefinition } from "./definition.ts";

export interface ValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
  nodeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}

const PAUSING_TYPES = new Set(["delay", "wait_response", "wait_business_window"]);

export function validateWorkflow(def: WorkflowDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];
  const nodes = def.nodes ?? [];
  const edges = def.edges ?? [];
  const err = (code: string, message: string, nodeId?: string) =>
    issues.push({ code, message, severity: "error", nodeId });
  const warn = (code: string, message: string, nodeId?: string) =>
    issues.push({ code, message, severity: "warning", nodeId });

  // Duplicate node ids
  const idCount = new Map<string, number>();
  for (const n of nodes) idCount.set(n.id, (idCount.get(n.id) ?? 0) + 1);
  for (const [id, c] of idCount) {
    if (c > 1) err("duplicate_node_id", `Node id "${id}" appears ${c}x`, id);
  }
  const idSet = new Set(idCount.keys());

  // Exactly one trigger, and it has no incoming edge
  const triggers = nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) err("no_trigger", "Workflow must have exactly one trigger node");
  else if (triggers.length > 1) {
    err("multiple_triggers", `Workflow has ${triggers.length} trigger nodes (exactly 1 allowed)`);
  }
  const triggerId = triggers[0]?.id;
  if (triggerId && edges.some((e) => e.target === triggerId)) {
    err(
      "trigger_has_incoming",
      "The trigger node must be the entry (no incoming edges)",
      triggerId,
    );
  }

  // Dangling edges (endpoint not a known node)
  for (const e of edges) {
    if (!idSet.has(e.source)) err("dangling_edge", `Edge ${e.id} has unknown source "${e.source}"`);
    if (!idSet.has(e.target)) err("dangling_edge", `Edge ${e.id} has unknown target "${e.target}"`);
  }

  // Adjacency
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  // Reachability from the trigger
  if (triggerId) {
    const seen = new Set<string>([triggerId]);
    const queue = [triggerId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const t of adj.get(cur) ?? []) if (!seen.has(t)) (seen.add(t), queue.push(t));
    }
    for (const n of nodes) {
      if (n.type === "trigger") continue;
      if (!seen.has(n.id)) {
        err("unreachable_node", `Node "${n.id}" (${n.type}) is unreachable from the trigger`, n.id);
      }
    }
  }

  // Hot cycle: a cycle containing no pausing node burns the loop limit.
  if (triggerId) {
    const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
    const onStack = new Set<string>();
    const stack: string[] = [];
    const visited = new Set<string>();
    const flagged = new Set<string>(); // dedupe by cycle entry node

    const dfs = (u: string) => {
      visited.add(u);
      onStack.add(u);
      stack.push(u);
      for (const v of adj.get(u) ?? []) {
        if (onStack.has(v)) {
          // back-edge u→v: cycle is stack[indexOf(v) .. end]
          const i = stack.indexOf(v);
          const cycle = stack.slice(i);
          const hasPause = cycle.some((id) => PAUSING_TYPES.has(typeOf.get(id) ?? ""));
          if (!hasPause && !flagged.has(v)) {
            flagged.add(v);
            warn(
              "hot_cycle",
              `Cycle through "${v}" has no delay/wait node — it will burn the loop limit`,
              v,
            );
          }
        } else if (!visited.has(v)) dfs(v);
      }
      onStack.delete(u);
      stack.pop();
    };
    dfs(triggerId);
  }

  return { ok: !issues.some((i) => i.severity === "error"), errors: issues };
}
