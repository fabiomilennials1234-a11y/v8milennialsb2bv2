/**
 * W13 — persistEvalRuns. The edge sink for eval results (Slice 9 follow-up): maps
 * results to rows (org from context) and inserts them via an injected service_role
 * writer. Best-effort no-op on empty; surfaces an insert error loudly.
 */

import { describe, it, expect } from 'vitest';
import { persistEvalRuns } from '../../../supabase/functions/_shared/copilot-v2/eval-run-persist.ts';
import type { EvalRunResult } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';
import type { EvalRunRow } from '../../../supabase/functions/_shared/copilot-v2/eval-run-row.ts';

const result: EvalRunResult = {
  caseId: 'case-uuid-1',
  caseName: 'q · ouro',
  archetype: 'qualificador',
  status: 'pass',
  expected: { tier: 'ouro' },
  actual: { tier: 'ouro' },
  reasoning: 'tier ouro',
};

describe('persistEvalRuns', () => {
  it('maps results to rows with org from context and inserts them', async () => {
    const captured: EvalRunRow[] = [];
    const n = await persistEvalRuns([result], 'org-9', async (rows) => {
      captured.push(...rows);
      return { error: null };
    });
    expect(n).toBe(1);
    expect(captured[0].organization_id).toBe('org-9');
    expect(captured[0].case_id).toBe('case-uuid-1');
    expect(captured[0].trace_id).toBeNull();
  });

  it('no-ops on empty results (never calls the writer)', async () => {
    let called = false;
    const n = await persistEvalRuns([], 'org-9', async () => {
      called = true;
      return { error: null };
    });
    expect(n).toBe(0);
    expect(called).toBe(false);
  });

  it('surfaces an insert error loudly', async () => {
    await expect(
      persistEvalRuns([result], 'org-9', async () => ({ error: { message: 'rls denied' } })),
    ).rejects.toThrow(/rls denied/);
  });
});
