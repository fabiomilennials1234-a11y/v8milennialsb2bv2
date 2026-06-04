/**
 * W10 — Token usage accounting (Copilot v2 cognition loop)
 *
 * runTurn calls llm.complete() N times per turn (tool steps + final reply). For
 * cost governance the worker needs the TOTAL token usage of the turn, so runTurn
 * sums the per-call usage the LlmClient reports and exposes it on the result.
 * Backward-compatible: when no call reports usage, the field is absent (existing
 * loop tests untouched).
 */

import { describe, it, expect } from 'vitest';
import { runTurn, type LlmClient, type LlmResponse } from '../../../supabase/functions/_shared/copilot-v2/cognition-loop.ts';

// Fake LLM that replays a scripted sequence of responses, one per complete().
function scriptedLlm(responses: LlmResponse[]): LlmClient {
  let i = 0;
  return {
    complete: () => Promise.resolve(responses[Math.min(i++, responses.length - 1)]),
  };
}

const noTools: never[] = [];

describe('runTurn token usage accounting', () => {
  it('sums usage across every complete() call in the turn', async () => {
    const llm = scriptedLlm([
      // step 1: a read tool call (always allowed) + usage
      { text: null, toolCalls: [{ id: 'a', name: 'get_lead_360', args: {} }], usage: { promptTokens: 100, completionTokens: 50 } },
      // step 2: final text reply + usage
      { text: 'pronto', toolCalls: [], usage: { promptTokens: 80, completionTokens: 40 } },
    ]);

    const result = await runTurn({
      llm,
      system: 'sys',
      messages: [{ role: 'user', content: 'oi' }],
      toolSchemas: [{ name: 'get_lead_360' }],
      capabilities: {},
      introspection: null,
      executeTool: () => Promise.resolve({ ok: true }),
    });

    expect(result.reply).toBe('pronto');
    expect(result.usage).toEqual({ promptTokens: 180, completionTokens: 90 });
  });

  it('omits usage entirely when no call reports it (backward-compatible)', async () => {
    const llm = scriptedLlm([{ text: 'oi', toolCalls: [] }]);
    const result = await runTurn({
      llm, system: 's', messages: [{ role: 'user', content: 'oi' }],
      toolSchemas: noTools, capabilities: {}, introspection: null,
      executeTool: () => Promise.resolve(null),
    });
    expect(result.reply).toBe('oi');
    expect(result.usage).toBeUndefined();
  });

  it('reports usage even when the turn stops on budget_exceeded', async () => {
    // Always proposes a read tool call → loop runs until budget, never replies.
    const llm: LlmClient = {
      complete: () => Promise.resolve({
        text: null,
        toolCalls: [{ id: 'x', name: 'get_lead_360', args: {} }],
        usage: { promptTokens: 10, completionTokens: 5 },
      }),
    };
    const result = await runTurn({
      llm, system: 's', messages: [{ role: 'user', content: 'oi' }],
      toolSchemas: [{ name: 'get_lead_360' }], capabilities: {}, introspection: null,
      executeTool: () => Promise.resolve({}), maxToolCalls: 3,
    });
    expect(result.stoppedReason).toBe('budget_exceeded');
    // 3 allowed calls consumed within the budget; usage summed across completes.
    expect(result.usage!.promptTokens).toBeGreaterThanOrEqual(30);
  });
});
