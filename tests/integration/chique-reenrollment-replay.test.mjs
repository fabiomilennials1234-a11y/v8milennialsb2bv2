import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20271021000025_chique_r_mercos_reenrollment_guard.sql', import.meta.url), 'utf8');
const workflow = 'f7cc3e94-b174-452c-a1a7-e2d5085c2b76';
const org = '38f3bea4-44c6-4732-bb20-065f547a7ed8';

test('tenant-specific reenrollment migration replays empty and is idempotent without weakening its tenant guard', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE workflows(id uuid PRIMARY KEY, organization_id uuid, is_active boolean, re_enrollment_enabled boolean);
    `);
    await db.exec(migration);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM workflows')).rows[0].n, 0);
    await db.query('INSERT INTO workflows VALUES ($1,$2,true,false)', [workflow, org]);
    await db.query('INSERT INTO workflows VALUES (gen_random_uuid(),gen_random_uuid(),true,false)');
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query('SELECT re_enrollment_enabled FROM workflows WHERE id=$1', [workflow])).rows[0].re_enrollment_enabled, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM workflows WHERE id<>$1 AND re_enrollment_enabled', [workflow])).rows[0].n, 0);

    await db.query('UPDATE workflows SET is_active=false,re_enrollment_enabled=false WHERE id=$1', [workflow]);
    await assert.rejects(db.transaction(tx => tx.exec(migration)), /not an active, disabled workflow/);
    await db.query('UPDATE workflows SET is_active=true,organization_id=gen_random_uuid() WHERE id=$1', [workflow]);
    await assert.rejects(db.transaction(tx => tx.exec(migration)), /not an active, disabled workflow/);
    assert.equal((await db.query('SELECT re_enrollment_enabled FROM workflows WHERE id=$1', [workflow])).rows[0].re_enrollment_enabled, false);
  } finally { await db.close(); }
});
