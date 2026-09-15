import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('sales publication migration is idempotent and reversible', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE public.sale_events(id int PRIMARY KEY); CREATE PUBLICATION supabase_realtime;');
    const migration = readFileSync(new URL('../../supabase/migrations/20260915193913_sales_metrics_realtime.sql', import.meta.url), 'utf8');
    const rollback = readFileSync(new URL('../../supabase/migrations/rollback/20260915193913_sales_metrics_realtime.sql', import.meta.url), 'utf8');
    const count = async () => (await db.query("select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='sale_events'")).rows[0].n;
    assert.equal(await count(), 0);
    await db.exec(migration);
    assert.equal(await count(), 1);
    await db.exec(migration);
    assert.equal(await count(), 1);
    await db.exec(rollback);
    assert.equal(await count(), 0);
  } finally {
    await db.close();
  }
});
