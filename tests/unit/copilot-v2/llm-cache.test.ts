/**
 * W13 — llm-cache. The dataset CI gate must be hermetic: it replays committed LLM
 * responses keyed by (case_id, model), never calls a live model (CI has no API
 * key + non-determinism would break the gate). A cache miss must throw loudly so
 * an incomplete fixture fails the gate instead of silently hitting the network.
 */

import { describe, it, expect } from 'vitest';
import { makeCachedLlm, type CachedResponses } from '../../../supabase/functions/_shared/copilot-v2/llm-cache.ts';
import type { EvalCase } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';

const caseFor = (id: string): EvalCase => ({
  id,
  caseName: id,
  archetype: 'qualificador',
  inputMessage: 'x',
  enabled: true,
});

const CACHE: CachedResponses = {
  c1: {
    'google/gemini-2.5-flash': [
      { text: null, toolCalls: [{ id: '1', name: 'set_qualification_tier', args: {} }] },
      { text: 'pronto', toolCalls: [] },
    ],
  },
};

describe('llm-cache', () => {
  it('replays cached responses in order for a known (case_id, model)', async () => {
    const make = makeCachedLlm(CACHE);
    const llm = make('google/gemini-2.5-flash', caseFor('c1'));
    const r1 = await llm.complete({ system: 's', messages: [], tools: [] });
    const r2 = await llm.complete({ system: 's', messages: [], tools: [] });
    expect(r1.toolCalls[0].name).toBe('set_qualification_tier');
    expect(r2.text).toBe('pronto');
  });

  it('throws a loud cache miss for an unknown model (never falls through to live LLM)', () => {
    const make = makeCachedLlm(CACHE);
    expect(() => make('anthropic/claude-sonnet-4-6', caseFor('c1'))).toThrow(/cache miss/i);
  });

  it('throws a loud cache miss for an unknown case_id', () => {
    const make = makeCachedLlm(CACHE);
    expect(() => make('google/gemini-2.5-flash', caseFor('nope'))).toThrow(/cache miss/i);
  });
});
