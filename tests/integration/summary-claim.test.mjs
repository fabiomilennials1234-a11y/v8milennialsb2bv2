import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const proposal = 'docs/operations/proposals/summary-claim-fix';

test('reproduces the production ambiguity and restores discovery, leases and bounded claims', async () => {
  const db = new PGlite();
  try {
    await db.exec(read('tests/fixtures/cron-idle-dispatch-schema.sql'));
    await db.exec(read('tests/fixtures/summary-claim-schema.sql'));
    await db.exec(read(`${proposal}-rollback.sql`));
    await assert.rejects(db.query('SELECT * FROM public.claim_conversation_summary_jobs(10)'),
      error => error.code === '42702' && error.message.includes('organization_id'));
    await db.exec(read(`${proposal}.sql`));
    await db.exec(read('tests/integration/summary-claim.sql'));
    await db.exec(read(`${proposal}-rollback.sql`));
    await assert.rejects(db.query('SELECT * FROM public.claim_conversation_summary_jobs(10)'),
      error => error.code === '42702');
    await db.exec(read(`${proposal}.sql`));
    assert.equal((await db.query('SELECT * FROM public.claim_conversation_summary_jobs(10)')).rows.length, 0);
  } finally { await db.close(); }
});
