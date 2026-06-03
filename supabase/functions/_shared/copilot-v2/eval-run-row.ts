/**
 * eval-run-row — Copilot v2 (W13). Pure mapper: EvalRunResult → a
 * copilot_v2_eval_runs insert row. Closes the Slice 9 follow-up "persist eval
 * runs" so a prod/CI eval becomes an observable line and the judge→dataset loop
 * has a sink.
 *
 * Invariants: organization_id ALWAYS comes from the caller's resolved context,
 * NEVER from the result/payload (multi-tenant, fail-closed). trace_id is nullable
 * and forward-compatible (CTO decision D4). Pure, zero-dep; the edge does the
 * service_role insert (no authenticated write policy exists).
 */

import type { EvalRunResult } from "./eval-runner.ts";
import type { Archetype } from "./model-selector.ts";

export interface EvalRunRow {
  organization_id: string;
  case_id: string;
  archetype: Archetype;
  status: EvalRunResult["status"];
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  reasoning: string;
  trace_id: string | null;
}

export function evalRunRow(
  result: EvalRunResult,
  organizationId: string,
  traceId?: string | null,
): EvalRunRow {
  return {
    organization_id: organizationId,
    case_id: result.caseId,
    archetype: result.archetype,
    status: result.status,
    expected: result.expected,
    actual: result.actual,
    reasoning: result.reasoning,
    trace_id: traceId ?? null,
  };
}
