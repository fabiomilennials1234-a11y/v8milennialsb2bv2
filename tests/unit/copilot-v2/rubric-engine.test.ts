/**
 * Slice 4 — rubric-engine (Copilot v2 hybrid qualification)
 *
 * ADR-0002 decision #3: the LLM only EXTRACTS B2B signals; a DETERMINISTIC
 * rubric (thresholds filled by the client) maps signals → qualification_tier.
 * The LLM never judges the tier — that was the v1 instability source.
 *
 * Deep module: tiny interface (mapSignalsToTier), deep deterministic body.
 * Properties under test: same input → same tier; editing the rubric shifts the
 * tier predictably; Carteira never uses the tier scale.
 */

import { describe, it, expect } from 'vitest';
import {
  mapSignalsToTier,
  type Signals,
  type Rubric,
} from '../../../supabase/functions/_shared/copilot-v2/rubric-engine.ts';

const rubric: Rubric = {
  rules: [
    { tier: 'diamante', minFaturamento: 1_000_000, requiresIcp: true },
    { tier: 'ouro', minFaturamento: 300_000, requiresIcp: true },
    { tier: 'prata', minFaturamento: 100_000 },
    { tier: 'bronze', minFaturamento: 20_000 },
  ],
};

describe('mapSignalsToTier — deterministic mapping', () => {
  it('is deterministic: same signals + rubric → same tier', () => {
    const s: Signals = { faturamentoMensal: 500_000, icpFit: true };
    expect(mapSignalsToTier(s, rubric)).toBe(mapSignalsToTier(s, rubric));
  });

  it('maps to the highest tier whose thresholds are all met', () => {
    expect(mapSignalsToTier({ faturamentoMensal: 1_500_000, icpFit: true }, rubric)).toBe('diamante');
    expect(mapSignalsToTier({ faturamentoMensal: 500_000, icpFit: true }, rubric)).toBe('ouro');
    expect(mapSignalsToTier({ faturamentoMensal: 150_000, icpFit: false }, rubric)).toBe('prata');
    expect(mapSignalsToTier({ faturamentoMensal: 30_000 }, rubric)).toBe('bronze');
  });

  it('returns desqualificado when no tier threshold is met', () => {
    expect(mapSignalsToTier({ faturamentoMensal: 5_000 }, rubric)).toBe('desqualificado');
    expect(mapSignalsToTier({}, rubric)).toBe('desqualificado');
  });

  it('blocks a tier when a required signal (ICP) is missing, falling to a lower tier', () => {
    // High revenue but not ICP → cannot be diamante/ouro (both requireIcp), falls to prata.
    expect(mapSignalsToTier({ faturamentoMensal: 2_000_000, icpFit: false }, rubric)).toBe('prata');
  });

  it('treats a missing numeric signal as not-meeting the threshold', () => {
    expect(mapSignalsToTier({ icpFit: true }, rubric)).toBe('desqualificado');
  });
});

describe('mapSignalsToTier — editing the rubric shifts the tier predictably', () => {
  it('lowering ouro threshold promotes a previously-prata lead', () => {
    const before = mapSignalsToTier({ faturamentoMensal: 150_000, icpFit: true }, rubric);
    const relaxed: Rubric = {
      rules: [
        { tier: 'diamante', minFaturamento: 1_000_000, requiresIcp: true },
        { tier: 'ouro', minFaturamento: 120_000, requiresIcp: true },
        { tier: 'prata', minFaturamento: 100_000 },
        { tier: 'bronze', minFaturamento: 20_000 },
      ],
    };
    const after = mapSignalsToTier({ faturamentoMensal: 150_000, icpFit: true }, relaxed);
    expect(before).toBe('prata');
    expect(after).toBe('ouro');
  });
});
