import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = '20271021000026_cron_skip_idle_dispatch.sql';

test('cron guards preserve due work, recovery, auth and service-only grants; rollback/reapply works', async () => {
  const db = new PGlite();
  try {
    await db.exec(read('tests/fixtures/cron-idle-dispatch-schema.sql'));
    await db.exec(read(`supabase/migrations/${migration}`));
    await db.exec(read('tests/integration/cron-idle-dispatch.sql'));
    await db.exec(read(`supabase/migrations/rollback/${migration}`));
    const names = ['invoke_process_ai_actions', 'invoke_process_scheduled_user_messages',
      'invoke_history_sync_worker', 'invoke_send_push', 'invoke_copilot_v2_worker', 'invoke_mass_send_status',
      'invoke_whatsapp_media_retry', 'invoke_whatsapp_dlq_replay'];
    for (const name of names) {
      await db.query('SELECT public.fixture_assert_dispatch($1, 1)', [name]);
    }
    await db.exec(read(`supabase/migrations/${migration}`));
    for (const name of names) {
      await db.query('SELECT public.fixture_assert_dispatch($1, 0)', [name]);
    }
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_proc
      WHERE proname = ANY($1::text[]) AND prosecdef
      AND proconfig IS NOT NULL`, [names]);
    assert.equal(rows[0].n, 8);
  } finally {
    await db.close();
  }
});
