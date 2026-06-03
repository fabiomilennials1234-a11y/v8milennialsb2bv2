/**
 * W13 — eval dataset gate (CI regression block).
 *
 * Scales the Slice 9 g1/g2 smoke to the full per-archetype golden dataset, run
 * HERMETICALLY: the UNCHANGED runEvalSuite drives every golden case through the
 * dry-run spine with cached LLM responses (no live model). Two guarantees:
 *   1. the live eval surface fingerprint still matches the blessed fixture — a
 *      base-prompt/model/tool edit flips it and forces a re-bless (this is the
 *      "prompt/tool/model change triggers the suite" enforcement);
 *   2. zero golden case regresses (no fail/error).
 * A deliberately-wrong expectation in the fixture turns this red — proving the
 * gate blocks a regression (SPEC Slice 10 / Fase D W13 verification).
 */

import { describe, it, expect } from 'vitest';
import { runEvalSuite, type EvalCase, type AgentResolved } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';
import { evalFingerprints } from '../../../supabase/functions/_shared/copilot-v2/eval-fingerprint.ts';
import { makeCachedLlm, type CachedResponses } from '../../../supabase/functions/_shared/copilot-v2/llm-cache.ts';
import type { Archetype } from '../../../supabase/functions/_shared/copilot-v2/model-selector.ts';
import type { SeedSnapshot } from '../../../supabase/functions/_shared/copilot-v2/dry-run-executor.ts';
import GOLDEN from '../../fixtures/copilot-v2/eval-golden.json';

const agents = GOLDEN.agents as Record<Archetype, AgentResolved>;
const seeds = (GOLDEN.seeds ?? {}) as Record<string, SeedSnapshot>;

describe('eval dataset gate (CI regression block)', () => {
  it('live fingerprints match the blessed fixture (prompt/model/tool unchanged)', () => {
    expect(evalFingerprints()).toEqual(GOLDEN.fingerprints);
  });

  it('every golden case passes or skips — zero fail/error (hermetic, no live LLM)', async () => {
    const res = await runEvalSuite(GOLDEN.cases as EvalCase[], {
      agentFor: (a) => agents[a] ?? null,
      makeLlm: makeCachedLlm(GOLDEN.responses as CachedResponses),
      seedFor: (c) => seeds[c.id] ?? {},
    });

    const regressions = res.filter((r) => r.status === 'fail' || r.status === 'error');
    expect(regressions.map((r) => `${r.caseId}: ${r.reasoning}`)).toEqual([]);

    // The cognition goldens must actually run (guard against an all-SKIP no-op gate).
    expect(res.filter((r) => r.status === 'pass').length).toBeGreaterThanOrEqual(5);
  });
});
