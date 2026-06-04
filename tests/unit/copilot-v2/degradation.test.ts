/**
 * W10 — Graceful degradation (Copilot v2)
 *
 * Pure mapping from a cost degrade-level (0..3, from decideCostGate) to runtime
 * knobs the worker applies WITHOUT touching the fingerprinted model-selector:
 *  L1 → cheaper model override; L2 → +shrink retrieval; L3 → +holding pattern.
 * The model fallback chain is baked here (sonnet/haiku → flash; flash already
 * cheapest → no override). decideDegradation NEVER edits modelForArchetype, so
 * the eval fingerprint (W13) is untouched.
 */

import { describe, it, expect } from 'vitest';
import { decideDegradation } from '../../../supabase/functions/_shared/copilot-v2/degradation.ts';

describe('decideDegradation', () => {
  it('level 0 → no degradation', () => {
    expect(decideDegradation({ degradeLevel: 0, baseModel: 'anthropic/claude-sonnet-4-6' })).toEqual({
      modelOverride: null, ragShrink: false, holdingPattern: false,
    });
  });

  it('level 1, sonnet base → override to flash only', () => {
    expect(decideDegradation({ degradeLevel: 1, baseModel: 'anthropic/claude-sonnet-4-6' })).toEqual({
      modelOverride: 'google/gemini-2.5-flash', ragShrink: false, holdingPattern: false,
    });
  });

  it('level 1, haiku base → override to flash', () => {
    expect(decideDegradation({ degradeLevel: 1, baseModel: 'anthropic/claude-haiku-4-5' }).modelOverride)
      .toBe('google/gemini-2.5-flash');
  });

  it('level 1, flash base → already cheapest, no override (noop)', () => {
    expect(decideDegradation({ degradeLevel: 1, baseModel: 'google/gemini-2.5-flash' })).toEqual({
      modelOverride: null, ragShrink: false, holdingPattern: false,
    });
  });

  it('level 2 → cheaper model + shrink retrieval, no holding', () => {
    expect(decideDegradation({ degradeLevel: 2, baseModel: 'anthropic/claude-sonnet-4-6' })).toEqual({
      modelOverride: 'google/gemini-2.5-flash', ragShrink: true, holdingPattern: false,
    });
  });

  it('level 3 → cheaper model + shrink retrieval + holding pattern', () => {
    expect(decideDegradation({ degradeLevel: 3, baseModel: 'anthropic/claude-sonnet-4-6' })).toEqual({
      modelOverride: 'google/gemini-2.5-flash', ragShrink: true, holdingPattern: true,
    });
  });

  it('level 3 with flash base → shrink + holding, no model override', () => {
    expect(decideDegradation({ degradeLevel: 3, baseModel: 'google/gemini-2.5-flash' })).toEqual({
      modelOverride: null, ragShrink: true, holdingPattern: true,
    });
  });

  it('is deterministic: same input → same output', () => {
    const inp = { degradeLevel: 2 as const, baseModel: 'anthropic/claude-sonnet-4-6' as const };
    expect(decideDegradation(inp)).toEqual(decideDegradation(inp));
  });
});
