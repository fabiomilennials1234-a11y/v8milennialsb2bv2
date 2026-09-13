import { describe, expect, it } from 'vitest';
import { persistOutboundReaction, replaceOwnReaction } from '../../supabase/functions/_shared/persist-outbound-reaction';
const scope = { organizationId: 'org', instanceId: 'instance', messageId: 'message' };
const incoming = { emoji: '👍', from: 'them', sender: 'contact', count: 1 };
function database(reads: unknown[], writes: unknown[]) {
  const filters: unknown[] = []; const patches: unknown[] = []; let updating = false;
  const chain = {
    select: () => updating ? Promise.resolve(writes.shift()) : chain,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
    is: (key: string, value: unknown) => { filters.push([key, value]); return chain; },
    maybeSingle: () => Promise.resolve(reads.shift()),
    update: (patch: unknown) => { updating = true; patches.push(patch); return chain; },
  };
  const db = { from: () => { updating = false; return chain; } };
  return { db: db as unknown as Parameters<typeof persistOutboundReaction>[0], filters, patches };
}
describe('outbound reaction persistence', () => {
  it('replaces/removes only our reaction and is idempotent', () => {
    const next = replaceOwnReaction([incoming, { emoji: '❤️', from: 'me' }], '✅');
    expect(next).toEqual([incoming, { emoji: '✅', from: 'me', count: 1 }]);
    expect(replaceOwnReaction(next, '✅')).toEqual(next);
    expect(replaceOwnReaction(next, '')).toEqual([incoming]);
  });
  it('scopes read and write by tenant and instance', async () => {
    const mock = database([{ data: { id: 'row', reactions: [incoming] } }], [{ data: [{ id: 'row' }] }]);
    await persistOutboundReaction(mock.db, scope, '❤️');
    expect(mock.filters.filter(x => JSON.stringify(x) === '["organization_id","org"]')).toHaveLength(2);
    expect(mock.filters.filter(x => JSON.stringify(x) === '["instance_id","instance"]')).toHaveLength(2);
    expect(mock.filters).toContainEqual(['message_id', 'message']);
    expect(mock.filters).toContainEqual(['reactions', JSON.stringify([incoming])]);
    expect(mock.patches).toEqual([{ reactions: [incoming, { emoji: '❤️', from: 'me', count: 1 }] }]);
  });
  it('re-reads concurrent updates and preserves a newly received reaction', async () => {
    const mock = database([{ data: { id: 'row', reactions: [] } }, { data: { id: 'row', reactions: [incoming] } }], [{ data: [] }, { data: [{ id: 'row' }] }]);
    await persistOutboundReaction(mock.db, scope, '❤️');
    expect(mock.patches[1]).toEqual({ reactions: [incoming, { emoji: '❤️', from: 'me', count: 1 }] });
  });
  it('fails closed for an absent or inaccessible message', async () => {
    const mock = database([{ data: null }], []);
    await expect(persistOutboundReaction(mock.db, scope, '❤️')).rejects.toThrow('target unavailable');
    expect(mock.patches).toEqual([]);
  });
  it('surfaces persistence failure instead of reporting false success', async () => {
    const mock = database([{ data: { id: 'row', reactions: null } }], [{ error: { message: 'denied' } }]);
    await expect(persistOutboundReaction(mock.db, scope, '')).rejects.toThrow('persistence failed');
    expect(mock.filters).toContainEqual(['reactions', null]);
  });
});
