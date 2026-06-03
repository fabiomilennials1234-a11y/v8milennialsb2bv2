/**
 * W10 — Cost governance wiring in the worker spine (queue-processor)
 *
 * The cost gate runs per-message BEFORE the LLM. Hard monthly cap → auto-pause
 * the org + notify admin, never send. Soft daily bands → degrade: L2 shrinks
 * retrieval (executor flag), L1 overrides to a cheaper model, L3 holds the turn
 * (bounded single re-queue, never on an already-'held' row). After a turn that
 * ran, the token usage is recorded to the ledger. All governance deps are
 * OPTIONAL — absent (eval/sim/legacy tests) the flow is byte-for-byte unchanged.
 */

import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: 'lead-1', canonical_phone: '11987654321',
  conversation_id: 'conv-1', content: 'oi', message_type: 'text', trace_id: 'tr-1',
};

// Vendedor route (QUALIFIED) → base model sonnet, so a model override is observable.
const vendedorCtx: ResolvedContext = {
  contactStatus: 'QUALIFIED',
  activeArchetypes: new Set(['vendedor']),
  configByArchetype: { qualificador: {}, vendedor: { company: { name: 'X' } }, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [], slots: [] },
  _agentId: null,
} as any;

function deps(over: Partial<ProcessorDeps> = {}, ctx: ResolvedContext = vendedorCtx) {
  const sent: string[] = [];
  const completed: string[] = [];
  const failed: Array<[string, string]> = [];
  const calls: Record<string, any[]> = { pauseOrg: [], notifyAdmin: [], holdTurn: [], recordCost: [], makeExecutor: [], makeLlm: [] };
  const base: any = {
    resolveContext: async () => ctx,
    makeLlm: (model: string) => { calls.makeLlm.push(model); return { async complete() { return { text: 'olá!', toolCalls: [], usage: { promptTokens: 100, completionTokens: 50 } }; } }; },
    makeExecutor: (_row: any, _ctx: any, opts: any) => { calls.makeExecutor.push(opts ?? null); return async () => ({}); },
    checkPause: async () => ({ blocked: false, reason: null }),
    sendReply: async (_p: string, t: string) => { sent.push(t); },
    recordOutbound: async () => {},
    markComplete: async (id: string) => { completed.push(id); },
    markFailed: async (id: string, err: string) => { failed.push([id, err]); },
    logStep: async () => {},
    pauseOrg: async (_r: any, reason: string) => { calls.pauseOrg.push(reason); },
    notifyAdmin: async (_r: any, reason: string) => { calls.notifyAdmin.push(reason); },
    holdTurn: async (r: any) => { calls.holdTurn.push(r.id); },
    recordCost: async (_r: any, usage: any, model: string) => { calls.recordCost.push({ usage, model }); },
    sent, completed, failed, calls,
  };
  return { ...base, ...over } as ProcessorDeps & { sent: string[]; completed: string[]; failed: Array<[string, string]>; calls: Record<string, any[]> };
}

describe('processQueueMessage — W10 cost governance', () => {
  it('hard monthly cap → pause org (reason teto) + notify admin, never send', async () => {
    const d = deps({ checkCost: async () => ({ degradeLevel: 3, hardPause: true, reason: 'hard_monthly_cap' }) });
    await processQueueMessage(row, d);
    expect(d.calls.pauseOrg).toEqual(['teto']);
    expect(d.calls.notifyAdmin).toEqual(['teto']);
    expect(d.sent).toEqual([]);
    expect(d.completed).toEqual(['q1']);
    expect(d.calls.makeLlm).toEqual([]); // LLM never ran
  });

  it('soft L3 on a fresh message → holds (bounded re-queue), does not answer this tick', async () => {
    const d = deps({ checkCost: async () => ({ degradeLevel: 3, hardPause: false, reason: 'soft_daily_l3' }) });
    await processQueueMessage(row, d);
    expect(d.calls.holdTurn).toEqual(['q1']);
    expect(d.sent).toEqual([]);
    expect(d.completed).toEqual(['q1']);
    expect(d.calls.makeLlm).toEqual([]);
  });

  it('soft L3 on an already-held message → does NOT hold again, serves degraded', async () => {
    const heldRow = { ...row, message_type: 'held' };
    const d = deps({ checkCost: async () => ({ degradeLevel: 3, hardPause: false, reason: 'soft_daily_l3' }) });
    await processQueueMessage(heldRow, d);
    expect(d.calls.holdTurn).toEqual([]); // no second hold — never starve the lead
    expect(d.sent).toEqual(['olá!']);
  });

  it('soft L2 → shrinks retrieval (executor built with ragShrink)', async () => {
    const d = deps({ checkCost: async () => ({ degradeLevel: 2, hardPause: false, reason: 'soft_daily_l2' }) });
    await processQueueMessage(row, d);
    expect(d.calls.makeExecutor[0]).toEqual({ ragShrink: true });
    expect(d.sent).toEqual(['olá!']);
  });

  it('soft L1 on a sonnet archetype → overrides the model to flash', async () => {
    const d = deps({ checkCost: async () => ({ degradeLevel: 1, hardPause: false, reason: 'soft_daily_l1' }) });
    await processQueueMessage(row, d);
    expect(d.calls.makeLlm).toEqual(['google/gemini-2.5-flash']); // not sonnet
    expect(d.calls.makeExecutor[0]).toEqual({ ragShrink: false });
  });

  it('records the turn token usage + the model actually used after the turn runs', async () => {
    const d = deps({ checkCost: async () => ({ degradeLevel: 0, hardPause: false, reason: null }) });
    await processQueueMessage(row, d);
    expect(d.calls.recordCost).toEqual([{ usage: { promptTokens: 100, completionTokens: 50 }, model: 'anthropic/claude-sonnet-4-6' }]);
  });

  it('recordCost failure is observable in the trace (cost_record_failed) but never fails the turn', async () => {
    const steps: Array<[string, string | null]> = [];
    const d = deps({
      checkCost: async () => ({ degradeLevel: 0, hardPause: false, reason: null }),
      recordCost: async () => { throw new Error('ledger write failed'); },
      logStep: async (_t: string, step: string, reason: string | null) => { steps.push([step, reason]); },
    });
    await processQueueMessage(row, d);
    // Reply still sent + turn completed (a ledger hiccup must not drop the reply)…
    expect(d.sent).toEqual(['olá!']);
    expect(d.completed).toEqual(['q1']);
    expect(d.failed).toEqual([]);
    // …but the failure is logged so a PERSISTENT silent loss is detectable.
    expect(steps).toContainEqual(['gate', 'cost_record_failed']);
  });

  it('no governance deps at all → behaves exactly as before (sends, completes)', async () => {
    const d = deps({ checkCost: undefined, pauseOrg: undefined, notifyAdmin: undefined, holdTurn: undefined, recordCost: undefined });
    await processQueueMessage(row, d);
    expect(d.sent).toEqual(['olá!']);
    expect(d.completed).toEqual(['q1']);
  });

  it('checkCost throwing is fail-safe → serve (do not fail the message)', async () => {
    const d = deps({ checkCost: async () => { throw new Error('ledger unreachable'); } });
    await processQueueMessage(row, d);
    expect(d.failed).toEqual([]);
    expect(d.completed).toEqual(['q1']);
    // fail-closed on cost: degraded to flash, still answers
    expect(d.calls.makeLlm).toEqual(['google/gemini-2.5-flash']);
    expect(d.sent).toEqual(['olá!']);
  });
});
