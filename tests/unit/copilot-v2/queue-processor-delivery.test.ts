/**
 * W4 — delivery realism wired into the send spine (Copilot v2)
 *
 * processQueueMessage must split the reply into natural chunks, drive a "typing"
 * presence + human latency before each chunk, send them in order, and suppress
 * a reply that is an exact duplicate within the outbound dedup window (60s).
 * All effects are injected deps — pure orchestration, hermetic.
 */
import { describe, it, expect } from 'vitest';
import {
  processQueueMessage,
  type QueueRow,
  type ProcessorDeps,
} from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'quero um orçamento', message_type: 'text', trace_id: 'tr-1',
};
const ctx: ResolvedContext = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [], slots: [] },
  _agentId: null,
} as ResolvedContext;

// 3 sentences, > 260 chars → the qualificador profile splits this into >1 chunk.
const LONG_REPLY =
  'Oi João, tudo certo? Vi que você pediu o orçamento da nossa linha industrial completa pra sua fábrica. ' +
  'A gente entrega em todo o Brasil com prazo médio de sete dias úteis e nota fiscal certinha. ' +
  'Posso te mandar a tabela com os valores agora mesmo ou você prefere que eu te ligue mais tarde?';

function deps(over: Partial<ProcessorDeps> = {}, llmText: string = LONG_REPLY) {
  const sent: string[] = [];
  const recorded: string[] = [];
  const delaysSeen: number[] = [];
  const typing: Array<{ on: boolean }> = [];
  const steps: Array<{ step: string; reason: string | null }> = [];
  const completed: string[] = [];
  const base = {
    resolveContext: async () => ctx,
    makeLlm: () => ({ async complete() { return { text: llmText, toolCalls: [] }; } }),
    makeExecutor: () => async () => ({}),
    checkPause: async () => ({ blocked: false, reason: null }),
    sendReply: async (_p: string, t: string) => { sent.push(t); },
    recordOutbound: async (_p: string, t: string) => { recorded.push(t); },
    markComplete: async (id: string) => { completed.push(id); },
    markFailed: async () => {},
    logStep: async (_tid: string, step: string, reason: string | null) => { steps.push({ step, reason }); },
    delay: async (ms: number) => { delaysSeen.push(ms); },
    setTyping: async (_p: string, on: boolean) => { typing.push({ on }); },
    acquireOutboundLock: async () => true,
    ...over,
  } as ProcessorDeps;
  return { base, sent, recorded, delaysSeen, typing, steps, completed };
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('processQueueMessage — W4 delivery realism', () => {
  it('splits a long reply into ordered chunks and records each one', async () => {
    const d = deps();
    await processQueueMessage(row, d.base);
    expect(d.sent.length).toBeGreaterThan(1);
    expect(d.recorded).toEqual(d.sent); // one outbound record per chunk
    expect(d.sent[0].startsWith('Oi João')).toBe(true);
    expect(norm(d.sent.join(' '))).toBe(norm(LONG_REPLY));
  });

  it('plans a typing+latency delay before every chunk, first reply never < 1s', async () => {
    const d = deps();
    await processQueueMessage(row, d.base);
    expect(d.delaysSeen).toHaveLength(d.sent.length);
    expect(d.delaysSeen[0]).toBeGreaterThanOrEqual(1000);
    // a "composing" presence is set before each delayed chunk
    expect(d.typing.filter((t) => t.on).length).toBe(d.sent.length);
  });

  it('suppresses an exact duplicate reply within the outbound window (never sends twice)', async () => {
    const d = deps({ acquireOutboundLock: async () => false });
    await processQueueMessage(row, d.base);
    expect(d.sent).toEqual([]);
    expect(d.recorded).toEqual([]);
    expect(d.completed).toEqual(['q1']); // suppressed, not failed
    expect(d.steps.some((s) => s.step === 'outbound' && (s.reason ?? '').includes('duplicate'))).toBe(true);
  });

  it('stops mid-stream if a human takes over between chunks', async () => {
    let calls = 0;
    const d = deps({
      checkPause: async () => {
        calls += 1;
        return calls >= 2 ? { blocked: true, reason: 'human_pause_active' } : { blocked: false, reason: null };
      },
    });
    await processQueueMessage(row, d.base);
    expect(d.sent).toHaveLength(1); // only the first chunk went out
    expect(d.completed).toEqual(['q1']);
  });

  it('still sends a short single-message reply as one chunk (backward compatible)', async () => {
    const d = deps({}, 'Beleza, combinado!');
    await processQueueMessage(row, d.base);
    expect(d.sent).toEqual(['Beleza, combinado!']);
  });
});
