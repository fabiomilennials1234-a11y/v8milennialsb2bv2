import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = '20271021000031_cron_skip_idle_followups.sql';
const names = ['invoke_meta_leadgen_poll', 'invoke_process_copilot_followups',
  'invoke_process_followup_automations', 'invoke_process_followup_situations',
  'invoke_process_outbound_dispatches', 'invoke_workflow_cron_triggers'];
const schema = `
CREATE TABLE public.meta_asset_bindings (asset_type text, status text, organization_id uuid);
CREATE TABLE public.copilot_agent_followup_rules (is_active boolean, trigger_type text);
CREATE TABLE public.follow_up_automations (is_active boolean, trigger_type text, organization_id uuid);
CREATE TABLE public.copilot_followup_situation_config (is_active boolean, organization_id uuid);
CREATE TABLE public.outbound_dispatch_log (status text, agent_id uuid, scheduled_at timestamptz);
CREATE TABLE public.workflows (is_active boolean, trigger_type text, organization_id uuid);
INSERT INTO public.cron_config VALUES
 ('meta_leadgen_poll_url', 'https://fixture.invalid/functions/v1/meta-leadgen-poll'),
 ('process_copilot_followups_url', 'https://fixture.invalid/functions/v1/process-copilot-followups'),
 ('process_followup_automations_url', 'https://fixture.invalid/functions/v1/process-followup-automations'),
 ('process_outbound_dispatches_url', 'https://fixture.invalid/functions/v1/process-outbound-dispatches');
`;
const orgA = '00000000-0000-0000-0000-000000000001';
const orgB = '00000000-0000-0000-0000-000000000002';

async function setup() {
  const db = new PGlite();
  await db.exec(read('tests/fixtures/cron-idle-dispatch-schema.sql'));
  await db.exec(schema);
  await db.exec(read(`supabase/migrations/rollback/${migration}`));
  return db;
}

async function dispatch(db, name, count) {
  await db.exec('TRUNCATE public.fixture_http_calls');
  await db.exec(`SELECT public.${name}()`);
  const { rows } = await db.query('SELECT * FROM public.fixture_http_calls');
  assert.equal(rows.length, count, name);
  if (count) {
    assert.equal(rows[0].headers['x-cron-secret'], 'fixture-secret');
    assert.deepEqual(rows[0].body, name === 'invoke_workflow_cron_triggers' ? { mode: 'cron_triggers' } : {});
    const endpoint = name === 'invoke_workflow_cron_triggers' ? 'process-workflow-executions' : name.replace('invoke_', '').replaceAll('_', '-');
    assert.ok(rows[0].url.endsWith(`/functions/v1/${endpoint}`), rows[0].url);
  }
}

test('six scheduler guards skip empty work, preserve exact dispatch contract and rollback', async () => {
  const db = await setup();
  try {
    const originals = await db.query("SELECT proname, pg_get_functiondef(oid) definition, proacl::text acl FROM pg_proc WHERE proname LIKE 'invoke_%' ORDER BY proname");
    await db.exec(read(`supabase/migrations/${migration}`));
    for (const name of names) {
      await dispatch(db, name, 0);
      const { rows } = await db.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') anon,
        has_function_privilege('authenticated', $1, 'EXECUTE') authenticated,
        has_function_privilege('service_role', $1, 'EXECUTE') service`, [`public.${name}()`]);
      assert.deepEqual(rows[0], { anon: false, authenticated: false, service: true });
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`SET ROLE ${role}`);
        await assert.rejects(db.exec(`SELECT public.${name}()`), /permission denied/);
        await db.exec('RESET ROLE');
      }
    }

    // Each periodic class is independently admitted. In particular scheduled_date
    // and cron must not disappear merely because the older inventory listed three.
    for (const type of ['cron', 'scheduled_date', 'lead_no_reply', 'meeting_not_confirmed', 'followup_overdue']) {
      await db.exec(`TRUNCATE public.workflows; INSERT INTO public.workflows VALUES(false,'${type}','${orgA}'),(true,'lead_created','${orgA}')`);
      await dispatch(db, 'invoke_workflow_cron_triggers', 0);
      await db.exec(`INSERT INTO public.workflows VALUES(true,'${type}','${orgB}')`);
      const before = await db.query('SELECT * FROM public.workflows');
      await dispatch(db, 'invoke_workflow_cron_triggers', 1);
      assert.deepEqual((await db.query('SELECT * FROM public.workflows')).rows, before.rows);
    }
    await db.exec('TRUNCATE public.workflows');

    for (const type of ['no_response', 'after_qualification', 'after_meeting_scheduled', 'post_sale', 'proposal_no_response']) {
      await db.exec(`TRUNCATE public.copilot_agent_followup_rules; INSERT INTO public.copilot_agent_followup_rules VALUES(false,'${type}'),(true,'unknown')`);
      await dispatch(db, 'invoke_process_copilot_followups', 0);
      await db.exec(`INSERT INTO public.copilot_agent_followup_rules VALUES(true,'${type}')`);
      await dispatch(db, 'invoke_process_copilot_followups', 1);
    }
    await db.exec('TRUNCATE public.copilot_agent_followup_rules');

    await db.exec(`INSERT INTO public.follow_up_automations VALUES(true,'stage_change','${orgA}'),(false,'no_response','${orgA}'),(true,'no_response',NULL),(true,NULL,'${orgA}')`);
    await dispatch(db, 'invoke_process_followup_automations', 0);
    await db.exec(`INSERT INTO public.follow_up_automations VALUES(true,'no_response','${orgB}')`);
    await dispatch(db, 'invoke_process_followup_automations', 1);
    await db.exec("DELETE FROM public.cron_config WHERE key='process_followup_automations_url'; INSERT INTO public.cron_config VALUES('supabase_functions_base_url','https://fixture.invalid/functions/v1')");
    await dispatch(db, 'invoke_process_followup_automations', 1);
    await db.exec('TRUNCATE public.follow_up_automations');

    await db.exec(`INSERT INTO public.copilot_followup_situation_config VALUES(false,'${orgA}')`);
    await dispatch(db, 'invoke_process_followup_situations', 0);
    await db.exec(`INSERT INTO public.copilot_followup_situation_config VALUES(true,'${orgB}')`);
    await dispatch(db, 'invoke_process_followup_situations', 1);
    await db.exec('TRUNCATE public.copilot_followup_situation_config');

    await db.exec(`INSERT INTO public.meta_asset_bindings VALUES('ad_account','active','${orgA}'),('page','disabled','${orgA}')`);
    await dispatch(db, 'invoke_meta_leadgen_poll', 0);
    await db.exec(`INSERT INTO public.meta_asset_bindings VALUES('page','active','${orgB}')`);
    await dispatch(db, 'invoke_meta_leadgen_poll', 1);
    await db.exec('TRUNCATE public.meta_asset_bindings');

    await db.exec(`INSERT INTO public.outbound_dispatch_log VALUES
      ('pending','${orgA}',now()+interval '1 hour'),('pending',NULL,now()-interval '1 hour'),
      ('sent','${orgA}',now()-interval '1 hour'),('failed','${orgA}',now()-interval '1 hour'),
      ('cancelled','${orgA}',now()-interval '1 hour'),('pending','${orgA}',NULL)`);
    await dispatch(db, 'invoke_process_outbound_dispatches', 0);
    // Same transaction proves the exact <= now boundary, no real clock wait.
    await db.exec('BEGIN');
    await db.exec(`INSERT INTO public.outbound_dispatch_log VALUES('pending','${orgB}',now())`);
    const before = await db.query('SELECT * FROM public.outbound_dispatch_log');
    await dispatch(db, 'invoke_process_outbound_dispatches', 1);
    assert.deepEqual((await db.query('SELECT * FROM public.outbound_dispatch_log')).rows, before.rows, 'probe cannot claim/send');
    await db.exec('COMMIT');
    await db.exec('TRUNCATE public.outbound_dispatch_log');

    await db.exec(read(`supabase/migrations/rollback/${migration}`));
    const restored = await db.query("SELECT proname, pg_get_functiondef(oid) definition, proacl::text acl FROM pg_proc WHERE proname LIKE 'invoke_%' ORDER BY proname");
    assert.deepEqual(restored.rows, originals.rows, 'rollback must restore every body, search_path, security and ACL');
    for (const name of names) await dispatch(db, name, 1);
    await db.exec(read(`supabase/migrations/${migration}`));
    for (const name of names) await dispatch(db, name, 0);
  } finally { await db.close(); }
});
