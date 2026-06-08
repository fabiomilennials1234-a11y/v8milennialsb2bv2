/**
 * base-narrative hash smoke-test (Copilot v2 — BASE tab guard).
 *
 * The wizard's BASE tab shows BASE_NARRATIVE (src/modules/copilot/lib/
 * copilot-v2-base-narrative.ts) — a hand-authored product-language mirror of the
 * Torque-owned IMMUTABLE base prompts. It is NOT derived by regex from the prompt
 * (brittle, silently drifts). To keep the mirror honest, this test pins each
 * archetype's base-prompt FNV-1a fingerprint. If a base prompt changes, the
 * matching hash here breaks → the engineer MUST consciously re-review the
 * narrative and re-bless the hash. Same drift-tripwire idea as fe-edge-contract.
 *
 * RE-BLESS (2026-06-08): the base prompts gained a {{company_particularities}}
 * section in §1 (qualificador) / identity (vendedor/carteira); the fingerprints
 * below were regenerated and the narrative reviewed for the new context.
 */

import { describe, it, expect } from 'vitest';
import { BASE_PROMPTS } from '../../../supabase/functions/_shared/copilot-v2/base-prompts.ts';
import { fingerprintOf } from '../../../supabase/functions/_shared/copilot-v2/eval-fingerprint.ts';
import {
  BASE_NARRATIVE,
  NARRATIVE_SECTION_ORDER,
} from '../../../src/modules/copilot/lib/copilot-v2-base-narrative';
import type { Archetype } from '../../../src/modules/copilot/lib/copilot-v2-config';

const ARCHETYPES: Archetype[] = ['qualificador', 'vendedor', 'carteira'];

/** Blessed fingerprints of the base prompts the narrative was authored against. */
const BLESSED: Record<Archetype, string> = {
  qualificador: 'c838b027422e257a',
  vendedor: '27b201e5ef963f45',
  carteira: '5c177fb8da811476',
};

describe('base-narrative hash guard', () => {
  it.each(ARCHETYPES)('%s base prompt still matches the blessed fingerprint', (a) => {
    // If this FAILS: the base prompt text changed. Re-read base-prompts.ts, update
    // BASE_NARRATIVE[%s] to reflect the new behavior, then re-bless BLESSED[%s].
    expect(fingerprintOf(BASE_PROMPTS[a])).toBe(BLESSED[a]);
  });

  it.each(ARCHETYPES)('%s has a complete, non-empty narrative', (a) => {
    const n = BASE_NARRATIVE[a];
    expect(n.label).toBeTruthy();
    expect(n.essence.length).toBeGreaterThan(20);
    for (const { key } of NARRATIVE_SECTION_ORDER) {
      expect(n[key].title).toBeTruthy();
      expect(n[key].points.length).toBeGreaterThanOrEqual(3);
      for (const p of n[key].points) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it('"O que ele nunca faz" is the trust-seal section (rendered green, not red)', () => {
    const sealed = NARRATIVE_SECTION_ORDER.filter((s) => s.isTrustSeal);
    expect(sealed).toHaveLength(1);
    expect(sealed[0].key).toBe('neverDoes');
  });
});
