import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
test('local storage fixture preserves the real RPC and tenant/deleted visibility', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TYPE lead_visibility_status AS ENUM ('exists','not_found','deleted','permission_denied');
      CREATE TABLE leads(id uuid,organization_id uuid,deleted_at timestamptz,deleted_by uuid);
      CREATE TABLE master_users(user_id uuid,is_active boolean);
      CREATE TABLE team_members(user_id uuid,organization_id uuid,is_active boolean);
      CREATE FUNCTION get_my_gestor_organization_ids() RETURNS SETOF uuid LANGUAGE sql AS $$ SELECT NULL::uuid WHERE false $$;
      INSERT INTO leads VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',NULL,NULL);
      INSERT INTO team_members VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',true);
      SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);`);
    const fixture = read('scripts/ci/lead-storage-fixture.sql');
    await assert.rejects(db.exec(fixture), /explicit local CI guard/);
    await db.exec("SELECT set_config('app.ci_local_fixture','true',false)");
    await db.exec(fixture); await db.exec(fixture);
    await db.exec(read('supabase/migrations/20280111000700_can_view_lead_gestor_de_portfolio.sql'));
    const status = async () => (await db.query("SELECT status FROM can_view_lead('00000000-0000-0000-0000-000000000001')")).rows[0].status;
    assert.equal(await status(), 'exists');
    await db.exec('UPDATE leads SET deleted_at=now()'); assert.equal(await status(), 'deleted');
    await db.exec("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false)");
    assert.equal(await status(), 'permission_denied');
    for (const role of ['anon','authenticated'])
      assert.equal((await db.query(`SELECT has_table_privilege('${role}','private.leads','SELECT') allowed`)).rows[0].allowed,false);
  } finally { await db.close(); }
});
