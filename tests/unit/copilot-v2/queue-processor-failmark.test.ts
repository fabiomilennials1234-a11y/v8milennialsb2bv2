/**
 * Slice 1-H #22 — a thrown turn routes to markFailed (Copilot v2)
 *
 * The attempts increment moved into copilot_v2_fail_message (SQL). The pure
 * processor's contract — any throw → markFailed(id, err) — is what makes that
 * correct. This pins the contract; the DB-level attempts/reaper behavior is
 * proven in the integration regression suite (requires Postgres).
 */
import { describe, it, expect } from 'vitest';
import { processQueueMessage, type QueueRow, type ProcessorDeps } from '../../../supabase/functions/_shared/copilot-v2/queue-processor.ts';
import type { ResolvedContext } from '../../../supabase/functions/_shared/copilot-v2/cognition-worker.ts';

const row: QueueRow = {
  id: 'q1', organization_id: 'org-1', lead_id: null, canonical_phone: '11987654321',
  conversation_id: null, content: 'oi', message_type: 'text', trace_id: 'tr-1',
};
const ctx = {
  contactStatus: 'NOVO', activeArchetypes: new Set(['qualificador']),
  configByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  capabilitiesByArchetype: { qualificador: {}, vendedor: {}, carteira: {} },
  introspection: { stages: [], fields: [] },
  _agentId: null,
} as ResolvedContext;

it('routes a turn exception to markFailed exactly once (attempts++ happens in SQL)', async () => {
  const failed: Array<[string, string]> = [];
  const deps = {
    resolveContext: async () => ctx,
    makeLlm: () => ({ async complete() { throw new Error('llm 503'); } }),
    makeExecutor: () => async () => ({}),
    checkPause: async () => ({ blocked: false, reason: null }),
    sendReply: async () => {},
    recordOutbound: async () => {},
    markComplete: async () => {},
    markFailed: async (id: string, e: string) => { failed.push([id, e]); },
    logStep: async () => {},
  } as ProcessorDeps;
  await processQueueMessage(row, deps);
  expect(failed).toHaveLength(1);
  expect(failed[0][0]).toBe('q1');
  expect(failed[0][1]).toContain('llm 503');
});
