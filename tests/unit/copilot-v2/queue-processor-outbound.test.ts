/**
 * Slice 1-H #3 — outbound is recorded so the loop gate can fire (Copilot v2)
 *
 * border.ts checkLoop maps queue rows source==='outbound' → outgoing, but the
 * worker never wrote an outbound row, so detectIdenticalBurst/detectPingpong
 * saw zero outgoing and the Bertin loop gate was structurally dead. After a
 * successful send the processor must record the outbound so the NEXT turn sees
 * the outgoing side. Pure: recordOutbound is an injected dep.
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx: ResolvedContext = {
  contactStatus: 'NOVO',
  activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
} as ResolvedContext;

function deps(over: Partial<ProcessorDeps> = {}) {
  const recorded: Array<{ phone: string; text: string }> = [];
  const sent: string[] = [];
  return {
    base: {
      resolveContext: async () => ctx,
      makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
      makeExecutor: () => async () => ({}),
      checkPause: async () => ({ blocked: false, reason: null }),
      sendReply: async (_p: string, t: string) => { sent.push(t); },
      recordOutbound: async (phone: string, text: string) => { recorded.push({ phone, text }); },
      markComplete: async () => {},
      markFailed: async () => {},
      logStep: async () => {},
      ...over,
    } as ProcessorDeps,
    recorded, sent,
  };
}

describe('processQueueMessage — records outbound for the loop gate', () => {
  it('records the outbound reply after a successful send', async () => {
    const { base, recorded } = deps();
    await processQueueMessage(row, base);
    expect(recorded).toEqual([{ phone: '11987654321', text: 'olá!' }]);
  });

  it('does NOT record outbound when there is no reply (only tool calls)', async () => {
    const { base, recorded } = deps({ makeLlm: () => ({ async complete() { return { text: null, toolCalls: [] }; } }) });
    await processQueueMessage(row, base);
    expect(recorded).toEqual([]);
  });

  it('does NOT record outbound when the send itself throws (no phantom outgoing)', async () => {
    const { base, recorded } = deps({ sendReply: async () => { throw new Error('uazapi 500'); } });
    await processQueueMessage(row, base);
    expect(recorded).toEqual([]);
  });
});
