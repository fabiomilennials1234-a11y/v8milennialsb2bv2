import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = '20271021000027_cron_skip_idle_campaigns.sql';
const signatures = ['invoke_pipe_rule_dispatch()', 'invoke_campaign_rule_dispatch()',
  'invoke_process_blast_recipients()', 'invoke_oraculo_feedback_worker(text)'];

test('campaign guards preserve timeouts, recovery, release/provider gates, weekly work and grants', async () => {
  const db = new PGlite();
  async function dispatch(call, count, mode) {
    await db.exec('TRUNCATE public.fixture_http_calls');
    await db.exec(`SELECT public.${call}`);
    const { rows } = await db.query('SELECT * FROM public.fixture_http_calls');
    assert.equal(rows.length, count, call);
    if (count) {
      assert.equal(rows[0].headers['x-cron-secret'], 'fixture-secret');
      assert.deepEqual(rows[0].body, mode ? { mode } : {});
      assert.match(rows[0].url, /^https:\/\/fixture\.invalid\/functions\/v1\//);
    }
  }
  try {
    await db.exec(read('tests/fixtures/cron-idle-dispatch-schema.sql'));
    await db.exec(read('tests/fixtures/cron-idle-campaigns-schema.sql'));
    await db.exec(read(`supabase/migrations/${migration}`));
    for (const signature of signatures) {
      const { rows } = await db.query(`SELECT
        has_function_privilege('anon', $1, 'EXECUTE') anon,
        has_function_privilege('authenticated', $1, 'EXECUTE') authenticated,
        has_function_privilege('service_role', $1, 'EXECUTE') service`, [`public.${signature}`]);
      assert.deepEqual(rows[0], { anon: false, authenticated: false, service: true });
    }
    for (const kind of ['pipe', 'campaign']) {
      const table = `scheduled_${kind}_messages`;
      const call = `invoke_${kind}_rule_dispatch()`;
      await dispatch(call, 0);
      await db.exec(`INSERT INTO public.${table} VALUES
        ('scheduled', now()+interval '1 hour',NULL),
        ('waiting_response',NULL,now()+interval '1 hour'),
        ('processing',now(),NULL), ('sent',now()-interval '1 hour',NULL)`);
      await dispatch(call, 0);
      for (const row of ["('scheduled',now(),NULL)", "('waiting_response',NULL,now())",
        "('processing',now()-interval '3 minutes',NULL)"]) {
        await db.exec(`TRUNCATE public.${table}; INSERT INTO public.${table} VALUES ${row}`);
        const before = await db.query(`SELECT * FROM public.${table}`);
        await dispatch(call, 1);
        assert.deepEqual((await db.query(`SELECT * FROM public.${table}`)).rows, before.rows, 'probe must not claim or reset work');
      }
      await db.exec(`TRUNCATE public.${table}`);
    }

    await dispatch("invoke_oraculo_feedback_worker('alerts')", 0);
    await dispatch("invoke_oraculo_feedback_worker('weekly')", 1, 'weekly');
    await db.exec("INSERT INTO public.oraculo_feedback_alerts VALUES ('pending',now()+interval '1 hour',NULL),('processing',NULL,now()+interval '1 hour'),('sent',now()-interval '1 hour',NULL)");
    await dispatch("invoke_oraculo_feedback_worker('alerts')", 0);
    for (const row of ["('pending',now(),NULL)", "('processing',NULL,now()-interval '1 second')"]) {
      await db.exec(`TRUNCATE public.oraculo_feedback_alerts; INSERT INTO public.oraculo_feedback_alerts VALUES ${row}`);
      await dispatch("invoke_oraculo_feedback_worker('alerts')", 1, 'alerts');
    }
    await db.exec('TRUNCATE public.oraculo_feedback_alerts');

    await dispatch('invoke_process_blast_recipients()', 0);
    await db.exec("INSERT INTO public.whatsapp_instances VALUES (1,'notificame'); INSERT INTO public.blast_plans VALUES (1,1,'active','{}',1); INSERT INTO public.blast_plan_recipients VALUES (1,'pending',NULL,0)");
    await dispatch('invoke_process_blast_recipients()', 1);
    for (const [change, restore] of [
      ["UPDATE public.blast_plans SET status='paused'", "UPDATE public.blast_plans SET status='active'"],
      ["UPDATE public.blast_plans SET template=NULL", "UPDATE public.blast_plans SET template='{}'"],
      ["UPDATE public.blast_plans SET lots_released=0", "UPDATE public.blast_plans SET lots_released=1"],
      ["UPDATE public.whatsapp_instances SET provider='uazapi'", "UPDATE public.whatsapp_instances SET provider='notificame'"],
      ["UPDATE public.blast_plan_recipients SET status='sent'", "UPDATE public.blast_plan_recipients SET status='pending'"],
      ["UPDATE public.blast_plan_recipients SET claimed_at=now()", "UPDATE public.blast_plan_recipients SET claimed_at=NULL"],
    ]) {
      await db.exec(change);
      await dispatch('invoke_process_blast_recipients()', 0);
      await db.exec(restore);
      await dispatch('invoke_process_blast_recipients()', 1);
    }
    await db.exec("UPDATE public.blast_plan_recipients SET claimed_at=now()-interval '11 minutes'");
    const before = await db.query('SELECT * FROM public.blast_plan_recipients');
    await dispatch('invoke_process_blast_recipients()', 1);
    assert.deepEqual((await db.query('SELECT * FROM public.blast_plan_recipients')).rows, before.rows);
    await db.exec('TRUNCATE public.blast_plan_recipients');

    // Rollback restores dispatch, then reapplying guards skips all empty queues.
    await db.exec(read(`supabase/migrations/rollback/${migration}`));
    for (const call of ['invoke_pipe_rule_dispatch()', 'invoke_campaign_rule_dispatch()', 'invoke_process_blast_recipients()']) await dispatch(call, 1);
    await dispatch("invoke_oraculo_feedback_worker('alerts')", 1, 'alerts');
    await db.exec(read(`supabase/migrations/${migration}`));
    for (const call of ['invoke_pipe_rule_dispatch()', 'invoke_campaign_rule_dispatch()', 'invoke_process_blast_recipients()', "invoke_oraculo_feedback_worker('alerts')"]) await dispatch(call, 0);
    await dispatch("invoke_oraculo_feedback_worker('weekly')", 1, 'weekly');
  } finally { await db.close(); }
});
