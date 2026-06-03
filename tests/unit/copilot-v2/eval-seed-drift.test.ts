/**
 * W13 — golden seed ↔ fixture parity (anti-drift). CTO decision D3: the committed
 * CI fixture and the DB seed migration must come from ONE source. This test ties
 * them: every golden case in eval-golden.json must appear in the seed migration
 * (name + input + expectation), and the seed must add no rows beyond the fixture.
 * Editing one without the other turns this red.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import GOLDEN from '../../fixtures/copilot-v2/eval-golden.json';

const here = dirname(fileURLToPath(import.meta.url));
const seedSql = readFileSync(
  resolve(here, '../../../supabase/migrations/20260603120000_copilot_v2_eval_seed_golden.sql'),
  'utf8',
);

type Case = { caseName: string; inputMessage: string; expectedTier?: string; expectedTool?: string; expectedAction?: string };

describe('eval golden seed ↔ fixture parity (anti-drift)', () => {
  it('seed migration contains every golden case (name + input + expectation)', () => {
    for (const c of GOLDEN.cases as Case[]) {
      expect(seedSql).toContain(c.caseName);
      expect(seedSql).toContain(c.inputMessage);
      const expectation = c.expectedTier ?? c.expectedTool ?? c.expectedAction!;
      expect(seedSql).toContain(expectation);
    }
  });

  it('seed migration adds no rows beyond the fixture (one tuple per case)', () => {
    const tuples = (seedSql.match(/::copilot_v2_archetype/g) ?? []).length;
    expect(tuples).toBe((GOLDEN.cases as Case[]).length);
  });

  it('seed is guarded on the org existing (safe no-op on a fresh DB) and idempotent', () => {
    expect(seedSql).toMatch(/where exists\s*\(\s*select 1 from public\.organizations/i);
    expect(seedSql).toMatch(/not exists/i);
  });
});
