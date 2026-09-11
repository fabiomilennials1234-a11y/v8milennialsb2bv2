import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WhatsAppMessage } from '../hooks/chat/types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), result: { data: [] as unknown[], error: null as unknown } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }));
vi.mock('./chipInstanceIds', () => ({ resolveChipInstanceIds: async () => ['chip'] }));
import { mergeConcurrentMessages, mergeMessagePages, reconcileConversation } from './whatsappReconciliation';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, extra = {}) => ({ id: id(n), message_id: `provider-${n}`, timestamp: '2026-09-11T12:00:00.123456Z', direction: 'outgoing', message_type: 'text', content: `text ${n}`, status: 'sent', ...extra }) as WhatsAppMessage;
const params = { organizationId: 'org', instanceId: 'chip', phoneNumber: '4891005289' };
const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), in: vi.fn(() => builder), then: (fn: (r: typeof mocks.result) => unknown) => Promise.resolve(mocks.result).then(fn) };
beforeEach(() => { vi.clearAllMocks(); mocks.from.mockReturnValue(builder); mocks.result.data = []; mocks.result.error = null; });
describe('reconciliation', () => {
 it('unchanged manifest fetches no bodies', async () => {
  const old = [row(1)]; const snapshot = { fingerprint: 'same', revisions: { [id(1)]: '1' } };
  mocks.rpc.mockResolvedValue({ data: { fingerprint: 'same', unchanged: true }, error: null });
  expect((await reconcileConversation(params, old, snapshot)).messages).toBe(old);
  expect(mocks.from).not.toHaveBeenCalled();
 });
 it('fetches only changed rows, applies receipts, removes deletes and adds backfills', async () => {
  mocks.rpc.mockResolvedValue({ data: { fingerprint: 'new', manifest: [{ id: id(1), revision: '2' }, { id: id(3), revision: '1' }, { id: id(4), revision: '1' }] } });
  mocks.result.data = [row(1, { status: 'read' }), row(4)];
  const res = await reconcileConversation(params, [row(1), row(2), row(3)], { fingerprint: 'old', revisions: { [id(1)]: '1', [id(2)]: '1', [id(3)]: '1' } });
  expect(builder.in).toHaveBeenCalledWith('id', [id(1), id(4)]);
  expect(builder.eq).toHaveBeenCalledWith('organization_id', 'org');
  expect(res.messages.map(m => m.id)).toEqual([id(1), id(3), id(4)]);
  expect(res.messages[0].status).toBe('read');
 });
 it('propagates body errors instead of advancing snapshot', async () => {
  mocks.rpc.mockResolvedValue({ data: { fingerprint: 'new', manifest: [{ id: id(1), revision: '2' }] } });
  mocks.result.error = new Error('offline');
  await expect(reconcileConversation(params, [row(1)])).rejects.toThrow('offline');
 });
 it('merges overlapping pages without duplicates or mutating existing cache', () => {
  const old = [row(2), row(3)];
  const res = mergeMessagePages(old, [row(1), row(2, { edited: true })]);
  expect(res.map(m => m.id)).toEqual([id(1), id(2), id(3)]);
  expect(res[1]).toMatchObject({ edited: true }); expect(old[0]).not.toHaveProperty("edited");
 });
 it('preserves microsecond ordering even when UUID order disagrees', () => {
  expect(mergeMessagePages([row(1, { timestamp: '2026-09-11T12:00:00.123457Z' })], [row(2)]).map(m => m.id)).toEqual([id(2), id(1)]);
 });
 it('reconciles optimistic sends once and retains unrelated pending sends', () => {
  const pending = row(8, { id: 'optimistic_8', message_id: 'optimistic_8', content: 'hello' });
  const other = row(9, { id: 'optimistic_9', message_id: 'optimistic_9', content: 'other' });
  expect(mergeMessagePages([pending, other], [row(1, { content: 'hello' })]).map(m => m.id)).toEqual([id(1), 'optimistic_9']);
 });
});

it('preserves updates and deletes arriving during a page fetch', () => {
 const before = [row(2), row(3)];
 const fetched = mergeMessagePages(before, [row(1)]);
 const live = [row(2, { status: 'read' }), row(4)];
 const result = mergeConcurrentMessages(before, fetched, live);
 expect(result.map(m => m.id)).toEqual([id(1), id(2), id(4)]);
 expect(result[1].status).toBe('read');
});
