/**
 * Slice 12 — per-org cutover readiness gate (CTO decision: dry-run + ~20 clean
 * live traces before an org counts as migrated to v2).
 *
 * Pure policy: an org is ready to be declared migrated only when the wizard
 * dry-run passed AND it has accumulated at least `minHealthyTraces` real inbound
 * traces with ZERO unhealthy ones (no cognition error, no loop block, no cost
 * breach). A single bad trace among them holds the org back — the 🔴 inbound
 * path earns the flip, it isn't assumed.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCutoverReadiness,
  DEFAULT_MIN_HEALTHY_TRACES,
} from '../../../supabase/functions/_shared/copilot-v2/cutover-readiness.ts';

const healthy = () => ({ hadError: false, loopBlocked: false, costBreached: false });
const traces = (n: number) => Array.from({ length: n }, healthy);

describe('evaluateCutoverReadiness', () => {
  it('is ready with dry-run passed and exactly the minimum clean traces', () => {
    const r = evaluateCutoverReadiness({ dryRunPassed: true, traces: traces(20), minHealthyTraces: 20 });
    expect(r.ready).toBe(true);
    expect(r.healthyCount).toBe(20);
    expect(r.reasons).toEqual([]);
  });

  it('blocks when the dry-run did not pass', () => {
    const r = evaluateCutoverReadiness({ dryRunPassed: false, traces: traces(20), minHealthyTraces: 20 });
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain('dry_run_not_passed');
  });

  it('blocks when there are too few healthy traces', () => {
    const r = evaluateCutoverReadiness({ dryRunPassed: true, traces: traces(19), minHealthyTraces: 20 });
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain('insufficient_healthy_traces:19/20');
  });

  it('blocks when any trace is unhealthy, even with enough healthy ones', () => {
    const mixed = [...traces(20), { hadError: true, loopBlocked: false, costBreached: false }];
    const r = evaluateCutoverReadiness({ dryRunPassed: true, traces: mixed, minHealthyTraces: 20 });
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain('unhealthy_traces_present:1');
  });

  it('defaults the threshold to DEFAULT_MIN_HEALTHY_TRACES when omitted', () => {
    expect(DEFAULT_MIN_HEALTHY_TRACES).toBe(20);
    expect(evaluateCutoverReadiness({ dryRunPassed: true, traces: traces(20) }).ready).toBe(true);
    expect(evaluateCutoverReadiness({ dryRunPassed: true, traces: traces(19) }).ready).toBe(false);
  });
});
