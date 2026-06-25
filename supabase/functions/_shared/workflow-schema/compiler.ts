/**
 * Deterministic declarative-spec → workflow DAG compiler (docs/adr/0013).
 *
 * DETERMINISTIC by contract: ids come from a single pre-order counter, layout is a pure
 * function of depth/lane — NO Date.now / Math.random / uuid. runMutation hashes the compiled
 * plan and re-runs compile at confirm time; any non-determinism would break confirm.
 *
 * Continuation-passing wiring: each step compiles to an entry node id + a set of open "tails"
 * (ends awaiting the next step). Branching steps (condition/wait_response/split) re-converge —
 * all their branch tails wire to the continuation's entry. Only ONE branch fires at runtime,
 * so a re-converged node executes once (executor takes a single handle per branch node).
 */
import type { CompiledWorkflow, WorkflowEdge, WorkflowNode } from "./definition.ts";
import type {
  ActionStep,
  AssignResponsibleStep,
  ConditionStep,
  CopilotStep,
  DeclSpec,
  DelayStep,
  SplitStep,
  Step,
  WaitBusinessWindowStep,
  WaitResponseStep,
  WebhookCallStep,
} from "./dsl.ts";

const DEFAULT_LOOP_LIMIT = 100;
const LANE_W = 320;
const ROW_H = 150;

/** Canonical sourceHandles the executor routes on (verified in workflow-executor.ts). */
export const HANDLES = {
  conditionYes: "yes",
  conditionNo: "no",
  waitReplied: "replied",
  waitTimeout: "timeout",
  error: "error",
  variant: (id: string) => `variant_${id}`,
} as const;

interface Tail {
  id: string;
  handle?: string;
}
interface Compiled {
  entry: string | null;
  tails: Tail[];
}

/** Compile a (structurally valid) declarative spec into the executor-facing DAG. Pure. */
export function compileWorkflow(spec: DeclSpec): CompiledWorkflow {
  let seq = 0;
  const nextId = (t: string) => `${t}-${++seq}`;
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];

  const pos = (depth: number, lane = 0) => ({ x: 400 + lane * LANE_W, y: 50 + depth * ROW_H });
  const addEdge = (source: string, target: string, handle?: string) => {
    const id = `${source}__${handle ?? "main"}__${target}`;
    edges.push(handle ? { id, source, target, sourceHandle: handle } : { id, source, target });
  };
  const pushNode = (
    id: string,
    type: string,
    data: Record<string, unknown>,
    depth: number,
    lane = 0,
  ) => nodes.push({ id, type, data, position: pos(depth, lane) });

  const triggerConfig = spec.trigger.config ?? {};
  const triggerId = nextId("trigger");
  pushNode(triggerId, "trigger", {
    type: "trigger",
    triggerType: spec.trigger.type,
    config: triggerConfig,
    label: spec.trigger.type,
  }, 0);

  const body = compileList(spec.steps, 1, 0);
  if (body.entry) addEdge(triggerId, body.entry);
  // body.tails are the workflow's open ends — left dangling (flow ends there).

  function compileList(steps: Step[], depth: number, lane: number): Compiled {
    let entry: string | null = null;
    let open: Tail[] = [];
    let d = depth;
    for (const step of steps) {
      const c = compileStep(step, d, lane);
      if (c.entry) {
        if (entry === null) entry = c.entry;
        else for (const t of open) addEdge(t.id, c.entry, t.handle);
        open = c.tails;
      } else {
        // terminal step with no node (end) — closes the path, no continuation.
        open = c.tails;
      }
      d++;
    }
    return { entry, tails: open };
  }

  function compileStep(step: Step, depth: number, lane: number): Compiled {
    switch (step.kind) {
      case "action": {
        const s = step as ActionStep;
        const id = nextId("action");
        pushNode(
          id,
          "action",
          {
            type: "action",
            actionType: s.actionType,
            label: s.label ?? s.actionType,
            ...(s.config ?? {}),
          },
          depth,
          lane,
        );
        const tails: Tail[] = [{ id }];
        if (s.onError && s.onError.length > 0) {
          const errC = compileList(s.onError, depth + 1, lane + 1);
          if (errC.entry) {
            addEdge(id, errC.entry, HANDLES.error);
            tails.push(...errC.tails);
          }
        }
        return { entry: id, tails };
      }
      case "delay": {
        const s = step as DelayStep;
        const id = nextId("delay");
        pushNode(
          id,
          "delay",
          { type: "delay", amount: s.amount, unit: s.unit, label: s.label ?? "delay" },
          depth,
          lane,
        );
        return { entry: id, tails: [{ id }] };
      }
      case "copilot": {
        const s = step as CopilotStep;
        const id = nextId("copilot");
        pushNode(
          id,
          "copilot",
          { type: "copilot", agentId: s.agentId, label: s.label ?? "copilot" },
          depth,
          lane,
        );
        return { entry: id, tails: [{ id }] };
      }
      case "assign_responsible": {
        const s = step as AssignResponsibleStep;
        const id = nextId("assign_responsible");
        const data: Record<string, unknown> = {
          type: "assign_responsible",
          assignMode: s.assignMode,
          assignTarget: s.assignTarget,
          label: s.label ?? "assign_responsible",
        };
        if (s.assigneeId !== undefined) data.assigneeId = s.assigneeId;
        pushNode(id, "assign_responsible", data, depth, lane);
        return { entry: id, tails: [{ id }] };
      }
      case "webhook_call": {
        const s = step as WebhookCallStep;
        const id = nextId("webhook_call");
        pushNode(
          id,
          "webhook_call",
          { type: "webhook_call", url: s.url, method: s.method, label: s.label ?? "webhook_call" },
          depth,
          lane,
        );
        return { entry: id, tails: [{ id }] };
      }
      case "wait_business_window": {
        const s = step as WaitBusinessWindowStep;
        const id = nextId("wait_business_window");
        pushNode(
          id,
          "wait_business_window",
          {
            type: "wait_business_window",
            label: s.label ?? "wait_business_window",
            ...(s.config ?? {}),
          },
          depth,
          lane,
        );
        return { entry: id, tails: [{ id }] };
      }
      case "condition": {
        const s = step as ConditionStep;
        const id = nextId("condition");
        const data: Record<string, unknown> = {
          type: "condition",
          field: s.field,
          operator: s.operator,
          label: s.label ?? "condition",
        };
        if (s.value !== undefined) data.value = s.value;
        pushNode(id, "condition", data, depth, lane);

        const tails: Tail[] = [];
        const thenC = compileList(s.then, depth + 1, lane);
        if (thenC.entry) {
          addEdge(id, thenC.entry, HANDLES.conditionYes);
          tails.push(...thenC.tails);
        } else tails.push({ id, handle: HANDLES.conditionYes });

        const elseC = compileList(s.else ?? [], depth + 1, lane + 1);
        if (elseC.entry) {
          addEdge(id, elseC.entry, HANDLES.conditionNo);
          tails.push(...elseC.tails);
        } else tails.push({ id, handle: HANDLES.conditionNo });

        return { entry: id, tails };
      }
      case "wait_response": {
        const s = step as WaitResponseStep;
        const id = nextId("wait_response");
        pushNode(
          id,
          "wait_response",
          {
            type: "wait_response",
            timeoutHours: s.timeoutHours ?? 0,
            timeoutMinutes: s.timeoutMinutes ?? 0,
            channel: s.channel ?? "any",
            label: s.label ?? "wait_response",
          },
          depth,
          lane,
        );

        const tails: Tail[] = [];
        const repC = compileList(s.replied, depth + 1, lane);
        if (repC.entry) {
          addEdge(id, repC.entry, HANDLES.waitReplied);
          tails.push(...repC.tails);
        } else tails.push({ id, handle: HANDLES.waitReplied });

        const toC = compileList(s.timeout, depth + 1, lane + 1);
        if (toC.entry) {
          addEdge(id, toC.entry, HANDLES.waitTimeout);
          tails.push(...toC.tails);
        } else tails.push({ id, handle: HANDLES.waitTimeout });

        return { entry: id, tails };
      }
      case "split": {
        const s = step as SplitStep;
        const id = nextId("split_ab");
        const variants = s.variants.map((v, i) => ({
          id: `v${i + 1}`,
          label: v.label,
          percentage: v.weight,
        }));
        pushNode(
          id,
          "split_ab",
          { type: "split_ab", variants, label: s.label ?? "split_ab" },
          depth,
          lane,
        );
        const tails: Tail[] = [];
        s.variants.forEach((v, i) => {
          const vid = `v${i + 1}`;
          const vc = compileList(v.steps, depth + 1, lane + i);
          if (vc.entry) {
            addEdge(id, vc.entry, HANDLES.variant(vid));
            tails.push(...vc.tails);
          } else tails.push({ id, handle: HANDLES.variant(vid) });
        });
        return { entry: id, tails };
      }
      case "end": {
        const id = nextId("end");
        pushNode(id, "end", { type: "end", label: "end" }, depth, lane);
        return { entry: id, tails: [] }; // terminal — no continuation
      }
      default:
        throw new Error(
          `compileWorkflow: unsupported step kind "${(step as { kind: string }).kind}"`,
        );
    }
  }

  return {
    name: spec.name,
    description: spec.description ?? null,
    trigger_type: spec.trigger.type,
    trigger_config: triggerConfig,
    loop_limit: spec.loop_limit ?? DEFAULT_LOOP_LIMIT,
    definition: { nodes, edges },
  };
}
