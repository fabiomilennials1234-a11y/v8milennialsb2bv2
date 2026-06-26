/**
 * Declarative workflow spec (the DSL the AI authors). docs/adr/0013.
 *
 * One-way: the compiler turns this into a `{nodes,edges}` DAG (no decompiler in v1).
 * Branching steps carry sub-lists that re-converge to the branch's continuation unless they
 * end in a terminal (goto/end). Zod schemas (with tiered config validation) are layered on
 * in a later cycle; these are the structural types the compiler consumes.
 */

export interface DeclTrigger {
  type: string;
  config?: Record<string, unknown>;
}

export interface ActionStep {
  kind: "action";
  actionType: string;
  label?: string;
  config?: Record<string, unknown>;
  ref?: string;
  /** Steps to run on action error (wired via the `error` handle). */
  onError?: Step[];
}

export interface DelayStep {
  kind: "delay";
  amount: number;
  unit: "seconds" | "minutes" | "hours" | "days";
  label?: string;
  ref?: string;
}

export interface ConditionStep {
  kind: "condition";
  field: string;
  operator: string;
  value?: unknown;
  label?: string;
  ref?: string;
  then: Step[];
  else?: Step[];
}

export interface WaitResponseStep {
  kind: "wait_response";
  timeoutHours?: number;
  timeoutMinutes?: number;
  channel?: "whatsapp" | "meta" | "any";
  label?: string;
  ref?: string;
  replied: Step[];
  timeout: Step[];
}

export interface SplitVariant {
  label: string;
  weight: number;
  steps: Step[];
}

export interface SplitStep {
  kind: "split";
  variants: SplitVariant[];
  label?: string;
  ref?: string;
}

export interface CopilotStep {
  kind: "copilot";
  agentId: string;
  label?: string;
  ref?: string;
}

export interface AssignResponsibleStep {
  kind: "assign_responsible";
  assignMode: "round_robin" | "random" | "manual";
  assignTarget: "responsible" | "sdr" | "closer" | "sale";
  assigneeId?: string;
  label?: string;
  ref?: string;
}

export interface WebhookCallStep {
  kind: "webhook_call";
  url: string;
  method: string;
  label?: string;
  ref?: string;
}

export interface WaitBusinessWindowStep {
  kind: "wait_business_window";
  config?: Record<string, unknown>;
  label?: string;
  ref?: string;
}

export interface GotoStep {
  kind: "goto";
  target: string; // a step ref
}

export interface EndStep {
  kind: "end";
  label?: string;
}

export type Step =
  | ActionStep
  | DelayStep
  | ConditionStep
  | WaitResponseStep
  | SplitStep
  | CopilotStep
  | AssignResponsibleStep
  | WebhookCallStep
  | WaitBusinessWindowStep
  | GotoStep
  | EndStep;

export interface DeclSpec {
  name: string;
  description?: string;
  loop_limit?: number;
  trigger: DeclTrigger;
  steps: Step[];
}
