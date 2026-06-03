/**
 * Slice 9 — eval-cases-loader row mapping (Copilot v2). The DB row → EvalCase
 * mapping is pure and tested; the actual fetch is org-scoped by RLS (user client)
 * in the edge. Nulls map to undefined (so the runner's "no expectation → skip"
 * path triggers correctly).
 */

import { describe, it, expect } from 'vitest';
import { mapRowToEvalCase, type EvalCaseRow } from '../../../supabase/functions/_shared/copilot-v2/eval-cases-loader.ts';

const row: EvalCaseRow = {
  id: 'c1', archetype: 'qualificador', case_name: 'lead grande', input_message: 'faturo 50k',
  expected_tier: 'ouro', expected_tool: null, expected_action: null, enabled: true,
};

describe('mapRowToEvalCase', () => {
  it('maps snake_case columns to the EvalCase shape', () => {
    const c = mapRowToEvalCase(row);
    expect(c).toMatchObject({ id: 'c1', caseName: 'lead grande', archetype: 'qualificador', inputMessage: 'faturo 50k', enabled: true, expectedTier: 'ouro' });
  });

  it('maps null expectations to undefined (so the runner skips uncheckable cases)', () => {
    const c = mapRowToEvalCase({ ...row, expected_tier: null });
    expect(c.expectedTier).toBeUndefined();
    expect(c.expectedTool).toBeUndefined();
    expect(c.expectedAction).toBeUndefined();
  });
});
