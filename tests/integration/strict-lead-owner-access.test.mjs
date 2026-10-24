import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Optional path lets an operator use an isolated, pinned PGlite installation.
const require = createRequire(process.env.PGLITE_PACKAGE_ROOT
  ? `${process.env.PGLITE_PACKAGE_ROOT}/package.json` : import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = read('../../supabase/migrations/20271117000101_strict_lead_owner_access.sql');
const rollback = read('../../supabase/migrations/rollback/20271117000101_strict_lead_owner_access.sql');
const readers = read('../../supabase/migrations/20271117000102_strict_lead_owner_readers.sql');
const readersRollback = read('../../supabase/migrations/rollback/20271117000102_strict_lead_owner_readers.sql');
const guard = read('../../supabase/migrations/20271117000103_strict_lead_scope_initplan_guard.sql');
const guardRollback = read('../../supabase/migrations/rollback/20271117000103_strict_lead_scope_initplan_guard.sql');
const scopeGuard = read('../../supabase/migrations/20271117000104_can_see_chat_scope_strict_guard.sql');
const scopeGuardRollback = read('../../supabase/migrations/rollback/20271117000104_can_see_chat_scope_strict_guard.sql');
const id = n => `10000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const orgA = id(1), orgB = id(2);
const admin = id(11), member = id(12), peer = id(13), other = id(14), inactive = id(15), master = id(16);
const tmAdmin = id(21), tmMember = id(22), tmPeer = id(23);
const leadOwn = id(31), leadPeer = id(32), leadFree = id(33), leadB = id(34), leadPipe = id(35);

async function setup(enableMigration = true) {
  const db = new PGlite();
  await db.exec(read('./fixtures/leads-rls-baseline.sql'));
  await db.exec(`
    CREATE SCHEMA private;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('request.jwt.claims',true)::jsonb->>'role'
    $$;
    ALTER TABLE organizations ADD COLUMN feature_flags jsonb DEFAULT '{}'::jsonb;
    ALTER TABLE leads ADD COLUMN notes text, ADD COLUMN responsible_id uuid,
      ADD COLUMN responsible_user_id uuid, ADD COLUMN claimed_by uuid;
    ALTER TABLE pipeline_entries ADD COLUMN deal_id uuid, ADD COLUMN notes text;
    CREATE TABLE deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,source_lead_id uuid);
    GRANT SELECT,INSERT ON deals TO authenticated,service_role;
    CREATE TABLE lead_owners (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
      lead_id uuid, team_member_id uuid, role text);
    ALTER TABLE lead_owners ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON leads,pipeline_entries,lead_owners TO authenticated,service_role;
    CREATE POLICY pipeline_write ON pipeline_entries FOR ALL TO authenticated
      USING (organization_id IN (SELECT get_my_organization_ids()))
      WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));
    CREATE POLICY pipeline_master ON pipeline_entries FOR ALL TO authenticated
      USING (is_master_user()) WITH CHECK (is_master_user());
    CREATE POLICY owner_write ON lead_owners FOR ALL TO authenticated
      USING (organization_id IN (SELECT get_my_organization_ids()))
      WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));
    CREATE VIEW negocio_projetado WITH (security_invoker=true) AS SELECT * FROM pipeline_entries;
    GRANT SELECT ON negocio_projetado TO authenticated,service_role;
    INSERT INTO organizations(id,subscription_status,feature_flags) VALUES
      ('${orgA}','active','{"strict_lead_owner_access":true}'),('${orgB}','active','{}');
    INSERT INTO team_members(id,user_id,organization_id,role,is_active) VALUES
      ('${tmAdmin}','${admin}','${orgA}','admin',true),
      ('${tmMember}','${member}','${orgA}','member',true),
      ('${tmPeer}','${peer}','${orgA}','member',true),
      ('${id(24)}','${other}','${orgB}','member',true),
      ('${id(25)}','${inactive}','${orgA}','member',false),
      ('${id(26)}','${member}','${orgB}','admin',true);
    INSERT INTO master_users(user_id,is_active) VALUES ('${master}',true);
    INSERT INTO feature_permissions(key,is_admin_only,default_value) VALUES
      ('leads.view_all',false,true),('leads.view_unassigned',false,true),('leads.view_subordinates',false,true);
    INSERT INTO leads(id,organization_id,sale_responsible_id,closer_id) VALUES
      ('${leadOwn}','${orgA}','${tmMember}','${tmMember}'),
      ('${leadPeer}','${orgA}','${tmPeer}','${tmPeer}'),
      ('${leadFree}','${orgA}',NULL,NULL),('${leadB}','${orgB}',NULL,NULL),
      ('${leadPipe}','${orgA}',NULL,NULL);
    INSERT INTO pipeline_entries(id,organization_id,lead_id,assigned_to,metadata) VALUES
      ('${id(41)}','${orgA}','${leadOwn}',NULL,'{}'),
      ('${id(42)}','${orgA}','${leadPeer}',NULL,'{}'),
      ('${id(43)}','${orgA}','${leadFree}',NULL,'{}'),
      ('${id(44)}','${orgB}','${leadB}',NULL,'{}'),
      ('${id(45)}','${orgA}','${leadPipe}','${tmMember}','{}');
    CREATE FUNCTION public.fixture_reassign(p_lead uuid,p_member uuid) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
      UPDATE public.leads SET sale_responsible_id=p_member,closer_id=p_member WHERE id=p_lead
    $$;
  `);
  if (enableMigration) await db.exec(migration);
  return db;
}

async function asUser(db, user, sql, role = 'authenticated') {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}; SELECT set_config('request.jwt.claim.sub','${user ?? ''}',true);
    SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: user, role })}',true);`);
  try { return (await db.query(sql)).rows; }
  finally { await db.exec('ROLLBACK'); }
}
const leads = org => `SELECT id FROM leads WHERE organization_id='${org}' ORDER BY id`;
const entries = org => `SELECT lead_id AS id FROM negocio_projetado WHERE organization_id='${org}' ORDER BY lead_id`;
const ids = rows => rows.map(r => r.id);
const denied = error => error.code === '42501';

async function setupReaders(db) {
  await db.exec(read('./fixtures/strict-lead-readers-schema.sql'));
  await db.exec(read('./fixtures/strict-lead-reader-functions.sql'));
  await db.exec(`
    GRANT SELECT ON team_members TO authenticated;
    CREATE POLICY fixture_team ON team_members FOR SELECT TO authenticated USING(true);
    INSERT INTO pipelines VALUES ('${id(60)}','${orgA}','propostas','system');
    CREATE TRIGGER snapshot_responsibles BEFORE INSERT ON pipeline_entries
      FOR EACH ROW EXECUTE FUNCTION pipeline_entries_snapshot_responsibles();
    UPDATE leads SET normalized_phone='5511'||right(id::text,8),phone='5511'||right(id::text,8);
    INSERT INTO next_best_actions(organization_id,lead_id,title,reason,priority)
      SELECT organization_id,id,'Action '||id,'Private reason',10 FROM leads;
    INSERT INTO field_changes(organization_id,entity_type,entity_id,field_name,new_value)
      SELECT organization_id,'lead',id,'notes','private note' FROM leads;
    INSERT INTO whatsapp_messages(organization_id,lead_id,normalized_phone,phone_number,content,search_tsv)
      SELECT organization_id,NULL,normalized_phone,phone,'Contrato reservado',to_tsvector('portuguese','Contrato reservado') FROM leads;
  `);
}

test('actual definer readers, related data, phone-only messages, service and rollback', async () => {
  const db=await setup();
  try {
    await setupReaders(db);
    const uf = `SELECT id FROM get_leads_by_uf('RS',60,'${orgA}') ORDER BY id`;
    const actions = `SELECT lead_id AS id FROM get_next_best_actions(100,'${orgA}') ORDER BY lead_id`;
    const fields = `SELECT * FROM get_lead_field_changes('${leadPeer}',50)`;
    const messages = `SELECT normalized_phone FROM whatsapp_messages WHERE organization_id='${orgA}' ORDER BY normalized_phone`;
    const search = `SELECT phone_number FROM search_messages('${orgA}','contrato',100,0) ORDER BY phone_number`;
    const health = `SELECT get_funnel_health_stage_leads('${orgA}','2000-01-01','2100-01-01','entraram') AS data`;
    const productivity = `SELECT get_productivity_activity_leads('${orgA}','2000-01-01','2100-01-01','novos_leads') AS data`;
    assert.equal((await asUser(db,member,uf)).length,4);
    assert.equal((await asUser(db,member,actions)).length,4);
    assert.equal((await asUser(db,member,fields)).length,1);
    assert.equal((await asUser(db,member,search)).length,4);
    const definitions=`SELECT oid::regprocedure::text AS signature,pg_get_functiondef(oid) AS definition FROM pg_proc WHERE pronamespace='public'::regnamespace ORDER BY oid`;
    const before=(await db.query(definitions)).rows;
    await db.exec(readers);
    // Backend push checks the recipient, regardless of the worker's JWT.
    await db.exec(`INSERT INTO user_roles(user_id,role) VALUES('${member}','admin')`);
    assert.equal((await db.query(`SELECT private.chat_scope_for_recipient('${member}','${orgA}','${leadPeer}',NULL) AS allowed`)).rows[0].allowed,false);
    assert.equal((await db.query(`SELECT private.chat_scope_for_recipient('${member}','${orgA}','${leadOwn}',NULL) AS allowed`)).rows[0].allowed,true);
    await db.exec(`INSERT INTO messaging_channels VALUES('${id(80)}','${orgA}','instagram');
      INSERT INTO lead_social_identities VALUES('${id(81)}','${orgA}','${leadOwn}','instagram','social:own');`);
    assert.equal((await asUser(db,member,`SELECT private.strict_channel_visible('${orgA}',NULL,'${id(80)}','social:own',NULL) AS allowed`))[0].allowed,true);
    assert.equal((await asUser(db,member,`SELECT private.strict_channel_visible('${orgA}',NULL,'${id(80)}','social:other',NULL) AS allowed`))[0].allowed,false);
    assert.equal((await asUser(db,member,`SELECT private.strict_channel_visible('${orgA}',NULL,NULL,'551100000031',NULL) AS allowed`))[0].allowed,true);
    assert.deepEqual(ids(await asUser(db,member,uf)),[leadOwn,leadPipe]);
    assert.deepEqual(ids(await asUser(db,member,actions)),[leadOwn,leadPipe]);
    assert.deepEqual(await asUser(db,member,fields),[]);
    assert.equal((await asUser(db,member,messages)).length,2);
    assert.equal((await asUser(db,member,search)).length,2);
    assert.equal((await asUser(db,member,health))[0].data.length,2);
    assert.equal((await asUser(db,member,productivity))[0].data.length,2);
    for (const sql of [uf,actions,search]) assert.equal((await asUser(db,admin,sql)).length,4);
    assert.equal((await asUser(db,admin,health))[0].data.length,4);
    assert.equal((await asUser(db,null,health,'service_role'))[0].data.length,4);
    assert.equal((await asUser(db,other,`SELECT * FROM get_leads_by_uf('RS',60,'${orgB}')`)).length,1);
    assert.deepEqual(await asUser(db,other,uf),[]);
    await assert.rejects(asUser(db,member,'SELECT * FROM private.leads'),denied);
    await db.exec(readersRollback);
    assert.deepEqual((await db.query(definitions)).rows,before,'rollback restores every original RPC exactly');
    assert.equal((await asUser(db,member,search)).length,4);
  } finally { await db.close(); }
});

// Same rows, cheaper plan: 20271117000103 hoists the strict-org check out of the
// per-row SECURITY DEFINER calls. Every read path must return exactly what 102 returned.
test('initplan and chat-scope guards keep every scoped read identical and roll back to 102', async () => {
  const db=await setup();
  try {
    await setupReaders(db);
    await db.exec(`
      CREATE TABLE lead_tags(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,tag_id uuid);
      ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_tags ON lead_tags FOR SELECT TO authenticated USING(true);
      GRANT SELECT ON lead_tags,channel_messages TO authenticated;
      ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_channel ON channel_messages FOR SELECT TO authenticated USING(true);
      INSERT INTO lead_tags(lead_id) SELECT id FROM leads UNION ALL SELECT NULL;
      INSERT INTO channel_messages(id,organization_id,lead_id,phone_number)
        SELECT gen_random_uuid(),organization_id,id,normalized_phone FROM leads;
    `);
    await db.exec(readers);
    const asCaller = async (user, sql) => {
      await db.exec(`BEGIN; SELECT set_config('request.jwt.claim.sub','${user}',true);
        SELECT set_config('request.jwt.claims','${JSON.stringify({ sub: user, role: 'authenticated' })}',true);`);
      try { return (await db.query(sql)).rows; } finally { await db.exec('ROLLBACK'); }
    };
    const reads = {
      uf: `SELECT id FROM get_leads_by_uf('RS',60,'${orgA}') ORDER BY id`,
      search: `SELECT phone_number FROM search_messages('${orgA}','contrato',100,0) ORDER BY phone_number`,
      rlsMessages: `SELECT normalized_phone FROM whatsapp_messages ORDER BY normalized_phone`,
      rlsTags: `SELECT lead_id FROM lead_tags ORDER BY lead_id NULLS LAST`,
      rlsChannel: `SELECT lead_id FROM channel_messages ORDER BY lead_id`,
      chatScope: `SELECT l.id, public.can_see_chat_scope(l.organization_id,l.id,l.normalized_phone) AS by_lead,
        public.can_see_chat_scope(l.organization_id,NULL,l.normalized_phone) AS by_phone,
        public.can_see_chat_scope(NULL,NULL,NULL) AS no_org FROM leads l ORDER BY l.id`,
    };
    const views = {
      messages: `SELECT normalized_phone FROM private.whatsapp_messages ORDER BY normalized_phone`,
      tags: `SELECT lead_id FROM private.lead_tags ORDER BY lead_id NULLS LAST`,
      channel: `SELECT lead_id FROM private.channel_messages ORDER BY lead_id`,
    };
    // A denial is an outcome too: record the SQLSTATE so it is compared like rows.
    const outcome = p => p.catch(e => ({ error: e.code }));
    const snapshot = async () => {
      const out = {};
      for (const user of [member, peer, admin, other]) {
        for (const [k, sql] of Object.entries(reads)) out[`${user}:${k}`] = await outcome(asUser(db, user, sql));
        for (const [k, sql] of Object.entries(views)) out[`${user}:view:${k}`] = await outcome(asCaller(user, sql));
      }
      return out;
    };
    const shape = `SELECT 'view:'||viewname AS k, definition AS v FROM pg_views WHERE schemaname='private'
      UNION ALL SELECT 'policy:'||tablename, qual FROM pg_policies WHERE policyname='strict_owner_related_select'
      UNION ALL SELECT 'manifest:'||relation_name, predicate FROM private.strict_lead_scope_manifest ORDER BY 1`;
    const before = await snapshot();
    const shapeBefore = (await db.query(shape)).rows;
    assert.deepEqual(ids(before[`${member}:uf`]), [leadOwn, leadPipe], 'control: 102 is enforcing');
    const memberTags = before[`${member}:rlsTags`].map(r => r.lead_id);
    assert.ok(memberTags.includes(leadOwn) && !memberTags.includes(leadPeer) && !memberTags.includes(leadFree),
      'control: lead_ref policy hides peer and unassigned leads');

    await db.exec(guard);
    assert.deepEqual(await snapshot(), before, 'same rows for every user on every path');
    const unguarded = (await db.query(`SELECT relation_name FROM private.strict_lead_scope_manifest
      WHERE predicate ~ '^private\\.strict_(phone|channel|lead_ref)_visible\\('`)).rows;
    assert.deepEqual(unguarded, [], 'no per-row strict call without the statement-level guard');
    for (const rel of ['whatsapp_messages', 'channel_messages', 'lead_tags']) {
      const { definition } = (await db.query(`SELECT definition FROM pg_views WHERE schemaname='private' AND viewname='${rel}'`)).rows[0];
      assert.match(definition, /strict_lead_member_orgs/, `${rel} evaluates the org list once`);
    }
    await db.exec(guard);
    assert.deepEqual(await snapshot(), before, 'idempotent');
    await db.exec(scopeGuard);
    assert.deepEqual(await snapshot(), before, 'can_see_chat_scope flag guard returns the same answers');

    await db.exec(scopeGuardRollback);
    await db.exec(guardRollback);
    assert.deepEqual((await db.query(shape)).rows, shapeBefore, 'rollback restores the 102 predicates exactly');
    await db.exec(readersRollback);
  } finally { await db.close(); }
});

test('real proposal snapshot permits inherited owners, but rejects self-claim and new assignees', async () => {
  const db=await setup();
  try {
    await setupReaders(db);
    const insert=(lead,assigned,metadata='{}') => `INSERT INTO pipeline_entries(organization_id,lead_id,pipeline_id,assigned_to,metadata)
      VALUES('${orgA}','${lead}','${id(60)}',${assigned ? `'${assigned}'` : 'NULL'},'${metadata}') RETURNING metadata`;
    const result=await asUser(db,member,insert(leadOwn,tmMember));
    assert.equal(result[0].metadata.sale_responsible_id,tmMember);
    assert.equal((await asUser(db,member,insert(leadPipe,tmMember))).length,1);
    for(const sql of [insert(leadFree,tmMember),insert(leadOwn,tmPeer),insert(leadOwn,tmMember,JSON.stringify({closer_id:tmPeer}))])
      await assert.rejects(asUser(db,member,sql),denied);
    await db.exec(`INSERT INTO deals VALUES('${id(70)}','${orgA}','${leadOwn}')`);
    assert.equal((await asUser(db,member,`UPDATE pipeline_entries SET deal_id='${id(70)}' WHERE id='${id(41)}' RETURNING id`)).length,1);
  } finally { await db.close(); }
});

test('baseline reproduces the exposure; opt-in restricts actual rows and projections', async () => {
  const db = await setup(false);
  try {
    assert.equal((await asUser(db,member,leads(orgA))).length,4);
    assert.equal((await asUser(db,member,entries(orgA))).length,4);
    await db.exec(migration);
    assert.deepEqual(ids(await asUser(db,member,leads(orgA))),[leadOwn,leadPipe]);
    assert.deepEqual(ids(await asUser(db,member,entries(orgA))),[leadOwn,leadPipe]);
    assert.deepEqual(await asUser(db,member,`SELECT id FROM leads WHERE id='${leadPeer}'`),[]);
    assert.deepEqual(await asUser(db,member,`SELECT id FROM pipeline_entries WHERE id='${id(42)}'`),[]);
    await db.exec(rollback);
    assert.equal((await asUser(db,member,leads(orgA))).length,4);
    assert.equal((await asUser(db,member,entries(orgA))).length,4);
  } finally { await db.close(); }
});

test('admins, master, unconfigured org, no-session and inactive membership', async () => {
  const db = await setup();
  try {
    assert.equal((await asUser(db,admin,leads(orgA))).length,4);
    assert.equal((await asUser(db,master,leads(orgA))).length,4);
    assert.equal((await asUser(db,master,entries(orgA))).length,4);
    assert.deepEqual(ids(await asUser(db,other,leads(orgB))),[leadB]);
    assert.deepEqual(ids(await asUser(db,other,entries(orgB))),[leadB]);
    assert.deepEqual(await asUser(db,other,leads(orgA)),[]);
    assert.deepEqual(await asUser(db,inactive,leads(orgA)),[]);
    assert.deepEqual(await asUser(db,null,leads(orgA)),[]);
    assert.equal((await asUser(db,null,leads(orgA),'service_role')).length,4);
  } finally { await db.close(); }
});

test('global admin role and member overrides cannot bypass ownership in opted-in org', async () => {
  const db = await setup();
  try {
    await db.exec(`INSERT INTO user_roles(user_id,role) VALUES('${peer}','admin');
      INSERT INTO member_feature_permissions(team_member_id,organization_id,feature_key,enabled)
      VALUES('${tmPeer}','${orgA}','leads.view_all',true);`);
    assert.deepEqual(ids(await asUser(db,peer,leads(orgA))),[leadPeer]);
    assert.deepEqual(ids(await asUser(db,peer,entries(orgA))),[leadPeer]);
  } finally { await db.close(); }
});

test('members can edit their records, but cannot reassign, claim, relink, or write owners', async () => {
  const db = await setup();
  try {
    assert.equal((await asUser(db,member,`UPDATE leads SET notes='ok' WHERE id='${leadOwn}' RETURNING id`)).length,1);
    assert.equal((await asUser(db,member,`UPDATE pipeline_entries SET notes='ok' WHERE id='${id(41)}' RETURNING id`)).length,1);
    for (const sql of [
      `UPDATE leads SET sale_responsible_id='${tmPeer}' WHERE id='${leadOwn}'`,
      `UPDATE leads SET organization_id='${orgB}' WHERE id='${leadOwn}'`,
      `UPDATE leads SET claimed_by='${member}' WHERE id='${leadOwn}'`,
      `UPDATE pipeline_entries SET assigned_to='${tmPeer}' WHERE id='${id(41)}'`,
      `UPDATE pipeline_entries SET metadata='{"sale_responsible_id":"${tmPeer}"}' WHERE id='${id(41)}'`,
      `UPDATE pipeline_entries SET lead_id='${leadFree}' WHERE id='${id(41)}'`,
      `INSERT INTO lead_owners(organization_id,lead_id,team_member_id,role) VALUES('${orgA}','${leadOwn}','${tmPeer}','co')`,
      `INSERT INTO leads(organization_id,sale_responsible_id) VALUES('${orgA}','${tmMember}')`,
      `SELECT fixture_reassign('${leadPeer}','${tmMember}')`,
    ]) await assert.rejects(asUser(db,member,sql),denied,sql);
    assert.deepEqual(await asUser(db,member,`UPDATE pipeline_entries SET notes='no' WHERE id='${id(42)}' RETURNING id`),[]);
  } finally { await db.close(); }
});

test('admin assignment grants access and removal revokes it on the next request', async () => {
  const db = await setup();
  try {
    assert.deepEqual(await asUser(db,peer,`SELECT id FROM leads WHERE id='${leadFree}'`),[]);
    // Commit only within this isolated in-memory database.
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${admin}',false);
      SELECT set_config('request.jwt.claims','{"sub":"${admin}","role":"authenticated"}',false);
      UPDATE leads SET sale_responsible_id='${tmPeer}',closer_id='${tmPeer}' WHERE id='${leadFree}'; RESET ROLE;`);
    assert.deepEqual(ids(await asUser(db,peer,`SELECT id FROM leads WHERE id='${leadFree}'`)),[leadFree]);
    assert.equal((await asUser(db,peer,`SELECT id FROM pipeline_entries WHERE lead_id='${leadFree}'`)).length,1);
    await db.exec(`UPDATE leads SET sale_responsible_id=NULL,closer_id=NULL WHERE id='${leadFree}';`);
    assert.deepEqual(await asUser(db,peer,`SELECT id FROM leads WHERE id='${leadFree}'`),[]);
    assert.deepEqual(await asUser(db,peer,`SELECT id FROM pipeline_entries WHERE lead_id='${leadFree}'`),[]);
  } finally { await db.close(); }
});
