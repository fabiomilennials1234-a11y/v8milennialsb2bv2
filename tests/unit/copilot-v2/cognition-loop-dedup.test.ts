/**
 * W4 — tool-call repeat dedup (Copilot v2)
 *
 * SPEC L181: "dedup de tool-call repetida (mesma tool+args no turno)". Within a
 * single turn, an identical tool call (same name + same args) must execute ONCE;
 * a repeat reuses the cached result and is flagged — never a second side effect.
 * This directly guards the send_media double-send incident class.
 */
import { describe, it, expect } from 'vitest';
import {
  runTurn,
  type LlmClient,
  type LlmResponse,
} from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';

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

describe('runTurn — tool-call repeat dedup', () => {
  it('executes an identical tool+args only once and reuses the cached result', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'abordado' } }] },
      { text: null, toolCalls: [{ id: '2', name: 'move_lead_stage', args: { stage: 'abordado' } }] },
      { text: 'pronto', toolCalls: [] },
    ]);
    let execCount = 0;
    const out = await runTurn({
      ...baseInput,
      llm,
      executeTool: async () => { execCount += 1; return { ok: true, n: execCount }; },
    });
    expect(execCount).toBe(1);
    expect(out.reply).toBe('pronto');
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0]).toEqual({ name: 'move_lead_stage', allowed: true, reason: null, result: { ok: true, n: 1 } });
    expect(out.steps[1]).toEqual({
      name: 'move_lead_stage',
      allowed: true,
      reason: 'duplicate_tool_call',
      result: { ok: true, n: 1 },
    });
  });

  it('does NOT dedup the same tool with different args (a distinct call runs)', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'move_lead_stage', args: { stage: 'abordado' } }] },
      { text: null, toolCalls: [{ id: '2', name: 'move_lead_stage', args: { stage: 'novo_lead' } }] },
      { text: 'ok', toolCalls: [] },
    ]);
    let execCount = 0;
    const out = await runTurn({
      ...baseInput,
      llm,
      executeTool: async () => { execCount += 1; return { ok: true }; },
    });
    expect(execCount).toBe(2);
    expect(out.steps.every((s) => s.reason !== 'duplicate_tool_call')).toBe(true);
  });

  it('keys dedup on args regardless of property order', async () => {
    const llm = scriptedLlm([
      { text: null, toolCalls: [{ id: '1', name: 'fill_lead_field', args: { field: 'cnpj', value: '123' } }] },
      { text: null, toolCalls: [{ id: '2', name: 'fill_lead_field', args: { value: '123', field: 'cnpj' } }] },
      { text: 'feito', toolCalls: [] },
    ]);
    let execCount = 0;
    const out = await runTurn({
      ...baseInput,
      llm,
      executeTool: async () => { execCount += 1; return { ok: true }; },
    });
    expect(execCount).toBe(1);
    expect(out.steps[1].reason).toBe('duplicate_tool_call');
  });
});
