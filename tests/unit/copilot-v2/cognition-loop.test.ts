/**
 * Slice 2 — cognition tool-loop (Copilot v2)
 *
 * The real turn orchestration: the LLM proposes tool calls; each one passes
 * through the cumulative gates before execution — capability-gate (write off →
 * blocked), introspect-guard (orphan target → blocked), and the tool-call budget
 * (max 5/turn → stop and return to the lead). The LLM is an injected dependency,
 * so the loop is tested with a scripted fake — no live model, no keys.
 */

import { describe, it, expect } from 'vitest';
import {
  runTurn,
  type LlmClient,
  type LlmResponse,
} from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';
import { introspectionUpdateOf } from '../../../supabase/functions/_shared/copilot-v2/tool-registry.ts';

/** Fake LLM that replays a scripted sequence of responses, one per call. */
function scriptedLlm(responses: LlmResponse[]): LlmClient & { calls: number } {
  const llm = {
    calls: 0,
    async complete() {
      const r = responses[Math.min(llm.calls, responses.length - 1)];
      llm.calls++;
      return r;
    },
  };
  return llm;
}

const baseInput = {
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'oi' }],
  toolSchemas: [],
  capabilities: { can_move_stage: true, can_fill_field: true },
  introspection: { stages: ['novo_lead', 'abordado'], fields: ['cnpj'] },
  executeTool: async () => ({ ok: true }),
  writeTargetOf: (name: string, args: Record<string, unknown>) =>
    name === 'move_lead_stage' ? (args.stage as string) : name === 'fill_lead_field' ? (args.field as string) : null,
};

describe('runTurn', () => {
  it('returns the text reply when the LLM makes no tool calls', async () => {
    const llm = scriptedLlm([{ text: 'olá, como posso ajudar?', toolCalls: [] }]);
    const out = await runTurn({ ...baseInput, llm });
    expect(out.reply).toBe('olá, como posso ajudar?');
    expect(out.stoppedReason).toBe('text_reply');
    expect(out.steps).toHaveLength(0);
  });

  it('executes an allowed tool call then returns the follow-up text reply', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'abordado' } }] },
      { text: 'movi pra abordado', toolCalls: [] },
    ]);
    const out = await runTurn({ ...baseInput, llm });
    expect(out.reply).toBe('movi pra abordado');
    expect(out.steps).toEqual([{ name: 'move_lead_stage', allowed: true, reason: null, result: { ok: true } }]);
  });

  it('blocks a write tool whose capability is off (does not execute it)', async () => {
    let executed = false;
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'abordado' } }] },
      { text: 'ok', toolCalls: [] },
    ]);
    const out = await runTurn({
      ...baseInput, llm,
      capabilities: { can_move_stage: false },
      executeTool: async () => { executed = true; return {}; },
    });
    expect(executed).toBe(false);
    expect(out.steps[0]).toMatchObject({ name: 'move_lead_stage', allowed: false, reason: 'capability_off' });
  });

  it('blocks a write to a stage absent from the introspection (orphan target)', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'inexistente' } }] },
      { text: 'ok', toolCalls: [] },
    ]);
    const out = await runTurn({ ...baseInput, llm });
    expect(out.steps[0]).toMatchObject({ name: 'move_lead_stage', allowed: false, reason: 'orphaned_target' });
  });

  it('does NOT introspect-guard read tools (reads run without introspection)', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'get_lead_360', args: {} }] },
      { text: 'pronto', toolCalls: [] },
    ]);
    const out = await runTurn({ ...baseInput, llm, introspection: null });
    expect(out.steps[0]).toMatchObject({ name: 'get_lead_360', allowed: true });
  });

  it('stops at the tool-call budget and returns to the lead (does not call the 6th)', async () => {
    let executions = 0;
    // LLM always asks for another allowed tool call → only the budget stops it.
    // DISTINCT args each call so the W4 repeat-dedup doesn't collapse them — the
    // budget cap is what this proves, not dedup. (get_conversation_history is a
    // read tool: no capability/introspect gate to confound the count.)
    const llm = {
      calls: 0,
      async complete(): Promise<LlmResponse> {
        const i = llm.calls++;
        return { text: null, toolCalls: [{ id: `x${i}`, name: 'get_conversation_history', args: { page: i } }] };
      },
    };
    const out = await runTurn({
      ...baseInput, llm: llm as LlmClient,
      executeTool: async () => { executions++; return {}; },
      maxToolCalls: 5,
    });
    expect(out.stoppedReason).toBe('budget_exceeded');
    expect(executions).toBe(5); // exactly the budget, never the 6th
  });

  it('blocks an unknown tool (fail-closed) without executing', async () => {
    let executed = false;
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'drop_database', args: {} }] },
      { text: 'ok', toolCalls: [] },
    ]);
    const out = await runTurn({ ...baseInput, llm, executeTool: async () => { executed = true; return {}; } });
    expect(executed).toBe(false);
    expect(out.steps[0]).toMatchObject({ name: 'drop_database', allowed: false, reason: 'unknown_tool' });
  });
});

// Regression: schedule_meeting was fail-CLOSED forever because agenda slots
// (dynamic, can't be pre-loaded) never reached the write-after-introspect guard.
// The loop now propagates check_agenda_availability's free slots intra-turn.
describe('runTurn — agenda introspection unlocks schedule_meeting (intra-turn slots)', () => {
  const slot = '2026-06-10T14:00:00.000-03:00';
  const sched = {
    ...baseInput,
    capabilities: { can_schedule_meeting: true },
    introspection: { stages: [], fields: [], slots: [] },
    writeTargetOf: (name: string, args: Record<string, unknown>) =>
      name === 'schedule_meeting' ? (args.datetime as string) : null,
    introspectionUpdateOf, // the REAL registry mapping
  };

  it('blocks schedule_meeting BEFORE any agenda read (slots empty → orphaned, fail-CLOSED)', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'schedule_meeting', args: { datetime: slot } }] },
      { text: 'ok', toolCalls: [] },
    ]);
    const out = await runTurn({ ...sched, llm });
    expect(out.steps[0]).toMatchObject({ name: 'schedule_meeting', allowed: false, reason: 'orphaned_target' });
  });

  it('ALLOWS schedule_meeting after check_agenda_availability returns that slot', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'check_agenda_availability', args: { date_range: 'x/y' } }] },
      { text: null, toolCalls: [{ id: '2', name: 'schedule_meeting', args: { datetime: slot } }] },
      { text: 'agendado', toolCalls: [] },
    ]);
    const out = await runTurn({
      ...sched, llm,
      executeTool: async (name: string) => (name === 'check_agenda_availability' ? { slots: [slot] } : { scheduled: true }),
    });
    const sm = out.steps.find((s) => s.name === 'schedule_meeting')!;
    expect(sm).toMatchObject({ allowed: true, reason: null });
    expect(out.reply).toBe('agendado');
  });

  it('still blocks a datetime NOT among the offered slots (guard stays precise)', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'check_agenda_availability', args: {} }] },
      { text: null, toolCalls: [{ id: '2', name: 'schedule_meeting', args: { datetime: '2026-06-10T18:00:00.000-03:00' } }] },
      { text: 'ok', toolCalls: [] },
    ]);
    const out = await runTurn({
      ...sched, llm,
      executeTool: async (name: string) => (name === 'check_agenda_availability' ? { slots: [slot] } : { scheduled: true }),
    });
    const sm = out.steps.find((s) => s.name === 'schedule_meeting')!;
    expect(sm).toMatchObject({ allowed: false, reason: 'orphaned_target' });
  });
});
