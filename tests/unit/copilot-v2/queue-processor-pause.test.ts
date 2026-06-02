/**
 * Slice 1-H #49 — worker re-checks human-pause at send time (Copilot v2)
 *
 * Gates ran only at the border. With the durable queue + retry backoff (1/5/15
 * min) a human can take over between enqueue and processing. The processor must
 * re-check the pause right before sending and skip (not send, not fail) if a
 * human is now in control. fail-CLOSED reuse of decideHumanPauseGate.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx: ResolvedContext = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
  _agentId: null,
} as ResolvedContext;

function deps(over: Partial<ProcessorDeps> = {}) {
  const sent: string[] = []; const completed: string[] = []; const failed: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
      makeExecutor: () => async () => ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
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

describe('processQueueMessage — re-checks human-pause before send', () => {
  it('skips the send (and does NOT fail) when a human took over after enqueue', async () => {
    const { base, sent, completed, failed } = deps({
      checkPause: async () => ({ blocked: true, reason: 'human_pause_active' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);          // never talks over the human
    expect(completed).toEqual(['q1']); // correctly suppressed, not a failure
    expect(failed).toEqual([]);
  });

  it('sends normally when no human is in control', async () => {
    const { base, sent } = deps();
    await processQueueMessage(row, base);
    expect(sent).toEqual(['olá!']);
  });

  it('fail-CLOSED: a pause-check error at send time blocks the send', async () => {
    const { base, sent, completed } = deps({
      checkPause: async () => ({ blocked: true, reason: 'pause_check_failed' }),
    });
    await processQueueMessage(row, base);
    expect(sent).toEqual([]);
    expect(completed).toEqual(['q1']);
  });
});
