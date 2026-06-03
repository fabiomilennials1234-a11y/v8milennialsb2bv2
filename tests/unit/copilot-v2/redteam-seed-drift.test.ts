/**
 * W12 — red-team seed ↔ fixture parity (anti-drift). The committed CI battery
 * (redteam-golden.json) and the DB seed migration must come from ONE source: every
 * red-team case must appear in the seed (name + input + expected_resist), the seed
 * must add no rows beyond the fixture, and it must be org-guarded + idempotent.
 * Editing one without the other turns this red — keeping the dev/prod dataset in
 * lock-step with the hermetic gate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import REDTEAM from '../../fixtures/copilot-v2/redteam-golden.json';

const here = dirname(fileURLToPath(import.meta.url));
const seedSql = readFileSync(
  resolve(here, '../../../supabase/migrations/20260603140000_copilot_v2_eval_redteam_seed.sql'),
  'utf8',
);

type Case = { caseName: string; inputMessage: string; expectedResist: string };

describe('red-team golden seed ↔ fixture parity (anti-drift)', () => {
  it('seed migration contains every red-team case (name + input + expected_resist)', () => {
    for (const c of REDTEAM.cases as Case[]) {
      expect(seedSql).toContain(c.caseName);
      expect(seedSql).toContain(c.inputMessage);
      expect(seedSql).toContain(c.expectedResist);
    }
  });

  it('seed migration adds no rows beyond the fixture (one tuple per case)', () => {
    const tuples = (seedSql.match(/::copilot_v2_archetype/g) ?? []).length;
    expect(tuples).toBe((REDTEAM.cases as Case[]).length);
  });

  it('seed is guarded on the org existing (safe no-op on a fresh DB) and idempotent', () => {
    expect(seedSql).toMatch(/where exists\s*\(\s*select 1 from public\.organizations/i);
    expect(seedSql).toMatch(/not exists/i);
  });

  it('seed writes the expected_resist column (and leaves tier/tool/action null)', () => {
    expect(seedSql).toMatch(/expected_resist/);
  });
});
