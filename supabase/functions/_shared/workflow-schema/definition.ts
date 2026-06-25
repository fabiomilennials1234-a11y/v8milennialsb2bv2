/**
 * Compiled workflow shapes — the executor-facing contract (mirrors what
 * `workflows.definition` stores and what `_shared/workflow-executor.ts` reads).
 * See .specs / docs/adr/0013. Pure types, no deps.
 */

export interface WorkflowNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Omitted for generic single-out nodes. Canonical handles: yes/no, replied/timeout, variant_<id>, error. */
  sourceHandle?: string;
  data?: { loopLimit?: number };
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** What the compiler returns: the DB row fields + the DAG. */
export interface CompiledWorkflow {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  loop_limit: number;
  definition: WorkflowDefinition;
}
