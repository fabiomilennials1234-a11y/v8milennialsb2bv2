import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20271108000000_saved_views_owner_multi_org.sql', import.meta.url), 'utf8');
const userA = '00000000-0000-0000-0000-000000000001';
const userB = '00000000-0000-0000-0000-000000000002';
const orgA = '00000000-0000-0000-0000-000000000011';
const orgB = '00000000-0000-0000-0000-000000000012';
const orgC = '00000000-0000-0000-0000-000000000013';

test('saved_views: CRUD multi-org sem ceder propriedade ou atravessar vínculo', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE anon NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
      CREATE TABLE memberships(user_id uuid, organization_id uuid, active boolean);
      INSERT INTO memberships VALUES
        ('${userA}','${orgA}',true),('${userA}','${orgB}',true),
        ('${userB}','${orgB}',true),('${userB}','${orgC}',false);
      CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS
        $$ SELECT organization_id FROM memberships WHERE user_id=auth.uid() AND active $$;
      CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT current_setting('test.master',true)='true' $$;
      CREATE TABLE saved_views(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
        owner_id uuid NOT NULL, name text NOT NULL, entity_type text DEFAULT 'leads',
        is_shared boolean NOT NULL DEFAULT false, is_system boolean NOT NULL DEFAULT false
      );
      ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
      CREATE POLICY master_select_all_saved_views ON saved_views FOR SELECT USING ((SELECT is_master_user()));
      GRANT USAGE ON SCHEMA auth TO authenticated,anon;
      GRANT SELECT ON memberships TO authenticated,anon;
      GRANT SELECT,INSERT,UPDATE,DELETE ON saved_views TO authenticated,anon;
    `);
    await db.exec(migration);
    await db.exec(`SET ROLE authenticated; SET test.uid='${userA}'; SET test.master='false';`);
    const insert = (org, name, owner = undefined, shared = false, system = false) => owner === undefined
      ? db.query('INSERT INTO saved_views(organization_id,name,is_shared,is_system) VALUES ($1,$2,$3,$4) RETURNING *', [org,name,shared,system])
      : db.query('INSERT INTO saved_views(organization_id,name,owner_id,is_shared,is_system) VALUES ($1,$2,$3,$4,$5) RETURNING *', [org,name,owner,shared,system]);
    const primary = (await insert(orgA,'primary')).rows[0];
    const secondary = (await insert(orgB,'secondary')).rows[0];
    const shared = (await insert(orgB,'shared',userA,true)).rows[0];
    const system = (await insert(orgB,'system',userA,false,true)).rows[0];
    assert.equal(secondary.owner_id,userA, 'o default também cobre frontend clássico antigo');
    assert.equal((await db.query('SELECT * FROM saved_views WHERE organization_id=$1',[orgB])).rows.length,3);
    await assert.rejects(insert(orgC,'foreign'), /row-level security/);
    await assert.rejects(insert(orgB,'forged-owner',userB), /row-level security/);
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['changed',secondary.id])).rows.length,1);
    await assert.rejects(db.query('UPDATE saved_views SET organization_id=$1 WHERE id=$2',[orgC,secondary.id]), /row-level security/);
    await assert.rejects(db.query('UPDATE saved_views SET owner_id=$1 WHERE id=$2',[userB,secondary.id]), /row-level security/);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[system.id])).rows.length,0);

    await db.exec(`SET test.uid='${userB}'`);
    const visible = (await db.query('SELECT id FROM saved_views')).rows.map(row=>row.id);
    assert.deepEqual(visible,[shared.id], 'mesma org não torna view privada visível');
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['stolen',shared.id])).rows.length,0);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[shared.id])).rows.length,0);
    await assert.rejects(insert(orgC,'inactive-membership'), /row-level security/);

    await db.exec(`SET test.uid='${userA}'`);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[secondary.id])).rows.length,1);
    await db.exec(`RESET ROLE; SET ROLE anon; SET test.uid='';`);
    assert.equal((await db.query('SELECT * FROM saved_views')).rows.length,0);
    await assert.rejects(insert(orgA,'anon',userA), /row-level security/);

    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${userB}'; SET test.master='true';`);
    assert.ok((await db.query('SELECT id FROM saved_views WHERE id=$1',[primary.id])).rows.length===1, 'master preserva leitura de suporte');
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['master-write',primary.id])).rows.length,0);
  } finally { await db.close(); }
});
