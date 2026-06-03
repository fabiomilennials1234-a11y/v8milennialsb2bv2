/**
 * Slice 9 — in-memory DryRunTrace builder (Copilot v2). Maps the runTurn
 * ToolStep[] into the canonical trace-step shape the simulator UI renders
 * (cognition → tool* → outbound), surfacing the tier from set_qualification_tier.
 * PURE and STATELESS: it takes no supabase/logStep dependency and never persists
 * — a dry-run trace must never write a copilot_v2_trace_steps row.
 */

import { describe, it, expect } from 'vitest';
import { buildDryRunTrace } from '../../../supabase/functions/_shared/copilot-v2/dry-run-trace.ts';
import type { ToolStep } from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';

const steps: ToolStep[] = [
  { name: 'move_lead_stage', allowed: false, reason: 'capability_off' },
  { name: 'set_qualification_tier', allowed: true, reason: null, result: { would_execute: true, applied: true, tier: 'ouro' } },
];

describe('buildDryRunTrace', () => {
  const trace = buildDryRunTrace({ archetype: 'qualificador', model: 'google/gemini-2.5-flash', steps, reply: 'Olá!', stoppedReason: 'text_reply' });

  it('opens with a cognition step carrying archetype/model/tool_count', () => {
    expect(trace.steps[0].step).toBe('cognition');
    expect(trace.steps[0].meta).toMatchObject({ archetype: 'qualificador', model: 'google/gemini-2.5-flash', tool_count: 2 });
  });

  it('renders one tool step per ToolStep with allowed/reason/name', () => {
    const toolSteps = trace.steps.filter((s) => s.step === 'tool');
    expect(toolSteps).toHaveLength(2);
    expect(toolSteps[0].meta).toMatchObject({ name: 'move_lead_stage', allowed: false });
    expect(toolSteps[0].reason).toBe('capability_off');
    expect(toolSteps[1].meta).toMatchObject({ name: 'set_qualification_tier', allowed: true });
  });

  it('closes with an outbound step carrying the reply length', () => {
    const last = trace.steps[trace.steps.length - 1];
    expect(last.step).toBe('outbound');
    expect(last.meta).toMatchObject({ reply_length: 4 });
  });

  it('surfaces the tier from set_qualification_tier into the result', () => {
    expect(trace.result.tier).toBe('ouro');
    expect(trace.result.archetype).toBe('qualificador');
    expect(trace.result.reply).toBe('Olá!');
    expect(trace.result.stoppedReason).toBe('text_reply');
  });

  it('has a synthetic trace_id and no created_at timestamps (in-memory only)', () => {
    expect(typeof trace.trace_id).toBe('string');
    for (const s of trace.steps) expect('created_at' in s).toBe(false);
  });

  it('budget_exceeded with a null reply still closes with an outbound step (reply_length 0)', () => {
    const t = buildDryRunTrace({ archetype: 'vendedor', model: 'anthropic/claude-sonnet-4-6', steps: [], reply: null, stoppedReason: 'budget_exceeded' });
    expect(t.steps[t.steps.length - 1].meta).toMatchObject({ reply_length: 0 });
    expect(t.result.tier).toBeUndefined();
  });
});
