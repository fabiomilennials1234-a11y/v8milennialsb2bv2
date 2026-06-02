/**
 * Slice 5 — worker re-checks the loop gate at send time (Copilot v2).
 *
 * The loop gate runs at the border (enqueue). With the durable queue + retry,
 * the loop state can evolve between enqueue and processing — the processor must
 * re-check before sending and suppress (complete, not fail) if a loop fired.
 * fail-CLOSED reuse of decideLoopGate.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [], slots: [] }, _agentId: null,
} as ResolvedContext;

function deps(over: Partial<ProcessorDeps> = {}) {
  const sent: string[] = []; const completed: string[] = []; const failed: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
      makeExecutor: () => async () => ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
      checkLoop: async () => ({ blocked: false, reason: null }),
      judgeOutput: async () => ({ block: false, reason: null }),
      sendReply: async (_p: string, t: string) => { sent.push(t); },
      recordOutbound: async () => {},
      markComplete: async (id: string) => { completed.push(id); },
      markFailed: async (id: string) => { failed.push(id); },
      logStep: async () => {},
      ...over,
    } as ProcessorDeps,
    sent, completed, failed,
  };
}

describe('processQueueMessage — re-checks the loop gate before send', () => {
  it('suppresses (complete, not fail) when a loop fired after enqueue', async () => {
    const { base, sent, completed, failed } = deps({
      checkLoop: async () => ({ blocked: true, reason: 'bot_loop_detected' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);
    expect(completed).toEqual(['q1']);
    expect(failed).toEqual([]);
  });

  it('fail-CLOSED: a loop-check error blocks the send', async () => {
    const { base, sent, completed } = deps({
      checkLoop: async () => ({ blocked: true, reason: 'loop_check_failed' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);
    expect(completed).toEqual(['q1']);
  });

  it('sends normally when no loop fired', async () => {
    const { base, sent } = deps();
    await processQueueMessage(row, base);
    expect(sent).toEqual(['olá!']);
  });
});
