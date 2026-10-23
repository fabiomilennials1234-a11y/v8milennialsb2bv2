import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('privacy queue: grants, RLS and honest completion constraint', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`);
    await db.exec(readFileSync('supabase/migrations/20271215000000_meta_privacy_requests.sql', 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      const result = await db.query(`SELECT has_table_privilege($1, 'public.meta_privacy_requests', 'SELECT') AS can_read,
        has_table_privilege($1, 'public.meta_privacy_requests', 'INSERT') AS can_write`, [role]);
      assert.deepEqual(result.rows[0], { can_read: false, can_write: false });
    }
    assert.equal((await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid='public.meta_privacy_requests'::regclass`)).rows[0].relrowsecurity, true);
    await db.exec('SET ROLE service_role');
    const code = 'a'.repeat(64);
    await db.query(`INSERT INTO public.meta_privacy_requests (confirmation_code, app_id, meta_user_id, kind) VALUES ($1,'2095970848458119','123','deletion')`, [code]);
    assert.equal((await db.query('SELECT status FROM public.meta_privacy_requests')).rows[0].status, 'pending');
    await assert.rejects(db.exec(`UPDATE public.meta_privacy_requests SET status='completed'`), /meta_privacy_completion/);
    await db.exec(`UPDATE public.meta_privacy_requests SET status='completed', completed_at=now(), resolution_note='Verified removal in test fixture'`);
    assert.equal((await db.query('SELECT status FROM public.meta_privacy_requests')).rows[0].status, 'completed');
  } finally { await db.close(); }
});
