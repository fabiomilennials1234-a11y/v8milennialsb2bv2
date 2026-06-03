/**
 * Slice 8 — rubric config validation (Copilot v2). The Qualificador's Section 4
 * persists TierRule[] to copilot_v2_rubric, consumed by the deterministic
 * rubric-engine. The wizard's rubric-form must produce a shape the engine reads
 * exactly: closed tier names (no 'desqualificado' — it's the implicit fallback),
 * numeric floors (no coercion), Level enums, strict keys. Validated server-side
 * so a hand-crafted payload can't smuggle junk into the engine.
 */

import { describe, it, expect } from 'vitest';
import { validateRubricRules, RUBRIC_TIERS, RUBRIC_LEVELS } from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';

const goodRule = { tier: 'ouro', minFaturamento: 30000, minRecorrencia: 'media', requiresIcp: true };

describe('validateRubricRules', () => {
  it('accepts a valid rules array', () => {
    const r = validateRubricRules([goodRule, { tier: 'bronze' }]);
    expect(r.ok).toBe(true);
    expect(r.value?.length).toBe(2);
  });

  it('accepts an empty array (presence is the activation-gate concern)', () => {
    expect(validateRubricRules([]).ok).toBe(true);
  });

  it('rejects a non-array', () => {
    expect(validateRubricRules({} as any).ok).toBe(false);
  });

  it('rejects an unknown tier', () => {
    expect(validateRubricRules([{ tier: 'platina' }]).ok).toBe(false);
  });

  it("rejects 'desqualificado' as an editable tier (implicit fallback only)", () => {
    expect(validateRubricRules([{ tier: 'desqualificado' }]).ok).toBe(false);
  });

  it('rejects a non-number floor (no coercion)', () => {
    expect(validateRubricRules([{ tier: 'ouro', minFaturamento: '30000' }]).ok).toBe(false);
  });

  it('rejects an invalid Level', () => {
    expect(validateRubricRules([{ tier: 'ouro', minUrgencia: 'urgente' }]).ok).toBe(false);
  });

  it('rejects an unknown key in a rule', () => {
    expect(validateRubricRules([{ tier: 'ouro', minRegiao: 'SP' }]).ok).toBe(false);
  });

  it('rejects a duplicate tier', () => {
    expect(validateRubricRules([{ tier: 'ouro' }, { tier: 'ouro' }]).ok).toBe(false);
  });

  it('exposes the closed tier + level constants', () => {
    expect(RUBRIC_TIERS).toEqual(['diamante', 'ouro', 'prata', 'bronze']);
    expect(RUBRIC_LEVELS).toEqual(['alta', 'media', 'baixa']);
  });
});
