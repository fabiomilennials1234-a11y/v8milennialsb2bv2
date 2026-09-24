// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { loadReceiptRecoveryConfig } from '../../services/whatsapp-ingress/recovery-config.ts';
import { runReceiptRecoveryBatch } from '../../services/whatsapp-ingress/recovery-runner.ts';

const organizationId = '10000000-0000-0000-0000-000000000001';
const instanceId = '20000000-0000-0000-0000-000000000002';
const messageRowId = '30000000-0000-0000-0000-000000000003';
const leaseToken = '40000000-0000-0000-0000-000000000004';
const eventId = '50000000-0000-0000-0000-000000000005';
const row = { id: messageRowId, message_id: 'provider-message', remote_jid: '5511@s.whatsapp.net',
  status: 'sent', created_at: '2026-09-23T12:00:00Z' };
const providerResult = { returnedMessages: 1, messages: [{ id: row.message_id, chatid: row.remote_jid,
  fromMe: true, status: 'read' }], limit: 2, offset: 0, hasMore: false };

function fixture(options: {
  instance?: unknown; credential?: unknown; begin?: unknown; enqueue?: unknown;
  enqueueError?: unknown; finish?: unknown; previewRows?: unknown;
} = {}) {
  const instances = { data: options.instance === undefined
    ? { id: instanceId, organization_id: organizationId, provider: 'uazapi' } : options.instance, error: null };
  const credentials = { data: options.credential === undefined
    ? { organization_id: organizationId, uazapi_token: 'private-token' } : options.credential, error: null };
  const batches = { data: options.begin === undefined ? { lease_token: leaseToken, candidates: [row], has_more: false } : options.begin, error: null };
  const queued = { data: options.enqueue === undefined ? eventId : options.enqueue, error: options.enqueueError ?? null };
  const completed = { data: options.finish === undefined ? true : options.finish, error: null };
  const query = (value: unknown) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'order']) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue(value);
    builder.limit = vi.fn().mockResolvedValue(value);
    return builder;
  };
  const instanceQuery = query(instances);
  const previewQuery = query({ data: options.previewRows === undefined ? [row] : options.previewRows, error: null });
  const db = {
    from: vi.fn((table: string) => table === 'whatsapp_instances' ? instanceQuery : previewQuery),
    rpc: vi.fn((name: string) => {
      if (name === 'get_uazapi_credentials') return Promise.resolve(credentials);
      if (name === 'begin_whatsapp_receipt_recovery') return Promise.resolve(batches);
      if (name === 'enqueue_whatsapp_receipt_recovery') return Promise.resolve(queued);
      if (name === 'finish_whatsapp_receipt_recovery') return Promise.resolve(completed);
      throw new Error(`Unexpected RPC: ${name}`);
    }),
  };
  const findById = vi.fn().mockResolvedValue(providerResult);
  const run = (apply = false) => runReceiptRecoveryBatch(db as never, {
    organizationId, instanceId, providerBaseUrl: 'https://provider.example', apply,
    quoteEnabled: () => false, findById,
  });
  return { db, findById, run, instanceQuery, previewQuery };
}

describe('receipt recovery runner scope and admission', () => {
  it('previews current status with provider reads but no leases, inbox writes or checkpoint', async () => {
    const { db, findById, run, previewQuery } = fixture();
    const report = await run();
    expect(report).toMatchObject({ mode: 'preview', state: 'finished', checked: 1, planned: 1,
      enqueued: 0, has_more: false, boundary: 'known_outgoing_status_only' });
    expect(findById).toHaveBeenCalledOnce();
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(['get_uazapi_credentials']);
    expect(previewQuery.eq).toHaveBeenCalledWith('organization_id', organizationId);
    expect(previewQuery.eq).toHaveBeenCalledWith('instance_id', instanceId);
    expect(previewQuery.limit).toHaveBeenCalledWith(51);
  });

  it('marks a 51st preview candidate without looking it up or claiming a lease', async () => {
    const previewRows = Array.from({ length: 51 }, (_, index) => ({ ...row,
      id: `30000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      message_id: `provider-message-${index + 1}` }));
    const { db, findById, run, previewQuery } = fixture({ previewRows });
    const report = await run();
    expect(report).toMatchObject({ mode: 'preview', state: 'finished', checked: 50, has_more: true });
    expect(findById).toHaveBeenCalledTimes(50);
    expect(findById).not.toHaveBeenCalledWith('provider-message-51', expect.anything());
    expect(previewQuery.limit).toHaveBeenCalledWith(51);
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(['get_uazapi_credentials']);
  });

  it('blocks quote-enabled organizations before database or provider lookup', async () => {
    const { db, findById } = fixture();
    const report = await runReceiptRecoveryBatch(db as never, { organizationId, instanceId,
      providerBaseUrl: 'https://provider.example', apply: true, findById, quoteEnabled: () => true });
    expect(report.state).toBe('blocked');
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: instanceId, organization_id: organizationId, provider: 'meta' }, undefined],
    [null, undefined],
    [undefined, { organization_id: '90000000-0000-0000-0000-000000000009', uazapi_token: 'wrong-org' }],
    [undefined, { organization_id: organizationId, uazapi_token: '' }],
  ])('blocks invalid instance/provider credentials without provider lookup', async (instance, credential) => {
    const { db, findById, run } = fixture({ instance, credential });
    expect((await run(true)).state).toBe('blocked');
    expect(findById).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.some(([name]) => name === 'begin_whatsapp_receipt_recovery')).toBe(false);
  });

  it('skips provider lookup when database gate refuses a lease', async () => {
    const { db, findById, run } = fixture({ begin: null });
    expect((await run(true)).state).toBe('blocked');
    expect(findById).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual([
      'get_uazapi_credentials', 'begin_whatsapp_receipt_recovery',
    ]);
  });

  it('enqueues only a scoped plan, then checkpoints exact observed counts', async () => {
    const { db, findById, run } = fixture();
    const report = await run(true);
    expect(report).toMatchObject({ mode: 'apply', state: 'finished', checked: 1, planned: 1,
      enqueued: 1, inconclusive: 0, unscanned: 0, error: 0, has_more: false });
    expect(findById).toHaveBeenCalledOnce();
    const calls = db.rpc.mock.calls;
    expect(calls.map(([name]) => name)).toEqual(['get_uazapi_credentials',
      'begin_whatsapp_receipt_recovery', 'enqueue_whatsapp_receipt_recovery',
      'finish_whatsapp_receipt_recovery']);
    expect(calls[2][1]).toMatchObject({ p_organization_id: organizationId,
      p_instance_id: instanceId, p_lease_token: leaseToken, p_message_row_id: messageRowId, p_status: 'read' });
    expect(calls[3][1].p_results).toEqual({ checked: 1, planned: 1, enqueued: 1,
      inconclusive: 0, unscanned: 0, error: 0 });
    expect(calls[3][1].p_inconclusive_ids).toEqual([]);
  });

  it('reports the database next-page flag and preserves inconclusive row IDs in checkpoint', async () => {
    const { db, run } = fixture({ begin: { lease_token: leaseToken,
      candidates: [{ ...row, remote_jid: 'other@s.whatsapp.net' }], has_more: true } });
    const report = await run(true);
    expect(report).toMatchObject({ state: 'finished', checked: 1, planned: 0,
      inconclusive: 1, has_more: true });
    const finish = db.rpc.mock.calls.find(([name]) => name === 'finish_whatsapp_receipt_recovery');
    expect(finish?.[1].p_inconclusive_ids).toEqual([messageRowId]);
    expect(finish?.[1].p_results).toEqual({ checked: 1, planned: 0, enqueued: 0,
      inconclusive: 1, unscanned: 0, error: 0 });
    expect(db.rpc.mock.calls.some(([name]) => name === 'enqueue_whatsapp_receipt_recovery')).toBe(false);
  });

  it('rejects a lease response without explicit pagination truth', async () => {
    const { run } = fixture({ begin: { lease_token: leaseToken, candidates: [row] } });
    await expect(run(true)).rejects.toThrow('batch unconfirmed');
  });

  it('does not retry ambiguous enqueue error and checkpoints blocked work', async () => {
    const { db, run } = fixture({ enqueue: null, enqueueError: { message: 'network timeout' } });
    const report = await run(true);
    expect(report.state).toBe('blocked');
    expect(report.error).toBeGreaterThan(0);
    expect(db.rpc.mock.calls.filter(([name]) => name === 'enqueue_whatsapp_receipt_recovery')).toHaveLength(1);
    expect(db.rpc.mock.calls.at(-1)?.[1].p_results.error).toBeGreaterThan(0);
  });

  it('checkpoints an explicit no-op when the target is already current', async () => {
    const { db, run } = fixture({ enqueue: null });
    const report = await run(true);
    expect(report).toMatchObject({ state: 'finished', checked: 1, planned: 1,
      enqueued: 0, error: 0 });
    expect(db.rpc.mock.calls.at(-1)?.[1].p_results.enqueued).toBe(0);
  });

  it('throws on unconfirmed final checkpoint rather than reporting success', async () => {
    const { run } = fixture({ finish: false });
    await expect(run(true)).rejects.toThrow('checkpoint unconfirmed');
  });
});

describe('receipt recovery configuration', () => {
  const ingress = { enabled: true, instanceIds: new Set([instanceId]) };
  it('is disabled by default and requires explicit ingress subset when enabled', () => {
    expect(loadReceiptRecoveryConfig(() => undefined, ingress)).toEqual({ enabled: false, instanceIds: [], baseUrl: '' });
    const get = (key: string) => ({ INGRESS_RECEIPT_RECOVERY_ENABLED: 'true',
      INGRESS_RECEIPT_RECOVERY_INSTANCE_IDS: instanceId,
      UAZAPI_BASE_URL: 'https://provider.example/' })[key as 'INGRESS_RECEIPT_RECOVERY_ENABLED'];
    expect(loadReceiptRecoveryConfig(get, ingress)).toEqual({ enabled: true,
      instanceIds: [instanceId], baseUrl: 'https://provider.example' });
    expect(() => loadReceiptRecoveryConfig(get, { ...ingress, enabled: false })).toThrow();
  });

  it.each(['', '20000000-0000-0000-0000-000000000003', `${instanceId},${instanceId}`])('rejects empty, outside and duplicate recovery IDs: %s', ids => {
      expect(() => loadReceiptRecoveryConfig(key => ({ INGRESS_RECEIPT_RECOVERY_ENABLED: 'true',
        INGRESS_RECEIPT_RECOVERY_INSTANCE_IDS: ids, UAZAPI_BASE_URL: 'https://provider.example/'
      })[key as 'INGRESS_RECEIPT_RECOVERY_ENABLED'], ingress)).toThrow();
  });
});
