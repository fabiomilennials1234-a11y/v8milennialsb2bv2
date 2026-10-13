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
