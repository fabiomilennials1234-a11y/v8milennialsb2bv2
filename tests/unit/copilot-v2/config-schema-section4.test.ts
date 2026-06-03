/**
 * Slice 8 — Section 4 (objective/segments) + closed-enum extension to the config
 * contract (Copilot v2). The Qualificador's Section 4 is the rubric (persisted
 * separately to copilot_v2_rubric); the Vendedor/Carteira Section 4 is a CURATED
 * objective dropdown (CTO decision). objective + carteira segments are
 * behavior-driving closed enums (the carteira objective compiles into the
 * subordinated {{specific_notes}}), so they are validated server-side — a value
 * outside the enum, or an objective on the Qualificador (which has no objective
 * slot), is rejected.
 */

import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  VENDEDOR_OBJECTIVES,
  CARTEIRA_OBJECTIVES,
  CARTEIRA_SEGMENTS,
  TONE_OPTIONS,
  BUSINESS_HOURS_OPTIONS,
} from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';

describe('Section 4 — objective enum', () => {
  it('accepts a valid vendedor objective', () => {
    const r = validateConfig('vendedor', { objective: VENDEDOR_OBJECTIVES[0], capabilities: { can_transfer: true } });
    expect(r.ok).toBe(true);
    expect(r.value?.objective).toBe(VENDEDOR_OBJECTIVES[0]);
  });

  it('rejects a vendedor objective outside the enum', () => {
    const r = validateConfig('vendedor', { objective: 'dominar_o_mundo', capabilities: {} });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/objective/);
  });

  it('rejects any objective on the qualificador (it uses the rubric, not an objective)', () => {
    const r = validateConfig('qualificador', { objective: VENDEDOR_OBJECTIVES[0], capabilities: {} });
    expect(r.ok).toBe(false);
  });

  it('accepts a valid carteira objective', () => {
    const r = validateConfig('carteira', { objective: CARTEIRA_OBJECTIVES[0], capabilities: { can_transfer: true } });
    expect(r.ok).toBe(true);
  });
});

describe('Section 4 — carteira segments', () => {
  it('accepts a subset of the known segments', () => {
    const r = validateConfig('carteira', { objective: CARTEIRA_OBJECTIVES[0], segments: ['ouro', 'resgate'], capabilities: {} });
    expect(r.ok).toBe(true);
    expect(r.value?.segments).toEqual(['ouro', 'resgate']);
  });

  it('rejects an unknown segment', () => {
    const r = validateConfig('carteira', { segments: ['platina'], capabilities: {} });
    expect(r.ok).toBe(false);
  });

  it('rejects segments on a non-carteira archetype', () => {
    const r = validateConfig('vendedor', { segments: ['ouro'], capabilities: {} });
    expect(r.ok).toBe(false);
  });
});

describe('closed-enum constants exported for the wizard dropdowns', () => {
  it('exposes non-empty objective/segment/tone/hours option sets', () => {
    expect(VENDEDOR_OBJECTIVES.length).toBeGreaterThan(0);
    expect(CARTEIRA_OBJECTIVES.length).toBeGreaterThan(0);
    expect(CARTEIRA_SEGMENTS).toEqual(['ouro', 'prata', 'novo', 'resgate', 'dormindo']);
    for (const a of ['qualificador', 'vendedor', 'carteira'] as const) {
      expect(TONE_OPTIONS[a].length).toBeGreaterThan(0);
    }
    expect(BUSINESS_HOURS_OPTIONS.length).toBeGreaterThan(0);
  });
});
