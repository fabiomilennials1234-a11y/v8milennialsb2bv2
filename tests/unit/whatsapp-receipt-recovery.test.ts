// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createUazapiFindById, planReceiptRecovery, type ReceiptCandidate } from '../../services/whatsapp-ingress/receipt-recovery.ts';

const org = '10000000-0000-0000-0000-000000000001';
const instance = '20000000-0000-0000-0000-000000000002';
const candidate = (status = 'sent', messageId = '5511:MSG1'): ReceiptCandidate => ({
  organizationId: org, instanceId: instance, messageId, chatId: '5512@s.whatsapp.net', status,
});
const result = (status: string, overrides: Record<string, unknown> = {}) => ({
  returnedMessages: 1, messages: [{ id: '5511:MSG1', chatid: '5512@s.whatsapp.net', fromMe: true, status, ...overrides }],
  limit: 2, offset: 0, hasMore: false,
});
const run = (candidates: ReceiptCandidate[], body: unknown) => planReceiptRecovery({
  candidates, findById: vi.fn().mockResolvedValue(body), now: () => new Date('2026-09-24T18:00:00Z'),
});

describe('receipt recovery plan', () => {
  it.each([
    ['pending', 'Delivered', 'delivered'], ['sent', 'Delivered', 'delivered'], ['failed', 'Delivered', 'delivered'],
    ['pending', 'Read', 'read'], ['sent', 'Read', 'read'], ['delivered', 'Read', 'read'], ['failed', 'Read', 'read'],
  ])('plans monotonic %s → %s only', async (local, remote, expected) => {
    const { plans, counts } = await run([candidate(local)], result(remote));
    expect(plans).toEqual([{ organizationId: org, instanceId: instance, messageId: '5511:MSG1',
      status: expected, observedAt: '2026-09-24T18:00:00.000Z' }]);
    expect(counts.plannedDelivered + counts.plannedRead).toBe(1);
  });

  it('never downgrades read or emits plans for sent, failed, canceled or unknown state', async () => {
    for (const [local, remote, count] of [
      ['read', 'Delivered', 'alreadyCurrent'], ['read', 'Read', 'alreadyCurrent'],
      ['sent', 'Sent', 'notEligible'], ['sent', 'Failed', 'notEligible'],
      ['sent', 'Canceled', 'notEligible'], ['received', 'Read', 'inconclusive'],
    ] as const) {
      const { plans, counts } = await run([candidate(local)], result(remote));
      expect(plans).toEqual([]);
      expect(counts[count]).toBe(1);
    }
  });

  it('treats missing, duplicate, ambiguous, malformed or cross-chat state as inconclusive', async () => {
    const invalid = [
      { ...result('Read'), returnedMessages: 0 },
      { ...result('Read'), messages: [] },
      { ...result('Read'), hasMore: true },
      { ...result('Read'), messages: [result('Read').messages[0], result('Read').messages[0]], returnedMessages: 2 },
      result('Read', { id: 'other' }), result('Read', { chatid: 'other@s.whatsapp.net' }),
      result('Read', { fromMe: false }), result('Played'), { messages: [result('Read').messages[0]] },
    ];
    for (const body of invalid) {
      const { plans, counts, inconclusiveIndexes } = await run([candidate()], body);
      expect(plans).toEqual([]);
      expect(counts.inconclusive).toBe(1);
      expect(inconclusiveIndexes).toEqual([0]);
    }
  });

  it('rejects duplicate, malformed and mixed tenant candidates before lookup', async () => {
    const findById = vi.fn().mockResolvedValue(result('Read'));
    const candidates = [candidate(), candidate(), { ...candidate(), instanceId: '30000000-0000-0000-0000-000000000003' },
      { ...candidate(), messageId: '  ' }];
    const { plans, counts, inconclusiveIndexes } = await planReceiptRecovery({ candidates, findById });
    expect(findById).toHaveBeenCalledTimes(1);
    expect(plans).toHaveLength(1);
    expect(counts.inconclusive).toBe(3);
    expect(inconclusiveIndexes).toEqual([1, 2, 3]);
  });

  it('bounds batch and stops on outer cancellation with unscanned count', async () => {
    const findById = vi.fn();
    await expect(planReceiptRecovery({ candidates: Array.from({ length: 51 }, (_, i) => candidate('sent', `MSG${i}`)), findById }))
      .rejects.toThrow('bounds exceeded');
    expect(findById).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    const { counts } = await planReceiptRecovery({ candidates: [candidate(), candidate('sent', 'MSG2')], findById, signal: controller.signal });
    expect(counts.unscanned).toBe(2);
  });

  it('stops batch after provider failure, without retrying or exhausting quota', async () => {
    const findById = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({
      ...result('Read'), messages: [{ ...result('Read').messages[0], id: '5511:MSG2' }],
    });
    const { plans, counts } = await planReceiptRecovery({ candidates: [candidate(), candidate('sent', '5511:MSG2')], findById });
    expect(findById).toHaveBeenCalledTimes(1);
    expect(plans).toHaveLength(0);
    expect(counts.providerError).toBe(1);
    expect(counts.unscanned).toBe(1);
  });
});

describe('Uazapi exact lookup transport', () => {
  it('posts one bounded exact-id query without redirects or retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(result('Read'))));
    const findById = createUazapiFindById('https://provider.example', 'fixture-token', { fetchImpl });
    expect(await findById('5511:MSG1', new AbortController().signal)).toEqual(result('Read'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://provider.example/message/find');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body)).toEqual({ id: '5511:MSG1', limit: 2, offset: 0 });
  });

  it('rejects HTTP failure, excessive body and unsafe origin', async () => {
    expect(() => createUazapiFindById('http://provider.example', 'fixture')).toThrow();
    const failed = createUazapiFindById('https://provider.example', 'fixture', { fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })) });
    await expect(failed('id', new AbortController().signal)).rejects.toThrow('lookup failed');
    const oversized = createUazapiFindById('https://provider.example', 'fixture', {
      maxResponseBytes: 10, fetchImpl: vi.fn().mockResolvedValue(new Response('x'.repeat(11))),
    });
    await expect(oversized('id', new AbortController().signal)).rejects.toThrow('too large');
  });
});
