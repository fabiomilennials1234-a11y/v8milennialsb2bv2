import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../supabase/migrations/20271214000002_whatsapp_first_human_outbound_stage.sql');

test('first human outbound advances an opted-in initial-stage deal exactly once', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA private; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
        $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS
        $$ SELECT current_setting('test.auth_role',true) $$;
      CREATE FUNCTION public.can_see_chat_scope(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS
        $$ SELECT current_setting('test.can_see_chat',true)='true' $$;
      CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, deleted_at timestamptz);
      CREATE TABLE whatsapp_instances(id uuid PRIMARY KEY, organization_id uuid);
      CREATE TABLE pipelines(id uuid PRIMARY KEY, organization_id uuid, is_active boolean DEFAULT true,
        config jsonb DEFAULT '{}', name text DEFAULT 'Sales', slug text DEFAULT 'sales', type text DEFAULT 'custom');
      CREATE TABLE pipeline_stages(id uuid PRIMARY KEY, pipeline_id uuid, organization_id uuid,
        stage_key text, name text, position int, stage_role text DEFAULT 'open', is_active boolean DEFAULT true,
        is_final_positive boolean DEFAULT false, is_final_negative boolean DEFAULT false, pipeline_type text);
      CREATE TABLE deals(id uuid PRIMARY KEY, organization_id uuid, source_lead_id uuid,
        outcome text DEFAULT 'open', deleted_at timestamptz, closed_at timestamptz);
      CREATE TABLE pipeline_entries(id uuid PRIMARY KEY, organization_id uuid, pipeline_id uuid,
        lead_id uuid, deal_id uuid, stage_id uuid, stage_key text, metadata jsonb DEFAULT '{}', assigned_to uuid,
        closed_at timestamptz, created_at timestamptz DEFAULT '2026-10-23T10:00Z',
        stage_changed_at timestamptz DEFAULT '2026-10-23T10:00Z', updated_at timestamptz);
      CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY, organization_id uuid, instance_id uuid,
        lead_id uuid, direction text, sent_source text, status text, sent_by_ai boolean DEFAULT false,
        received_via text DEFAULT 'webhook', is_group boolean DEFAULT false, remote_jid text,
        edited boolean DEFAULT false, deleted_at timestamptz, timestamp timestamptz, created_at timestamptz,
        message_id text, sent_by_team_member_id uuid);
      CREATE TABLE lead_history(lead_id uuid,organization_id uuid,action text,description text,source text,
        created_by uuid,metadata jsonb,entity_type text,entity_id uuid);
      INSERT INTO leads VALUES('${id(1)}','${id(10)}',NULL),('${id(2)}','${id(20)}',NULL);
      INSERT INTO whatsapp_instances VALUES('${id(30)}','${id(10)}'),('${id(31)}','${id(20)}'),('${id(32)}','${id(10)}');
      INSERT INTO pipelines(id,organization_id) VALUES('${id(40)}','${id(10)}'),('${id(41)}','${id(10)}'),('${id(42)}','${id(20)}');
      INSERT INTO pipeline_stages(id,pipeline_id,organization_id,stage_key,name,position) VALUES
        ('${id(50)}','${id(40)}','${id(10)}','new','Novo',0),
        ('${id(51)}','${id(40)}','${id(10)}','talking','Em conversa',1),
        ('${id(52)}','${id(40)}','${id(10)}','proposal','Proposta',2),
        ('${id(53)}','${id(41)}','${id(10)}','new','Novo',0),
        ('${id(54)}','${id(42)}','${id(20)}','new','Novo',0);
      INSERT INTO pipeline_entries(id,organization_id,pipeline_id,lead_id,stage_id,stage_key,assigned_to,metadata) VALUES
        ('${id(60)}','${id(10)}','${id(40)}','${id(1)}','${id(50)}','new','${id(90)}','{"sale_responsible_id":"${id(90)}","keep":"value"}'),
        ('${id(61)}','${id(10)}','${id(41)}','${id(1)}','${id(53)}','new',NULL,'{}'),
        ('${id(62)}','${id(20)}','${id(42)}','${id(2)}','${id(54)}','new',NULL,'{}');
      UPDATE pipelines SET config='${JSON.stringify({ first_human_outbound_stage: {
        enabled: true, enabled_at: '2026-10-23T12:00:00Z', instance_id: id(30), from_stage_id: id(50), to_stage_id: id(51),
      } })}' WHERE id='${id(40)}';
    `);
    // Real production functions exercise UUID/key mirroring and automatic history.
    await db.exec(read('../fixtures/first-human-outbound-stage-functions.sql'));
    await db.exec(`
      CREATE TRIGGER stage_mirror BEFORE INSERT OR UPDATE ON pipeline_entries
        FOR EACH ROW EXECUTE FUNCTION public.pipeline_entries_stage_mirror();
      CREATE TRIGGER stage_history AFTER UPDATE OF stage_key ON pipeline_entries
        FOR EACH ROW EXECUTE FUNCTION public.fn_log_pipeline_stage_change_history();
    `);
    await db.exec(migration);
    let sequence = 100;
    const message = async (patch = {}) => {
      const row = { id: id(sequence++), organization_id: id(10), instance_id: id(30), lead_id: id(1),
        direction: 'outgoing', sent_source: 'manual', status: 'sent', sent_by_ai: false,
        received_via: 'webhook', is_group: false, remote_jid: '5511999999999@s.whatsapp.net',
        edited: false, timestamp: '2026-10-23T13:00:00Z', created_at: '2026-10-23T13:00:00Z', ...patch };
      const keys = Object.keys(row);
      await db.query(`INSERT INTO whatsapp_messages(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
      return row.id;
    };
    const entry = async (entryId = id(60)) => (await db.query('SELECT * FROM pipeline_entries WHERE id=$1', [entryId])).rows[0];
    const scenario = (name, fn) => t.test(name, async () => {
      await db.exec('BEGIN');
      try { await fn(); } finally { await db.exec('ROLLBACK'); }
    });

    await scenario('human send moves only the selected funnel and retains ownership/history', async () => {
      const msgId = await message();
      const moved = await entry();
      assert.equal(moved.stage_id, id(51)); assert.equal(moved.stage_key, 'talking');
      assert.equal(moved.assigned_to, id(90)); assert.equal(moved.metadata.sale_responsible_id, id(90));
      assert.equal(moved.metadata.keep, 'value');
      assert.equal(moved.metadata.first_human_outbound_stage.message_id, msgId);
      assert.equal((await entry(id(61))).stage_key, 'new');
      assert.equal((await entry(id(62))).stage_key, 'new');
      assert.equal((await db.query('SELECT * FROM lead_history')).rows.length, 1);
      await message();
      assert.equal((await db.query('SELECT * FROM lead_history')).rows.length, 1);
      await db.exec(`UPDATE pipeline_entries SET stage_id='${id(50)}',stage_key='new' WHERE id='${id(60)}'`);
      await message();
      assert.equal((await entry()).stage_key, 'new', 'manual reset is not undone by subsequent messages');
    });

    for (const [name, patch] of [
      ['inbound', { direction: 'incoming' }], ['AI', { sent_by_ai: true }],
      ['workflow', { sent_source: 'workflow' }], ['copilot', { sent_source: 'copilot' }],
      ['unknown source', { sent_source: null }], ['history', { received_via: 'history_sync' }],
      ['group flag', { is_group: true }], ['group JID', { remote_jid: '123@g.us' }],
      ['failed', { status: 'failed' }], ['pending', { status: 'pending' }], ['unknown status', { status: null }],
      ['edit', { edited: true }], ['deleted', { deleted_at: '2026-10-23T13:01Z' }],
      ['unlinked lead', { lead_id: null }], ['cross-tenant lead', { lead_id: id(2) }],
      ['other connection', { instance_id: id(32) }], ['cross-tenant connection', { instance_id: id(31) }],
      ['old message timestamp', { timestamp: '2026-10-22T13:00Z' }],
      ['old message creation', { created_at: '2026-10-22T13:00Z' }],
    ]) await scenario(`ignores ${name}`, async () => {
      await message(patch); assert.equal((await entry()).stage_key, 'new');
    });

    await scenario('pending send advances only when confirmed; later receipt is idempotent', async () => {
      const msgId = await message({ status: 'pending' });
      assert.equal((await entry()).stage_key, 'new');
      await db.query("UPDATE whatsapp_messages SET status='sent' WHERE id=$1", [msgId]);
      assert.equal((await entry()).stage_key, 'talking');
      await db.query("UPDATE whatsapp_messages SET status='read' WHERE id=$1", [msgId]);
      assert.equal((await db.query('SELECT * FROM lead_history')).rows.length, 1);
    });
    await scenario('late lead resolution works for a fresh sent message', async () => {
      const msgId = await message({ lead_id: null });
      await db.query('UPDATE whatsapp_messages SET lead_id=$1 WHERE id=$2', [id(1), msgId]);
      assert.equal((await entry()).stage_key, 'talking');
    });
    for (const [name, sql] of [
      ['later stage', `UPDATE pipeline_entries SET stage_id='${id(52)}',stage_key='proposal' WHERE id='${id(60)}'`],
      ['closed entry', `UPDATE pipeline_entries SET closed_at=now() WHERE id='${id(60)}'`],
      ['deleted lead', `UPDATE leads SET deleted_at=now() WHERE id='${id(1)}'`],
      ['deal created after message', `UPDATE pipeline_entries SET created_at='2026-10-24T10:00Z' WHERE id='${id(60)}'`],
      ['disabled rule', `UPDATE pipelines SET config=jsonb_set(config,'{first_human_outbound_stage,enabled}','false')`],
      ['invalid activation', `UPDATE pipelines SET config=jsonb_set(config,'{first_human_outbound_stage,enabled_at}','"invalid"')`],
      ['inactive destination', `UPDATE pipeline_stages SET is_active=false WHERE id='${id(51)}'`],
      ['foreign destination', `UPDATE pipelines SET config=jsonb_set(config,'{first_human_outbound_stage,to_stage_id}','"${id(54)}"')`],
    ]) await scenario(`preserves ${name}`, async () => {
      await db.exec(sql); const before = await entry(); await message();
      assert.deepEqual(await entry(), before);
    });
    await scenario('won/lost/deleted deals do not move even when still in initial stage', async () => {
      await db.exec(`INSERT INTO deals(id,organization_id,source_lead_id,outcome) VALUES('${id(70)}','${id(10)}','${id(1)}','won');
        UPDATE pipeline_entries SET deal_id='${id(70)}' WHERE id='${id(60)}'`);
      for (const outcome of ['won', 'lost']) {
        await db.query('UPDATE deals SET outcome=$1', [outcome]); await message();
        assert.equal((await entry()).stage_key, 'new');
      }
      await db.exec("UPDATE deals SET outcome='open',deleted_at=now()"); await message();
      assert.equal((await entry()).stage_key, 'new');
    });
    await scenario('newest open deal determines scope instead of moving every deal of the lead', async () => {
      await db.exec(`INSERT INTO pipeline_entries(id,organization_id,pipeline_id,lead_id,stage_id,stage_key,stage_changed_at)
        VALUES('${id(63)}','${id(10)}','${id(40)}','${id(1)}','${id(52)}','proposal','2026-10-23T11:00Z')`);
      await message(); assert.equal((await entry()).stage_key, 'new');
      assert.equal((await entry(id(63))).stage_key, 'proposal');
    });
    await scenario('no entry is created for an unpositioned lead', async () => {
      await db.exec(`DELETE FROM pipeline_entries WHERE id='${id(60)}'`); await message();
      assert.equal(await entry(), undefined);
    });
    await scenario('trigger function is not callable by browser roles', async () => {
      const privileges = (await db.query(`SELECT
        has_function_privilege('anon','private.advance_pipeline_on_human_outbound()','EXECUTE') AS anon,
        has_function_privilege('authenticated','private.advance_pipeline_on_human_outbound()','EXECUTE') AS authenticated`)).rows[0];
      assert.deepEqual(privileges, { anon: false, authenticated: false });
    });
    await scenario('browser fallback cannot move a lead outside the user chat scope', async () => {
      await db.exec(`SET LOCAL test.auth_role='authenticated'; SET LOCAL test.user_id='${id(90)}'; SET LOCAL test.can_see_chat='false'`);
      await message(); assert.equal((await entry()).stage_key, 'new');
      await db.exec("SET LOCAL test.can_see_chat='true'");
      await message(); assert.equal((await entry()).stage_key, 'talking');
    });
    await scenario('anonymous context never advances a deal', async () => {
      await db.exec("SET LOCAL test.auth_role='anon'");
      await message(); assert.equal((await entry()).stage_key, 'new');
    });
  } finally { await db.close(); }
});
