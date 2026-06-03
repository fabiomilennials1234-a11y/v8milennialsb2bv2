/**
 * W13 — eval-run-row. Pure mapper from an EvalRunResult to a copilot_v2_eval_runs
 * row. org ALWAYS comes from the caller's context, never from the result payload
 * (fail-closed multi-tenant invariant). trace_id is nullable + forward-compatible
 * (CTO decision D4: populated when a prod turn promotes; not required for MVP).
 */

import { describe, it, expect } from 'vitest';
import { evalRunRow } from '../../../supabase/functions/_shared/copilot-v2/eval-run-row.ts';
import type { EvalRunResult } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';

const result: EvalRunResult = {
  caseId: 'case-uuid-1',
  caseName: 'qualificador · ouro',
  archetype: 'qualificador',
  status: 'pass',
  expected: { tier: 'ouro' },
  actual: { tier: 'ouro' },
  reasoning: 'tier ouro',
};

describe('eval-run-row', () => {
  it('maps a result to a row with org from context + null trace_id by default', () => {
    const row = evalRunRow(result, 'org-9');
    expect(row.organization_id).toBe('org-9');
    expect(row.case_id).toBe('case-uuid-1');
    expect(row.archetype).toBe('qualificador');
    expect(row.status).toBe('pass');
    expect(row.expected).toEqual({ tier: 'ouro' });
    expect(row.actual).toEqual({ tier: 'ouro' });
    expect(row.reasoning).toBe('tier ouro');
    expect(row.trace_id).toBeNull();
  });

  it('carries a trace_id when one is available (forward-compat)', () => {
    expect(evalRunRow(result, 'org-9', 'trace-abc').trace_id).toBe('trace-abc');
  });

  it('NEVER takes organization_id from the result payload (anti-spoofing)', () => {
    const tainted = { ...result, organization_id: 'attacker-org' } as unknown as EvalRunResult;
    expect(evalRunRow(tainted, 'org-9').organization_id).toBe('org-9');
  });
});
