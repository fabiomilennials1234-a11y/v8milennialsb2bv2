import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const migration = read('../../supabase/migrations/20271214000001_whatsapp_summary_owner_isolation.sql');

test('summary RLS intersects lead ownership, instance access and tenant access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
      CREATE TABLE organizations(id uuid PRIMARY KEY,chat_restrict_to_owner boolean,feature_flags jsonb DEFAULT '{}');
      CREATE TABLE team_members(id uuid PRIMARY KEY,user_id uuid,organization_id uuid,is_active boolean,role text);
      CREATE TABLE user_roles(user_id uuid,role text);
      CREATE TABLE member_feature_permissions(team_member_id uuid,feature_key text,enabled boolean);
      CREATE TABLE leads(id uuid PRIMARY KEY,organization_id uuid,normalized_phone text,deleted_at timestamptz,
        pre_sale_responsible_id uuid,sale_responsible_id uuid,sdr_id uuid,closer_id uuid);
      CREATE TABLE lead_owners(lead_id uuid,team_member_id uuid,role text);
      CREATE TABLE whatsapp_instance_allowed_members(whatsapp_instance_id uuid,team_member_id uuid);
      CREATE TABLE whatsapp_conversation_summary(organization_id uuid,instance_id uuid,normalized_phone text,lead_id uuid,last_message text);
      CREATE FUNCTION public.is_master_user(p_user_id uuid DEFAULT auth.uid()) RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT p_user_id='${id(99)}'::uuid $$;
      CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS
        $$ SELECT organization_id FROM public.team_members WHERE user_id=auth.uid() AND is_active $$;
      -- The strict-owner feature has its own existing restrictive policy.
      -- These fail-closed functions ensure that the captured predicate cannot
      -- accidentally grant access through that branch in this fixture.
      CREATE FUNCTION private.strict_phone_visible(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION private.strict_lead_owned_by(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      ALTER TABLE whatsapp_conversation_summary ENABLE ROW LEVEL SECURITY;
      CREATE POLICY existing_org_read ON whatsapp_conversation_summary FOR SELECT TO authenticated
        USING (organization_id IN (SELECT get_my_organization_ids()) OR is_master_user());
      CREATE POLICY existing_instance_read ON whatsapp_conversation_summary AS RESTRICTIVE FOR SELECT TO authenticated USING (
        is_master_user() OR EXISTS(SELECT 1 FROM team_members tm WHERE tm.user_id=auth.uid() AND tm.is_active AND tm.organization_id=whatsapp_conversation_summary.organization_id
          AND (tm.role='admin' OR EXISTS(SELECT 1 FROM whatsapp_instance_allowed_members a WHERE a.team_member_id=tm.id AND a.whatsapp_instance_id=whatsapp_conversation_summary.instance_id)))
      );
      GRANT USAGE ON SCHEMA auth,private TO authenticated,anon,service_role;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
      INSERT INTO organizations(id,chat_restrict_to_owner) VALUES('${id(100)}',true),('${id(200)}',true);
      INSERT INTO team_members VALUES
        ('${id(1)}','${id(11)}','${id(100)}',true,'member'),
        ('${id(2)}','${id(12)}','${id(100)}',true,'member'),
        ('${id(3)}','${id(13)}','${id(100)}',true,'admin'),
        ('${id(4)}','${id(14)}','${id(200)}',true,'member');
      INSERT INTO whatsapp_instance_allowed_members VALUES('${id(21)}','${id(1)}'),('${id(21)}','${id(2)}'),('${id(24)}','${id(4)}');
      INSERT INTO leads(id,organization_id,normalized_phone,sale_responsible_id) VALUES
        ('${id(31)}','${id(100)}','own','${id(1)}'),
        ('${id(32)}','${id(100)}','other','${id(2)}'),
        ('${id(33)}','${id(100)}','unassigned',NULL),
        ('${id(34)}','${id(200)}','foreign','${id(4)}');
      INSERT INTO whatsapp_conversation_summary VALUES
        ('${id(100)}','${id(21)}','own','${id(31)}','own preview'),
        ('${id(100)}','${id(21)}','other','${id(32)}','private preview'),
        ('${id(100)}','${id(21)}','unassigned','${id(33)}','unassigned preview'),
        ('${id(100)}','${id(21)}','orphan',NULL,'orphan preview'),
        ('${id(100)}','${id(22)}','own','${id(31)}','unlinked instance preview'),
        ('${id(200)}','${id(24)}','foreign','${id(34)}','foreign preview');
    `);
    await db.exec(read('../fixtures/whatsapp-summary-owner-functions.sql'));
    if (process.env.REPRODUCE_WITHOUT_OWNER_POLICY !== '1') await db.exec(migration);
    const asUser = async user => {
      await db.exec(`SET ROLE authenticated; SET test.user_id='${id(user)}'`);
      try {
        return (await db.query('SELECT normalized_phone FROM whatsapp_conversation_summary ORDER BY normalized_phone')).rows.map(r => r.normalized_phone);
      } finally { await db.exec('RESET ROLE'); }
    };
    assert.deepEqual(await asUser(11), ['own'], 'member must not receive another owner, unassigned or orphan preview');
    assert.deepEqual(await asUser(12), ['other']);
    assert.deepEqual(await asUser(14), ['foreign'], 'cross-tenant data stays hidden');
    assert.equal((await asUser(13)).length, 5, 'org admin retains org-wide access');
    assert.equal((await asUser(99)).length, 6, 'master retains access');

    await db.exec(`INSERT INTO lead_owners VALUES('${id(32)}','${id(1)}','co')`);
    assert.deepEqual(await asUser(11), ['other','own'], 'co-owner follows the shared message predicate');
    await db.exec('DELETE FROM lead_owners');
    await db.exec(`UPDATE leads SET sale_responsible_id='${id(2)}' WHERE id='${id(31)}'`);
    assert.deepEqual(await asUser(11), [], 'reassignment revokes old owner immediately');
    assert.deepEqual(await asUser(12), ['other','own']);
    await db.exec(`UPDATE leads SET sale_responsible_id='${id(1)}' WHERE id='${id(31)}'`);
    await db.exec(`DELETE FROM whatsapp_instance_allowed_members WHERE team_member_id='${id(1)}'`);
    assert.deepEqual(await asUser(11), [], 'lead ownership never bypasses the instance restriction');
    await db.exec(`INSERT INTO whatsapp_instance_allowed_members VALUES('${id(21)}','${id(1)}')`);
    await db.exec(`UPDATE team_members SET is_active=false WHERE id='${id(1)}'`);
    assert.deepEqual(await asUser(11), [], 'inactive member has no access');
    await db.exec(`UPDATE team_members SET is_active=true WHERE id='${id(1)}'`);
    await db.exec(`UPDATE organizations SET chat_restrict_to_owner=false WHERE id='${id(100)}'`);
    assert.deepEqual(await asUser(11), ['orphan','other','own','unassigned'], 'orgs without owner isolation retain existing behavior');

    await db.exec('SET ROLE anon');
    assert.equal((await db.query('SELECT * FROM whatsapp_conversation_summary')).rows.length, 0);
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal((await db.query('SELECT * FROM whatsapp_conversation_summary')).rows.length, 6);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});
