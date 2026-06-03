/**
 * Slice 8 — FE ⇄ edge contract lock. The frontend re-declares the wizard
 * constants (it cannot import from supabase/functions). This test imports BOTH
 * and asserts they are identical, so the client form and the server validator
 * can never silently drift apart.
 */

import { describe, it, expect } from 'vitest';
import * as fe from '../../../src/modules/copilot/lib/copilot-v2-config';
import * as edge from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';
import { ALL_WRITE_CAPABILITIES } from '../../../supabase/functions/_shared/copilot-v2/capability-gate.ts';

describe('FE constants match the edge contract', () => {
  it('CAPABILITY_FLAGS == edge ALL_WRITE_CAPABILITIES', () => {
    expect([...fe.CAPABILITY_FLAGS].sort()).toEqual([...ALL_WRITE_CAPABILITIES].sort());
  });

  it('ALLOWED_CAPABILITIES_BY_ARCHETYPE matches per archetype', () => {
    for (const a of ['qualificador', 'vendedor', 'carteira'] as const) {
      expect([...fe.ALLOWED_CAPABILITIES_BY_ARCHETYPE[a]].sort()).toEqual(
        [...edge.ALLOWED_CAPABILITIES_BY_ARCHETYPE[a]].sort(),
      );
    }
  });

  it('objective + segment enums match', () => {
    expect([...fe.VENDEDOR_OBJECTIVES]).toEqual([...edge.VENDEDOR_OBJECTIVES]);
    expect([...fe.CARTEIRA_OBJECTIVES]).toEqual([...edge.CARTEIRA_OBJECTIVES]);
    expect([...fe.CARTEIRA_SEGMENTS]).toEqual([...edge.CARTEIRA_SEGMENTS]);
  });

  it('tone + hours + rubric enums match', () => {
    for (const a of ['qualificador', 'vendedor', 'carteira'] as const) {
      expect([...fe.TONE_OPTIONS[a]]).toEqual([...edge.TONE_OPTIONS[a]]);
    }
    expect([...fe.BUSINESS_HOURS_OPTIONS]).toEqual([...edge.BUSINESS_HOURS_OPTIONS]);
    expect([...fe.RUBRIC_TIERS]).toEqual([...edge.RUBRIC_TIERS]);
    expect([...fe.RUBRIC_LEVELS]).toEqual([...edge.RUBRIC_LEVELS]);
  });

  it('escape-hatch cap matches', () => {
    expect(fe.ESCAPE_HATCH_MAX).toBe(edge.ESCAPE_HATCH_MAX);
  });

  it('OBJECTIVE_LABELS covers every objective key', () => {
    for (const k of [...fe.VENDEDOR_OBJECTIVES, ...fe.CARTEIRA_OBJECTIVES]) {
      expect(typeof fe.OBJECTIVE_LABELS[k]).toBe('string');
    }
  });
});

describe('toSavePayload', () => {
  it('includes rubricRules only for qualificador', () => {
    const cfg = { capabilities: {} };
    expect(fe.toSavePayload('a', 'qualificador', cfg, false, [{ tier: 'ouro' }]).rubricRules).toBeDefined();
    expect(fe.toSavePayload('a', 'vendedor', cfg, false, [{ tier: 'ouro' }]).rubricRules).toBeUndefined();
  });
});

describe('missingHardForActivation (client mirror)', () => {
  const full = {
    company: { name: 'X' }, icp: 'y', products: ['p'], tone: 't', businessHours: 'h',
    capabilities: { can_move_stage: true },
  };
  it('passes a complete vendedor with objective + policy', () => {
    expect(fe.missingHardForActivation('vendedor', { ...full, objective: 'fechar_conversa', commercialPolicy: 'x' }, 0)).toEqual([]);
  });
  it('flags a qualificador with no rubric rules', () => {
    expect(fe.missingHardForActivation('qualificador', full, 0)).toContain('rubric');
  });
  it('flags carteira missing handoffTarget', () => {
    expect(fe.missingHardForActivation('carteira', { ...full, objective: 'recompra', commercialPolicy: 'x' }, 0)).toContain('handoffTarget');
  });
});
