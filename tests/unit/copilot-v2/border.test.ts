/**
 * Slice 1 — border processInbound orchestration (Copilot v2)
 *
 * The fail-CLOSED inbound spine, end-to-end over a mock Supabase (no DB): the
 * gate ordering, is_group short-circuit, fail-CLOSED human-pause, dedup
 * reserve/duplicate distinction, and enqueue. Closes the review gap "critical
 * spine untested". The pure gate decisions are covered separately; this proves
 * their COMPOSITION + the ack contract + that org comes from ctx, never payload.
 */

import { describe, it, expect } from 'vitest';
import { processInbound, type BorderContext } from '../../../supabase/functions/_shared/copilot-v2/border.ts';

interface MockOpts {
  pauseUntil?: string | null;
  pauseThrows?: boolean;
  reserved?: boolean;
  dedupError?: boolean;
  enqueueError?: boolean;
  loopRows?: Array<{ content: string; source: string; created_at: string }>;
}

function makeSupabase(opts: MockOpts = {}) {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const rpc = async (name: string, args: any) => {
    rpcCalls.push({ name, args });
    if (name === 'copilot_v2_check_human_pause') {
      return opts.pauseThrows ? { data: null, error: { message: 'boom' } } : { data: opts.pauseUntil ?? null, error: null };
    }
    if (name === 'copilot_v2_acquire_dedup_lock') {
      return { data: opts.reserved ?? true, error: opts.dedupError ? { message: 'x' } : null };
    }
    if (name === 'copilot_v2_enqueue_message') {
      return { data: 'queue-1', error: opts.enqueueError ? { message: 'x' } : null };
    }
    return { data: null, error: null };
  };
  const from = (_table: string) => {
    const b: any = {
      select: () => b, eq: () => b, gte: () => b,
      order: () => Promise.resolve({ data: opts.loopRows ?? [], error: null }),
      insert: () => Promise.resolve({ error: null }),
      upsert: () => Promise.resolve({ error: null }),
    };
    return b;
  };
  return { rpc, from, rpcCalls };
}

const ctx = (over: Partial<BorderContext> = {}): BorderContext => ({
  organizationId: 'org-1',
  rawPhone: '+55 11 98765-4321',
  content: 'quero um orçamento',
  ...over,
});

describe('processInbound — happy path', () => {
  it('enqueues a valid inbound message with org from ctx (never the payload)', async () => {
    const sb = makeSupabase();
    const ack = await processInbound(sb, ctx());
    expect(ack.ack).toBe('queued');
    const enq = sb.rpcCalls.find((c) => c.name === 'copilot_v2_enqueue_message');
    expect(enq!.args.p_org_id).toBe('org-1');
    expect(enq!.args.p_canonical_phone).toBe('11987654321'); // canonicalized
  });
});

describe('processInbound — gates', () => {
  it('rejects invalid content with invalid_schema (never 500, never enqueues)', async () => {
    const sb = makeSupabase();
    const ack = await processInbound(sb, ctx({ content: '   ' }));
    expect(ack).toMatchObject({ ack: 'error', reason: 'invalid_schema' });
    expect(sb.rpcCalls.some((c) => c.name === 'copilot_v2_enqueue_message')).toBe(false);
  });

  it('skips group chats (is_group incident → default-safe)', async () => {
    const sb = makeSupabase();
    const ack = await processInbound(sb, ctx({ isGroup: true }));
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'is_group' });
  });

  it('blocks while a human pause is active', async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const ack = await processInbound(makeSupabase({ pauseUntil: future }), ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'human_pause_active' });
  });

  it('fail-CLOSED: a pause-check error blocks the turn (never sends)', async () => {
    const sb = makeSupabase({ pauseThrows: true });
    const ack = await processInbound(sb, ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'pause_check_failed' });
    expect(sb.rpcCalls.some((c) => c.name === 'copilot_v2_enqueue_message')).toBe(false);
  });

  it('suppresses a duplicate when the dedup lock is already held', async () => {
    const ack = await processInbound(makeSupabase({ reserved: false }), ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'duplicate' });
  });

  it('fail-CLOSED: a dedup-check error skips rather than risk a double-send', async () => {
    const ack = await processInbound(makeSupabase({ dedupError: true }), ctx());
    expect(ack).toMatchObject({ ack: 'skipped', reason: 'dedup_check_failed' });
  });
});

describe('processInbound — fragment coalescing (#19/#69)', () => {
  it('coalesces the just-arrived fragment with recent pending inbound into one enqueue', async () => {
    const t = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
    // Two recent inbound fragments already in the queue for this contact.
    const sb = makeSupabase({
      loopRows: [
        { content: 'oi', source: 'inbound', created_at: t(1500) },
        { content: 'tudo bem?', source: 'inbound', created_at: t(800) },
      ],
    });
    const ack = await processInbound(sb, ctx({ content: 'queria um orçamento' }));
    expect(ack.ack).toBe('queued');
    const enq = sb.rpcCalls.find((c) => c.name === 'copilot_v2_enqueue_message');
    // The enqueued content is the coalesced burst, not the lone fragment.
    expect(enq!.args.p_content).toBe('oi tudo bem? queria um orçamento');
  });

  it('does NOT coalesce a fragment that arrives after the debounce window', async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    const sb = makeSupabase({ loopRows: [{ content: 'mensagem antiga', source: 'inbound', created_at: old }] });
    const ack = await processInbound(sb, ctx({ content: 'pergunta nova' }));
    const enq = sb.rpcCalls.find((c) => c.name === 'copilot_v2_enqueue_message');
    expect(enq!.args.p_content).toBe('pergunta nova');
  });
});
