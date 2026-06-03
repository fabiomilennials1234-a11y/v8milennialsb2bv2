/**
 * Slice 9 — FE ⇄ edge sim contract lock. The FE re-declares the simulator/eval
 * enums (cannot import supabase/functions). This asserts they match the edge so
 * the trace/eval UI never renders a step/status the engine doesn't emit.
 */

import { describe, it, expect } from 'vitest';
import * as fe from '../../../src/modules/copilot/lib/copilot-v2-sim';
import { DRY_RUN_STEP_KINDS } from '../../../supabase/functions/_shared/copilot-v2/dry-run-trace.ts';
import { EVAL_STATUSES } from '../../../supabase/functions/_shared/copilot-v2/eval-runner.ts';
import { RUBRIC_TIERS } from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';

describe('FE sim enums match the edge', () => {
  it('DRY_RUN_STEP_KINDS match', () => {
    expect([...fe.DRY_RUN_STEP_KINDS]).toEqual([...DRY_RUN_STEP_KINDS]);
  });

  it('EVAL_STATUSES match', () => {
    expect([...fe.EVAL_STATUSES]).toEqual([...EVAL_STATUSES]);
  });

  it('TIER_VALUES = the rubric tiers + the implicit desqualificado fallback', () => {
    expect([...fe.TIER_VALUES]).toEqual([...RUBRIC_TIERS, 'desqualificado']);
  });

  it('STEP_LABEL covers every step kind', () => {
    for (const k of fe.DRY_RUN_STEP_KINDS) expect(typeof fe.STEP_LABEL[k]).toBe('string');
  });
});
