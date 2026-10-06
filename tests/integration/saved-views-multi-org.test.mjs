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

test('saved_views: contexto por request preserva clientes antigos, CRUD multi-org e autorização', async () => {
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
      CREATE FUNCTION public.get_user_organization_id() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT CASE auth.uid() WHEN '${userA}'::uuid THEN '${orgA}'::uuid
          WHEN '${userB}'::uuid THEN '${orgB}'::uuid ELSE NULL END $$;
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
      INSERT INTO saved_views(organization_id,owner_id,name,is_shared)
        VALUES ('${orgC}','${userA}','unlinked-owner',true);
    `);
    const aclBefore = (await db.query("SELECT relacl::text FROM pg_class WHERE oid='saved_views'::regclass")).rows;
    const masterBefore = (await db.query("SELECT * FROM pg_policies WHERE tablename='saved_views' AND policyname='master_select_all_saved_views'")).rows;
    await db.exec(migration);
    assert.deepEqual((await db.query("SELECT relacl::text FROM pg_class WHERE oid='saved_views'::regclass")).rows, aclBefore);
    assert.deepEqual((await db.query("SELECT * FROM pg_policies WHERE tablename='saved_views' AND policyname='master_select_all_saved_views'")).rows, masterBefore);
    await db.exec(`SET ROLE authenticated; SET test.uid='${userA}'; SET test.master='false';`);
    const header = value => db.query("SELECT set_config('request.headers',$1,false)", [JSON.stringify(value === undefined ? {} : { 'x-torque-saved-views-org': value })]);
    const insert = (org, name, owner = undefined, shared = false, system = false) => owner === undefined
      ? db.query('INSERT INTO saved_views(organization_id,name,is_shared,is_system) VALUES ($1,$2,$3,$4) RETURNING *', [org,name,shared,system])
      : db.query('INSERT INTO saved_views(organization_id,name,owner_id,is_shared,is_system) VALUES ($1,$2,$3,$4,$5) RETURNING *', [org,name,owner,shared,system]);
    const primary = (await insert(orgA,'primary')).rows[0];
    assert.equal(primary.owner_id,userA, 'cliente antigo sem header recebe o default do dono');
    await assert.rejects(insert(orgB,'old-client-secondary'), /row-level security/);
    await header(orgB);
    const secondary = (await insert(orgB,'secondary')).rows[0];
    const shared = (await insert(orgB,'shared',userA,true)).rows[0];
    const system = (await insert(orgB,'system',userA,false,true)).rows[0];
    assert.equal(secondary.owner_id,userA);
    assert.equal((await db.query('SELECT * FROM saved_views WHERE organization_id=$1',[orgB])).rows.length,3);

    // Sem header (ou vazio), um GET antigo sem filtro não pode reunir as duas orgs.
    for (const value of [undefined, '']) {
      await header(value);
      assert.deepEqual((await db.query('SELECT id FROM saved_views')).rows.map(row=>row.id),[primary.id]);
      assert.equal((await db.query('SELECT id FROM saved_views WHERE organization_id=$1',[orgB])).rows.length,0);
      await assert.rejects(insert(orgB,'legacy-mismatch'), /row-level security/);
      assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['legacy-mismatch',secondary.id])).rows.length,0);
      assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[secondary.id])).rows.length,0);
    }
    await db.query("SELECT set_config('request.headers','',false)");
    assert.deepEqual((await db.query('SELECT id FROM saved_views')).rows.map(row=>row.id),[primary.id], 'GUC vazia também usa fallback antes do cast JSON');
    const legacy = (await insert(orgA,'legacy-crud')).rows[0];
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['legacy-updated',legacy.id])).rows.length,1);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[legacy.id])).rows.length,1);
    await header(orgA);
    const modern = (await insert(orgA,'new-primary-crud')).rows[0];
    assert.equal((await db.query('SELECT id FROM saved_views WHERE id=$1',[modern.id])).rows.length,1);
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['new-updated',modern.id])).rows.length,1);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[modern.id])).rows.length,1);

    // Header escolhe contexto; filtro/corpo divergente não atravessa para outra org vinculada.
    await header(orgB);
    assert.equal((await db.query('SELECT id FROM saved_views WHERE organization_id=$1',[orgA])).rows.length,0);
    await assert.rejects(insert(orgA,'header-mismatch'), /row-level security/);
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['header-mismatch',primary.id])).rows.length,0);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[primary.id])).rows.length,0);
    await assert.rejects(db.query('UPDATE saved_views SET organization_id=$1 WHERE id=$2',[orgA,secondary.id]), /row-level security/);
    await assert.rejects(insert(orgC,'foreign'), /row-level security/);
    await assert.rejects(insert(orgB,'forged-owner',userB), /row-level security/);
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['changed',secondary.id])).rows.length,1);
    await assert.rejects(db.query('UPDATE saved_views SET organization_id=$1 WHERE id=$2',[orgC,secondary.id]), /row-level security/);
    await assert.rejects(db.query('UPDATE saved_views SET owner_id=$1 WHERE id=$2',[userB,secondary.id]), /row-level security/);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[system.id])).rows.length,0);

    await header(orgC);
    assert.equal((await db.query('SELECT id FROM saved_views')).rows.length,0, 'header forjado não autoriza nem linha própria compartilhada sem vínculo');
    await assert.rejects(insert(orgC,'forged-context'), /row-level security/);
    await header('not-a-uuid');
    await assert.rejects(db.query('SELECT id FROM saved_views'), /invalid input syntax for type uuid/);
    await assert.rejects(insert(orgA,'invalid-context'), /invalid input syntax for type uuid/);
    await header(orgB);

    await db.exec(`SET test.uid='${userB}'`);
    const visible = (await db.query('SELECT id FROM saved_views')).rows.map(row=>row.id);
    assert.deepEqual(visible,[shared.id], 'mesma org não torna view privada visível');
    assert.equal((await db.query('UPDATE saved_views SET name=$1 WHERE id=$2 RETURNING id',['stolen',shared.id])).rows.length,0);
    assert.equal((await db.query('DELETE FROM saved_views WHERE id=$1 RETURNING id',[shared.id])).rows.length,0);
    await assert.rejects(insert(orgC,'inactive-membership'), /row-level security/);
    await header(orgC);
    assert.equal((await db.query('SELECT id FROM saved_views')).rows.length,0);
    await assert.rejects(insert(orgC,'inactive-membership-header'), /row-level security/);
    await db.exec("SET test.uid='00000000-0000-0000-0000-000000000003'");
    await header(orgB);
    assert.equal((await db.query('SELECT id FROM saved_views')).rows.length,0);
    await assert.rejects(insert(orgB,'outsider-forged-header'), /row-level security/);

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
