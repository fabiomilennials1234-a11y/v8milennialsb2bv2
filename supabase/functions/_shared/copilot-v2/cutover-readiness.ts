/**
 * cutover-readiness — Copilot v2 per-org cutover gate (Slice 12).
 *
 * Pure policy that decides whether an org has earned the v2 flip. The CTO bar
 * (2026-06-04): the wizard dry-run (Slice 9 simulator) must pass AND the org
 * must have accumulated at least `minHealthyTraces` real inbound traces with
 * zero unhealthy ones. The trace health flags come from the trace store
 * (errors, loop blocks, cost breaches); THIS is the pure go/no-go.
 *
 * Consumed by a cutover validation surface (runbook query / future admin
 * badge). Keeping it pure makes the rollout bar an executable spec, not a
 * judgement call repeated by hand across 60+ orgs.
 */

export interface TraceHealth {
  hadError: boolean;
  loopBlocked: boolean;
  costBreached: boolean;
}

export interface CutoverReadinessInput {
  dryRunPassed: boolean;
  traces: TraceHealth[];
  minHealthyTraces?: number;
}

export interface CutoverReadiness {
  ready: boolean;
  healthyCount: number;
  unhealthyCount: number;
  reasons: string[];
}

/** CTO bar: ~20 clean live traces before an org is declared migrated. */
export const DEFAULT_MIN_HEALTHY_TRACES = 20;

function isHealthy(t: TraceHealth): boolean {
  return !t.hadError && !t.loopBlocked && !t.costBreached;
}

export function evaluateCutoverReadiness(
  input: CutoverReadinessInput,
): CutoverReadiness {
  const min = input.minHealthyTraces ?? DEFAULT_MIN_HEALTHY_TRACES;
  const traces = input.traces ?? [];
  const healthyCount = traces.filter(isHealthy).length;
  const unhealthyCount = traces.length - healthyCount;

  const reasons: string[] = [];
  if (!input.dryRunPassed) reasons.push('dry_run_not_passed');
  if (healthyCount < min) reasons.push(`insufficient_healthy_traces:${healthyCount}/${min}`);
  if (unhealthyCount > 0) reasons.push(`unhealthy_traces_present:${unhealthyCount}`);

  return {
    ready: reasons.length === 0,
    healthyCount,
    unhealthyCount,
    reasons,
  };
}
