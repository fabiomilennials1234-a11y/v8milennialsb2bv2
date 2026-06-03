/**
 * dry-run-trace — Copilot v2 in-memory trace for the simulator (Slice 9).
 *
 * Maps the runTurn ToolStep[] into the canonical trace-step shape
 * (cognition → tool* → outbound) the simulator UI renders, surfacing the tier
 * from set_qualification_tier. PURE + STATELESS: no supabase/logStep dependency,
 * no created_at, never persisted — a dry-run never writes a copilot_v2_trace_steps
 * row (asserted in the exit suite). Shares the step enum with the real trace so
 * the UI can render both, but this structure lives only in memory.
 */

import type { ToolStep } from "./cognition-loop.ts";
import type { Archetype, ModelId } from "./model-selector.ts";
import type { QualificationTier } from "./rubric-engine.ts";

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
    archetype: Archetype;
    reply: string | null;
    tier?: QualificationTier | null;
    stoppedReason: "text_reply" | "budget_exceeded";
  };
}

export interface BuildDryRunTraceInput {
  archetype: Archetype;
  model: ModelId;
  steps: ToolStep[];
  reply: string | null;
  stoppedReason: "text_reply" | "budget_exceeded";
  /** Optional synthetic id; the simulator replaces the trace each turn. */
  traceId?: string;
}

function tierFromSteps(steps: ToolStep[]): QualificationTier | undefined {
  const tierStep = steps.find((s) => s.name === "set_qualification_tier" && s.allowed);
  const tier = (tierStep?.result as { tier?: QualificationTier } | undefined)?.tier;
  return tier ?? undefined;
}

export function buildDryRunTrace(input: BuildDryRunTraceInput): DryRunTrace {
  const steps: DryRunTraceStep[] = [
    {
      step: "cognition",
      reason: null,
      meta: { archetype: input.archetype, model: input.model, tool_count: input.steps.length },
    },
    ...input.steps.map<DryRunTraceStep>((s) => ({
      step: "tool",
      reason: s.reason,
      meta: { name: s.name, allowed: s.allowed, result: s.result },
    })),
    {
      step: "outbound",
      reason: null,
      meta: { reply_length: input.reply?.length ?? 0 },
    },
  ];

  return {
    trace_id: input.traceId ?? "dryrun-trace",
    steps,
    result: {
      archetype: input.archetype,
      reply: input.reply,
      tier: tierFromSteps(input.steps),
      stoppedReason: input.stoppedReason,
    },
  };
}
