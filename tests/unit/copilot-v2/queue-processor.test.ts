/**
 * Slice 1/2 integration — queue-processor (Copilot v2)
 *
 * The worker's pure orchestration over ONE claimed message: resolve context →
 * handleQueuedMessage (cognition) → send the reply → mark processed; on any
 * throw → mark failed (RPC decides retry vs DLQ). All side effects are injected
 * deps, so the control flow is tested with fakes — no DB, no LLM, no WhatsApp.
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
  configByArchetype: { qualificador: { company: { name: 'X' } }, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
  _agentId: null,
};

function deps(over: Partial<ProcessorDeps> = {}): ProcessorDeps & { sent: string[]; completed: string[]; failed: Array<[string, string]> } {
  const sent: string[] = [];
  const completed: string[] = [];
  const failed: Array<[string, string]> = [];
  return {
    resolveContext: async () => ctx,
    makeLlm: () => ({ async complete() { return { text: 'olá!', toolCalls: [] }; } }),
    makeExecutor: () => async () => ({}),
    checkPause: async () => ({ blocked: false, reason: null }),
    sendReply: async (_phone, text) => { sent.push(text); },
    recordOutbound: async () => {},
    markComplete: async (id) => { completed.push(id); },
    markFailed: async (id, err) => { failed.push([id, err]); },
    logStep: async () => {},
    sent, completed, failed,
    ...over,
  } as any;
}

describe('processQueueMessage', () => {
  it('resolves context, runs the turn, sends the reply, marks complete', async () => {
    const d = deps();
    await processQueueMessage(row, d);
    expect(d.sent).toEqual(['olá!']);
    expect(d.completed).toEqual(['q1']);
    expect(d.failed).toEqual([]);
  });

  it('routes through the resolved archetype + sends to the canonical phone', async () => {
    let sentTo = '';
    const d = deps({ sendReply: async (phone, _t) => { sentTo = phone; } });
    await processQueueMessage(row, d);
    expect(sentTo).toBe('11987654321');
  });

  it('does NOT send when the turn produces no reply (e.g. only tool calls / budget stop)', async () => {
    const d = deps({ makeLlm: () => ({ async complete() { return { text: null, toolCalls: [] }; } }) });
    await processQueueMessage(row, d);
    expect(d.sent).toEqual([]);
    expect(d.completed).toEqual(['q1']); // still completes — turn ran, just no text
  });

  it('marks the message complete (not failed) when the archetype is not active — deferred, not an error', async () => {
    const d = deps({
      resolveContext: async () => ({ ...ctx, activeArchetypes: new Set([]) }),
    });
    await processQueueMessage(row, d);
    expect(d.failed).toEqual([]);
    expect(d.completed).toEqual(['q1']);
    expect(d.sent).toEqual([]);
  });

  it('marks FAILED (for retry/DLQ) when context resolution throws', async () => {
    const d = deps({ resolveContext: async () => { throw new Error('db down'); } });
    await processQueueMessage(row, d);
    expect(d.completed).toEqual([]);
    expect(d.failed[0][0]).toBe('q1');
    expect(d.failed[0][1]).toContain('db down');
  });

  it('marks FAILED when sending the reply throws (provider error → retry)', async () => {
    const d = deps({ sendReply: async () => { throw new Error('uazapi 500'); } });
    await processQueueMessage(row, d);
    expect(d.failed[0]).toEqual(['q1', expect.stringContaining('uazapi 500')]);
    expect(d.completed).toEqual([]);
  });
});
