/**
 * W10 — Governança de custo (Copilot v2)
 *
 * Pure, zero-dep cost computation: given a turn's token usage and the model
 * that produced it, compute the USD cost from an injectable price table. No
 * wall-clock, no I/O, no OpenRouter "cost" field — the price table is the
 * single deterministic source so the simulator/eval stays hermetic. An unknown
 * model THROWS (the caller fail-closes: an un-priced turn must not silently
 * count as zero spend).
 */

import { describe, it, expect } from 'vitest';
import {
  computeCostUsd,
  MODEL_PRICING,
  type TokenUsage,
  type ModelPrice,
} from '../../../supabase/functions/_shared/copilot-v2/cost-pricing.ts';
import type { ModelId } from '../../../supabase/functions/_shared/copilot-v2/model-selector.ts';

// Injected price table for deterministic arithmetic (independent of prod prices).
const PRICES: Record<ModelId, ModelPrice> = {
  'google/gemini-2.5-flash': { inputPerMtok: 1, outputPerMtok: 2 },
  'anthropic/claude-haiku-4-5': { inputPerMtok: 10, outputPerMtok: 20 },
  'anthropic/claude-sonnet-4-6': { inputPerMtok: 100, outputPerMtok: 200 },
};

describe('computeCostUsd', () => {
  it('computes cost = prompt/1e6*input + completion/1e6*output from the injected table', () => {
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 500_000 };
    // sonnet: 1M * $100 + 0.5M * $200 = 100 + 100 = 200
    expect(computeCostUsd(usage, 'anthropic/claude-sonnet-4-6', PRICES)).toBe(200);
  });

  it('returns 0 for zero usage', () => {
    expect(computeCostUsd({ promptTokens: 0, completionTokens: 0 }, 'google/gemini-2.5-flash', PRICES)).toBe(0);
  });

  it('prices each model independently', () => {
    const usage: TokenUsage = { promptTokens: 2_000_000, completionTokens: 1_000_000 };
    // flash: 2M*$1 + 1M*$2 = 4
    expect(computeCostUsd(usage, 'google/gemini-2.5-flash', PRICES)).toBe(4);
    // haiku: 2M*$10 + 1M*$20 = 40
    expect(computeCostUsd(usage, 'anthropic/claude-haiku-4-5', PRICES)).toBe(40);
  });

  it('THROWS on an unknown model (caller fail-closes — never count as zero)', () => {
    const usage: TokenUsage = { promptTokens: 100, completionTokens: 100 };
    expect(() => computeCostUsd(usage, 'openai/gpt-not-real' as ModelId, PRICES)).toThrow();
  });

  it('falls back to the real MODEL_PRICING when no table is injected', () => {
    const usage: TokenUsage = { promptTokens: 1_000_000, completionTokens: 1_000_000 };
    const p = MODEL_PRICING['google/gemini-2.5-flash'];
    const expected = p.inputPerMtok + p.outputPerMtok;
    expect(computeCostUsd(usage, 'google/gemini-2.5-flash')).toBeCloseTo(expected, 10);
  });

  it('is deterministic: same input → same output', () => {
    const usage: TokenUsage = { promptTokens: 12_345, completionTokens: 6_789 };
    const a = computeCostUsd(usage, 'anthropic/claude-sonnet-4-6', PRICES);
    const b = computeCostUsd(usage, 'anthropic/claude-sonnet-4-6', PRICES);
    expect(a).toBe(b);
  });

  it('ships a price entry for every model in the closed ModelId enum', () => {
    const ids: ModelId[] = [
      'google/gemini-2.5-flash',
      'anthropic/claude-haiku-4-5',
      'anthropic/claude-sonnet-4-6',
    ];
    for (const id of ids) {
      expect(MODEL_PRICING[id]).toBeDefined();
      expect(MODEL_PRICING[id].inputPerMtok).toBeGreaterThan(0);
      expect(MODEL_PRICING[id].outputPerMtok).toBeGreaterThan(0);
    }
  });
});
