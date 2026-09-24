// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyMessageUpdate } from '../../supabase/functions/whatsapp-webhook/message-update.ts';
import { canonicalDatabase, canonicalSchema } from '../fixtures/ingress-canonical/database';

// Only logging is isolated. Message updates, quote lookup/completion and release
// gating are the actual production functions, with real SQL predicates/writes.
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn() }));
let pg: PGlite;
let db: ReturnType<typeof canonicalDatabase>;
const instance = { id: 'instance-a', organization_id: 'org-a', phone_number: '5511000000000' };

beforeEach(async () => {
  vi.stubGlobal('Deno', { env: { get: (name: string) => name === 'COPILOT_QUOTE_LIVE_SEND_ORG_IDS' ? 'org-a,org-b' : undefined } });
  pg = new PGlite();
  await pg.exec(canonicalSchema);
  db = canonicalDatabase(pg);
  for (const tenant of ['a', 'b']) {
    await pg.query('INSERT INTO copilot_quotes VALUES($1,$2,$3,1,$4)', [`quote-${tenant}`, `org-${tenant}`, `conversation-${tenant}`, 'awaiting_confirmation']);
    await pg.query('INSERT INTO conversation_messages VALUES($1,$2,$3::jsonb)', [
      `presentation-${tenant}`, `conversation-${tenant}`, JSON.stringify({ preserve: 'existing-metadata', quote_delivery: {
        quote_id: `quote-${tenant}`, conversation_id: `conversation-${tenant}`, revision: 1,
        instance_id: `instance-${tenant}`, message_ids: ['5511000000000:chunk-1', '5511000000000:chunk-2'],
      } }),
    ]);
    for (const chunk of [1, 2]) await pg.query(
      'INSERT INTO whatsapp_messages(id,message_id,organization_id,instance_id,direction,status) VALUES($1,$2,$3,$4,$5,$6)',
      [`row-${tenant}-${chunk}`, `5511000000000:chunk-${chunk}`, `org-${tenant}`, `instance-${tenant}`, 'outgoing', 'pending'],
    );
  }
}, 15_000);
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await pg?.close(); });

interface PresentationMetadata {
  preserve: string;
  quote_delivery: Record<string, unknown>;
  quote_presentation?: { accepted_at: string; instance_id: string; quote_id: string; revision: number };
}
async function metadata(tenant = 'a') {
  return (await pg.query<{ metadata: PresentationMetadata }>('SELECT metadata FROM conversation_messages WHERE id=$1', [`presentation-${tenant}`])).rows[0].metadata;
}
async function statuses(tenant = 'a') {
  return (await pg.query<{ status: string }>('SELECT status FROM whatsapp_messages WHERE organization_id=$1 ORDER BY id', [`org-${tenant}`])).rows.map(row => row.status);
}
const receipt = (ids: string[], status = 'read') => applyMessageUpdate(db, instance, { ids, status }, { requireTarget: true });

it('replays a receipt after its statuses committed but quote sealing failed; first successful seal remains immutable', async () => {
  await pg.exec("SET fixture.fail_seal = 'true'");
  await expect(receipt(['chunk-1', 'chunk-2'])).rejects.toThrow('Quote receipt persistence failed');
  expect(await statuses()).toEqual(['read', 'read']);
  expect((await metadata()).quote_presentation).toBeUndefined();
  expect(await statuses('b')).toEqual(['pending', 'pending']);
  expect((await metadata('b')).quote_presentation).toBeUndefined();
  await pg.exec("SET fixture.fail_seal = 'false'");
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T13:00:00Z'));
  await receipt(['chunk-1', 'chunk-2']);
  const sealed = await metadata();
  expect(sealed.quote_presentation).toEqual({ accepted_at: '2026-09-24T13:00:00.000Z', instance_id: 'instance-a', quote_id: 'quote-a', revision: 1 });
  expect(sealed.preserve).toBe('existing-metadata');
  vi.setSystemTime(new Date('2026-09-24T14:00:00Z'));
  // Models replay after seal committed but inbox completion was lost. Also
  // verifies old delivered/sent receipts cannot regress read or move consent.
  await receipt(['chunk-1', 'chunk-2']);
  await receipt(['chunk-1', 'chunk-2'], 'delivered');
  await receipt(['chunk-1', 'chunk-2'], 'sent');
  expect(await metadata()).toEqual(sealed);
  expect(await statuses()).toEqual(['read', 'read']);
});

it('waits for every chunk and dates acceptance at verification, not an earlier callback', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T13:00:00Z'));
  await receipt(['chunk-1'], 'delivered');
  expect((await metadata()).quote_presentation).toBeUndefined();
  vi.setSystemTime(new Date('2026-09-24T13:05:00Z'));
  await receipt(['chunk-2'], 'sent');
  expect((await metadata()).quote_presentation?.accepted_at).toBe('2026-09-24T13:05:00.000Z');
});

it('rejects mismatched instance/tenant and missing targets without partial writes', async () => {
  await expect(applyMessageUpdate(db, { ...instance, organization_id: 'org-b' }, { ids: ['chunk-1'], status: 'read' }, { requireTarget: true }))
    .rejects.toThrow('Message update target unavailable');
  await expect(receipt(['chunk-1', 'missing-chunk'])).rejects.toThrow('Message update target unavailable');
  expect(await statuses()).toEqual(['pending', 'pending']);
  expect(await statuses('b')).toEqual(['pending', 'pending']);
  expect((await metadata()).quote_presentation).toBeUndefined();
  expect((await metadata('b')).quote_presentation).toBeUndefined();
});

it('does not seal a superseded quote revision even when all receipt statuses persist', async () => {
  await pg.exec("UPDATE copilot_quotes SET revision=2 WHERE id='quote-a'");
  await receipt(['chunk-1', 'chunk-2']);
  expect(await statuses()).toEqual(['read', 'read']);
  expect((await metadata()).quote_presentation).toBeUndefined();
});

it('keeps completion behind the actual organization release gate', async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  await receipt(['chunk-1', 'chunk-2']);
  expect(await statuses()).toEqual(['read', 'read']);
  expect((await metadata()).quote_presentation).toBeUndefined();
});
