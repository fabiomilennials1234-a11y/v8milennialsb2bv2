/**
 * W10 — Inbound rate-limit composition at the border
 *
 * Proves the border wires decideInboundRateLimit in: under the org's rate the
 * message enqueues; at the rate it's dropped with a single canned deflection;
 * over the rate (already notified) it's dropped silently; a count-read error
 * fail-CLOSES (block). The pure decision is tested separately — here we prove
 * the composition + the canned-notice side effect + the inbound-only guard.
 */

import { describe, it, expect } from 'vitest';
import { processInbound, type BorderContext } from '../../../supabase/functions/_shared/copilot-v2/border.ts';

interface RLOpts { rate?: number; inboundCount?: number; countError?: boolean }

function makeSupabase(opts: RLOpts = {}) {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const rpc = async (name: string, args: any) => {
    rpcCalls.push({ name, args });
    if (name === 'copilot_v2_check_human_pause') return { data: null, error: null };
    if (name === 'copilot_v2_enqueue_message') return { data: 'queue-1', error: null };
    return { data: null, error: null };
  };
  const from = (table: string) => {
    if (table === 'copilot_v2_org_settings') {
      const os: any = {
        select: () => os, eq: () => os,
        maybeSingle: () => Promise.resolve({ data: { inbound_rate_per_min: opts.rate ?? 15 }, error: null }),
      };
      return os;
    }
    // copilot_v2_message_queue: distinguish the count query (head:true, ends on
    // .gte) from the loop/coalesce queries (end on .order).
    let isCount = false;
    const b: any = {
      select: (_cols: string, o?: any) => { if (o && o.head) isCount = true; return b; },
      eq: () => b,
      gte: () => isCount
        ? Promise.resolve({ count: opts.inboundCount ?? 0, error: opts.countError ? { message: 'boom' } : null })
        : b,
      order: () => Promise.resolve({ data: [], error: null }),
    };
    return b;
  };
  return { rpc, from, rpcCalls };
}

const ctx = (over: Partial<BorderContext> = {}): BorderContext => ({
  organizationId: 'org-1', rawPhone: '+55 11 98765-4321', content: 'quero um orçamento', ...over,
});

describe('processInbound — W10 inbound rate-limit', () => {
  it('under the rate → enqueues normally', async () => {
    const sb = makeSupabase({ rate: 15, inboundCount: 14 });
    const ack = await processInbound(sb, ctx());
    expect(ack.ack).toBe('queued');
  });

  it('at the rate → drops + sends ONE canned deflection (canned_out), no cognition enqueue', async () => {
    const sb = makeSupabase({ rate: 15, inboundCount: 15 });
    const ack = await processInbound(sb, ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'rate_limit_exceeded' });
    const enqueues = sb.rpcCalls.filter((c) => c.name === 'copilot_v2_enqueue_message');
    expect(enqueues).toHaveLength(1);
    expect(enqueues[0].args.p_source).toBe('canned_out');
    expect(enqueues[0].args.p_org_id).toBe('org-1');
  });

  it('over the rate (already notified) → drops silently, no canned notice', async () => {
    const sb = makeSupabase({ rate: 15, inboundCount: 40 });
    const ack = await processInbound(sb, ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'rate_limit_exceeded' });
    expect(sb.rpcCalls.filter((c) => c.name === 'copilot_v2_enqueue_message')).toHaveLength(0);
  });

  it('count-read error → fail-CLOSED block (never let a flood through)', async () => {
    const sb = makeSupabase({ rate: 15, countError: true });
    const ack = await processInbound(sb, ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'rate_limit_check_failed' });
    expect(sb.rpcCalls.some((c) => c.name === 'copilot_v2_enqueue_message')).toBe(false);
  });

  it('respects a higher org-configured rate', async () => {
    const sb = makeSupabase({ rate: 100, inboundCount: 40 });
    const ack = await processInbound(sb, ctx());
    expect(ack.ack).toBe('queued'); // 40 < 100
  });
});
