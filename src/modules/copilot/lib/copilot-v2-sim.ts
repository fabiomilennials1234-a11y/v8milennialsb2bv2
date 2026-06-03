/**
 * copilot-v2-sim — frontend contract mirror for the Slice 9 simulator/eval-suite.
 *
 * The canonical types live in the edge (dry-run-trace.ts, eval-runner.ts,
 * rubric-engine.ts). The FE build cannot import supabase/functions, so the
 * enums are re-declared here and a contract-lock test
 * (tests/unit/copilot-v2/fe-edge-sim-contract.test.ts) asserts they never drift.
 */

export const TIER_VALUES = ["diamante", "ouro", "prata", "bronze", "desqualificado"] as const;
export type TierValue = (typeof TIER_VALUES)[number];

export const EVAL_STATUSES = ["pass", "fail", "skip", "error"] as const;
export type EvalStatus = (typeof EVAL_STATUSES)[number];

export const DRY_RUN_STEP_KINDS = ["border", "gate", "enqueue", "cognition", "tool", "outbound"] as const;
export type DryRunStepKind = (typeof DRY_RUN_STEP_KINDS)[number];

export interface DryRunTraceStep {
  step: DryRunStepKind;
  reason: string | null;
  meta: Record<string, unknown>;
}

export interface DryRunTrace {
  trace_id: string;
  steps: DryRunTraceStep[];
  result: {
    archetype: string;
    reply: string | null;
    tier?: TierValue | null;
    stoppedReason: "text_reply" | "budget_exceeded";
  };
}

export interface SimulateResponse {
  trace: DryRunTrace;
  writes: Array<{ tool: string; args: Record<string, unknown>; tier?: string | null }>;
  reply: string | null;
  model: string;
}

export interface EvalRunResult {
  caseId: string;
  caseName: string;
  archetype: string;
  status: EvalStatus;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  reasoning: string;
}

export interface EvalSuiteResponse {
  summary: { total: number; pass: number; fail: number; skip: number; error: number };
  results: EvalRunResult[];
}

/** Human label + accent token for a step kind (dark-first UI). */
export const STEP_LABEL: Record<DryRunStepKind, string> = {
  border: "Borda",
  gate: "Gate",
  enqueue: "Fila",
  cognition: "Cognição",
  tool: "Ferramenta",
  outbound: "Resposta",
};
