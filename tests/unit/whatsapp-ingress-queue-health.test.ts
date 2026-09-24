// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createQueueHealth } from '../../services/whatsapp-ingress/queue-health.ts';

const snapshot = { paused: false, dead_letter_count: 0, expired_count: 0, pending_count: 0, processing_count: 0 };
function fixture(overrides = {}, oldest: unknown = null) {
  const chains: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const rpc = vi.fn(async () => ({ data: [{ ...snapshot, ...overrides }], error: null }));
  const from = vi.fn((table: string) => {
    const chain = Object.fromEntries(['select', 'eq', 'order', 'limit'].map(k => [k, vi.fn(() => chain)]));
    chain.maybeSingle = vi.fn(async () => ({ data: table === 'whatsapp_instances' ? { organization_id: 'org-a' } : oldest, error: null }));
    chains.push(chain); return chain;
  });
  return { db: { from, rpc } as unknown as SupabaseClient, from, rpc, chains };
}
describe('worker queue health', () => {
  it('detects a dead-letter head even when database claims succeed', async () => {
    const f = fixture({ dead_letter_count: 1, pending_count: 61 });
    expect(await createQueueHealth(f.db, ['instance-a'])()).toEqual({ healthy: false, reason: 'dead_letter' });
    expect(f.rpc).toHaveBeenCalledWith('get_whatsapp_ingress_handoff_snapshot', { p_organization_id: 'org-a', p_instance_id: 'instance-a' });
  });
  it('shares concurrent probes, caches results, and rechecks after a minute', async () => {
    let now = 1; const f = fixture(); const probe = createQueueHealth(f.db, ['instance-a'], () => now);
    expect(await Promise.all([probe(), probe(), probe()])).toEqual(Array(3).fill({ healthy: true, reason: 'ok' }));
    now = 60_000; await probe(); expect(f.rpc).toHaveBeenCalledTimes(1);
    now = 60_001; await probe(); expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it.each([[{ paused: true }, 'paused'], [{ expired_count: 1 }, 'expired_lease'], [{ pending_count: '1' }, 'unavailable']])('fails closed for %j', async (value, reason) => {
    const f = fixture(value); expect(await createQueueHealth(f.db, ['a'])()).toEqual({ healthy: false, reason });
  });
  it('reports old regular work and scopes oldest lookup to the tenant and instance', async () => {
    const f = fixture({ pending_count: 1 }, { created_at: new Date(0).toISOString() });
    expect(await createQueueHealth(f.db, ['a'], () => 300_001)()).toEqual({ healthy: false, reason: 'stalled' });
    expect(f.chains[1].eq.mock.calls).toEqual([['organization_id', 'org-a'], ['instance_id', 'a'], ['status', 'pending'], ['receipt_deferred', false]]);
  });
  it('does not mistake only-deferred receipts for stalled regular work', async () => {
    const f = fixture({ pending_count: 3 });
    expect(await createQueueHealth(f.db, ['a'])()).toEqual({ healthy: true, reason: 'ok' });
  });
  it('returns unavailable on transport failure and disabled with no instances', async () => {
    const f = fixture(); f.rpc.mockRejectedValueOnce(new Error('private transport detail'));
    expect(await createQueueHealth(f.db, ['a'])()).toEqual({ healthy: false, reason: 'unavailable' });
    expect(await createQueueHealth(f.db, [])()).toEqual({ healthy: false, reason: 'disabled' });
  });
});
