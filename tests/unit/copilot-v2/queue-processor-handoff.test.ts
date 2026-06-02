/**
 * Slice 5 — worker dispatches the handoff notification idempotently (Copilot v2).
 *
 * When a turn's allowed steps include transfer_to_human, the processor calls
 * dispatchHandoff exactly once with the structured payload. Idempotency is the
 * RPC's job (stable key) — the processor must pass the trace so the key is
 * stable, and must NOT dispatch when no transfer step fired.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'quero falar com humano', message_type: 'text', trace_id: 'tr-1',
};
const ctx = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: { can_transfer: true }, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] }, _agentId: 'agent-1',
} as ResolvedContext;

// An LLM that calls transfer_to_human then replies.
function transferLlm() {
  let turn = 0;
  return {
    async complete() {
      if (turn++ === 0) return { text: null, toolCalls: [{ id: 't1', name: 'transfer_to_human', args: { reason: 'pediu humano', summary: 'lead quente' } }] };
      return { text: 'Já passei pro time, um especialista te chama.', toolCalls: [] };
    },
  };
}

function deps(over: Partial<ProcessorDeps> = {}) {
  const dispatched: any[] = []; const sent: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => transferLlm(),
      makeExecutor: () => async (name: string, args: any) =>
        name === 'transfer_to_human'
          ? { transferred: true, reason: args.reason, handoff: { leadId: 'lead-1', reason: args.reason, summary: args.summary } }
          : ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
      checkLoop: async () => ({ blocked: false, reason: null }),
      checkHitl: async () => ({ requiresApproval: false, reason: null }),
      judgeOutput: async () => ({ block: false, reason: null }),
      dispatchHandoff: async (r: QueueRow, payload: any) => { dispatched.push({ r, payload }); },
      sendReply: async (_p: string, t: string) => { sent.push(t); },
      recordOutbound: async () => {},
      markComplete: async () => {},
      markFailed: async () => {},
      logStep: async () => {},
      ...over,
    } as ProcessorDeps,
    dispatched, sent,
  };
}

describe('processQueueMessage — dispatches handoff notification', () => {
  it('dispatches once with the structured payload when transfer_to_human fired', async () => {
    const { base, dispatched } = deps();
    await processQueueMessage(row, base);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].payload).toMatchObject({ reason: 'pediu humano', summary: 'lead quente', leadId: 'lead-1' });
    expect(dispatched[0].r.trace_id).toBe('tr-1'); // trace passed → stable idempotency key
  });

  it('does NOT dispatch when no transfer step fired', async () => {
    const { base, dispatched } = deps({
      makeLlm: () => ({ async complete() { return { text: 'oi, como ajudo?', toolCalls: [] }; } }),
    });
    await processQueueMessage(row, base);
    expect(dispatched).toEqual([]);
  });
});
