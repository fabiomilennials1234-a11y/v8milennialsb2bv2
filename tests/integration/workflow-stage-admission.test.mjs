import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20271021000030_workflow_stage_http_admission.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../../supabase/migrations/rollback/20271021000030_workflow_stage_http_admission.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000001';
const otherOrg = '00000000-0000-0000-0000-000000000002';
const pipeline = '00000000-0000-0000-0000-000000000003';
const entry = '00000000-0000-0000-0000-000000000004';
const user = '00000000-0000-0000-0000-000000000005';
const member = '00000000-0000-0000-0000-000000000006';
const lead = '00000000-0000-0000-0000-000000000007';
const deal = '00000000-0000-0000-0000-000000000008';
const stage = '00000000-0000-0000-0000-000000000009';

// A disposable Postgres engine executes the real trigger. Only HTTP delivery
// is replaced by a collector; tests never contact Supabase or provider services.
test('stage event admission preserves derived triggers, tenant scope, payload, grants and rollback', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE SCHEMA capacity_test_net;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${user}'::uuid $$;
      CREATE TABLE pipelines(id uuid PRIMARY KEY, slug text, type text);
      CREATE TABLE team_members(id uuid, user_id uuid, organization_id uuid, is_active boolean);
      CREATE TABLE workflows(organization_id uuid, trigger_type text, is_active boolean);
      CREATE TABLE cron_config(key text, value text);
      CREATE TABLE pipeline_entries(id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid, lead_id uuid, deal_id uuid, stage_id uuid, stage_key text);
      CREATE TABLE http_calls(url text, headers jsonb, body jsonb);
      CREATE FUNCTION capacity_test_net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO public.http_calls VALUES(url,headers,body); RETURN 1; END $$;
      INSERT INTO pipelines VALUES('${pipeline}','whatsapp','system');
      INSERT INTO team_members VALUES('${member}','${user}','${org}',true);
      INSERT INTO cron_config VALUES('campaign_rule_dispatch_url','https://fixture.example/functions/v1/campaign-rule-dispatch'),('cron_secret','test-secret');
      INSERT INTO pipeline_entries VALUES('${entry}','${org}','${pipeline}','${lead}','${deal}','${stage}','before');`);
    await db.exec(rollback);
    await db.exec(`REVOKE ALL ON FUNCTION public.trigger_workflow_pipeline_stage_changed() FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION public.trigger_workflow_pipeline_stage_changed() TO authenticated,service_role;
      CREATE TRIGGER fixture_stage_changed AFTER UPDATE OF stage_key,stage_id ON pipeline_entries
      FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key)
      EXECUTE FUNCTION public.trigger_workflow_pipeline_stage_changed();`);
    const security = async () => (await db.query(`SELECT prosecdef,proconfig,proacl::text FROM pg_proc
      WHERE oid='public.trigger_workflow_pipeline_stage_changed()'::regprocedure`)).rows;
    const beforeSecurity = await security();
    await db.exec(migration);
    assert.deepEqual(await security(), beforeSecurity);
    const original = (await db.query(`SELECT pg_get_functiondef('public.trigger_workflow_pipeline_stage_changed()'::regprocedure) AS definition`)).rows[0].definition;
    assert.match(original, /net\.http_post/);
    await db.exec(original.replaceAll('net.http_post', 'capacity_test_net.http_post'));
    let counter = 0;
    const move = async () => {
      await db.exec(`TRUNCATE http_calls; UPDATE pipeline_entries SET stage_key='stage-${++counter}' WHERE id='${entry}';`);
      return (await db.query('SELECT * FROM http_calls')).rows;
    };
    assert.equal((await move()).length, 0, 'no workflows: no HTTP');
    await db.exec(`INSERT INTO workflows VALUES('${otherOrg}','stage_changed',true),('${org}','stage_changed',false),('${org}','lead_created',true);`);
    assert.equal((await move()).length, 0, 'other tenant, inactive and unrelated workflows cannot admit');
    for (const type of ['stage_changed','deal_won','deal_lost']) {
      await db.exec(`TRUNCATE workflows; INSERT INTO workflows VALUES('${org}','${type}',true);`);
      const calls = await move();
      assert.equal(calls.length, 1, `active ${type} must preserve dispatch`);
      assert.equal(calls[0].url, 'https://fixture.example/functions/v1/process-workflow-executions');
      assert.deepEqual(calls[0].headers, { 'Content-Type': 'application/json', 'x-cron-secret': 'test-secret' });
      assert.deepEqual(calls[0].body, {
        mode: 'fire_trigger', organization_id: org, trigger_type: 'stage_changed', lead_id: lead,
        context: {
          trigger: 'stage_changed', pipeline_id: pipeline, pipe_type: 'whatsapp', pipeline_entry_id: entry,
          deal_id: deal, stage_id: stage, stage_key: `stage-${counter}`, from_stage: `stage-${counter - 1}`,
          from_stage_id: stage, to_stage: `stage-${counter}`, changed_by_user_id: user, changed_by_member_id: member,
        },
      });
    }
    await db.exec(`TRUNCATE http_calls; UPDATE pipeline_entries SET stage_key=stage_key WHERE id='${entry}';`);
    assert.equal((await db.query('SELECT * FROM http_calls')).rows.length, 0, 'unchanged stage preserves trigger WHEN');
    await db.exec(`UPDATE pipelines SET type='custom';`);
    assert.equal((await move()).length, 0, 'custom pipeline keeps its separate existing trigger');
    await db.exec(`UPDATE pipelines SET type='system'; TRUNCATE workflows;`);
    assert.equal((await move()).length, 0);
    await db.exec(`INSERT INTO workflows VALUES('${org}','stage_changed',true);`);
    assert.equal((await db.query('SELECT * FROM http_calls')).rows.length, 0, 'later enable does not retroactively dispatch');
    assert.equal((await move()).length, 1, 'next event dispatches without waiting or batching');
    await db.exec(rollback);
    assert.deepEqual(await security(), beforeSecurity);
    const restored = (await db.query(`SELECT pg_get_functiondef('public.trigger_workflow_pipeline_stage_changed()'::regprocedure) AS definition`)).rows[0].definition;
    await db.exec(restored.replaceAll('net.http_post', 'capacity_test_net.http_post'));
    await db.exec('TRUNCATE workflows;');
    assert.equal((await move()).length, 1, 'rollback restores legacy unguarded dispatch');
    await db.exec(migration.replaceAll('net.http_post', 'capacity_test_net.http_post'));
    assert.equal((await move()).length, 0, 'reapply restores admission');
  } finally { await db.close(); }
});

test('remote harness remains isolated and rolls back all fixture objects', async () => {
  const { buildWorkflowAdmissionPreviewValidation } = await import('../../scripts/build-workflow-admission-preview-validation.mjs');
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;');
    const sql = buildWorkflowAdmissionPreviewValidation();
    assert.doesNotMatch(sql, /(?:FUNCTION|TABLE|TRIGGER) (?:public|auth|net)\./);
    assert.doesNotMatch(sql, /\b(?:net\.http_post|auth\.uid)\(/);
    const results = await db.exec(sql);
    assert.ok(results.some(result => result.rows?.some(row => String(row.validation).startsWith('PASS:'))));
    assert.equal((await db.query("SELECT to_regnamespace('workflow_admission_test') AS fixture")).rows[0].fixture, null);
  } finally { await db.close(); }
});
