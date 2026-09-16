import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sqlFile = (name) =>
  readFileSync(
    new URL(`../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  );
let db;
const asUser = async (user, role = "authenticated") => {
  await db.exec(
    `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${user ? id(user) : ""}', false); SET ROLE ${role};`,
  );
};
const overview = async () =>
  (await db.query("SELECT * FROM public.gestor_organization_overview()")).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE organizations(id uuid PRIMARY KEY, name text, slug text, subscription_status text DEFAULT 'active', billing_override boolean DEFAULT false);
    CREATE TABLE gestores(id uuid PRIMARY KEY, user_id uuid UNIQUE, is_active boolean);
    CREATE TABLE gestor_organizations(gestor_id uuid, organization_id uuid, PRIMARY KEY(gestor_id, organization_id));
    CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid, created_at timestamptz, deleted_at timestamptz, is_shadow boolean);
    CREATE TABLE sale_events(id uuid PRIMARY KEY, organization_id uuid, event_type text, sold_at timestamptz, reversed_event_id uuid);
    CREATE TABLE team_members(id uuid PRIMARY KEY, user_id uuid, organization_id uuid, name text, is_active boolean);
    CREATE TABLE user_presence(user_id uuid, organization_id uuid, last_seen_at timestamptz, PRIMARY KEY(user_id, organization_id));
    CREATE TABLE master_users(user_id uuid, is_active boolean, permissions jsonb);
    ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_presence ON user_presence TO authenticated USING(user_id=auth.uid());
    GRANT SELECT ON user_presence TO authenticated;
  `);
  // Usa o predicado real de bloqueio; não duplica sua regra no fixture.
  const blockingMigration = sqlFile("20270826000000_org_suspensa_corta_acesso.sql");
  const helperStart = blockingMigration.indexOf("CREATE OR REPLACE FUNCTION public.org_access_blocked(");
  const helperEnd = blockingMigration.indexOf("$function$;", helperStart) + "$function$;".length;
  await db.exec(blockingMigration.slice(helperStart, helperEnd));
  await db.exec(sqlFile("20260916181815_gestor_organization_overview.sql"));
  // Executa o gate master real: o novo hub não deve liberar sua RPC.
  await db.exec(sqlFile("20270807120000_master_org_user_activity.sql"));
});

after(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec(`BEGIN;
    INSERT INTO organizations(id,name,slug) VALUES ('${id(10)}','Alpha','alpha'),('${id(20)}','Beta','beta'),('${id(30)}','Sem movimento','vazia');
    INSERT INTO gestores VALUES ('${id(101)}','${id(1)}',true),('${id(102)}','${id(2)}',true),('${id(103)}','${id(3)}',false),('${id(104)}','${id(4)}',true);
    INSERT INTO gestor_organizations VALUES ('${id(101)}','${id(10)}'),('${id(101)}','${id(30)}'),('${id(102)}','${id(20)}'),('${id(103)}','${id(10)}');
    INSERT INTO master_users VALUES ('${id(99)}',true,'{"all":true}');
    INSERT INTO leads(id,organization_id,created_at) VALUES
      ('${id(201)}','${id(10)}',now()),('${id(202)}','${id(10)}',now()-interval '168 hours'),
      ('${id(203)}','${id(10)}',now()-interval '168 hours 1 second'),
      ('${id(204)}','${id(10)}',now()+interval '1 second'),('${id(205)}','${id(20)}',now());
    INSERT INTO leads VALUES ('${id(206)}','${id(10)}',now(),now(),false),('${id(207)}','${id(10)}',now(),NULL,true);
    INSERT INTO sale_events VALUES
      ('${id(301)}','${id(10)}','sale',now(),NULL),
      ('${id(302)}','${id(10)}','sale',now()-interval '168 hours',NULL),
      ('${id(303)}','${id(10)}','sale',now()-interval '169 hours',NULL),
      ('${id(304)}','${id(10)}','sale',now()+interval '1 second',NULL),
      ('${id(305)}','${id(10)}','sale',now()-interval '1 day',NULL),
      ('${id(306)}','${id(10)}','sale_reversed',now(),'${id(305)}'),
      ('${id(307)}','${id(10)}','sale_lost',now(),NULL),
      ('${id(308)}','${id(20)}','sale',now(),NULL);
    INSERT INTO team_members VALUES
      ('${id(401)}','${id(11)}','${id(10)}','Ana',true),
      ('${id(402)}','${id(11)}','${id(10)}','Ana',true),
      ('${id(403)}','${id(12)}','${id(10)}','Inativo',false),
      ('${id(404)}','${id(13)}','${id(10)}','Offline',true),
      ('${id(405)}','${id(14)}','${id(20)}','Outra org',true),
      ('${id(406)}','${id(15)}','${id(10)}','Limite',true);
    INSERT INTO user_presence VALUES
      ('${id(11)}','${id(10)}',now()),('${id(12)}','${id(10)}',now()),
      ('${id(13)}','${id(10)}',now()-interval '121 seconds'),
      ('${id(14)}','${id(20)}',now()),('${id(14)}','${id(10)}',now()),
      ('${id(15)}','${id(10)}',now()-interval '2 minutes');
  `);
});
afterEach(async () => {
  await db.exec("ROLLBACK; RESET ROLE;");
});

test("retorna todos e somente os vínculos do gestor, incluindo organizações vazias", async () => {
  await asUser(1);
  const rows = await overview();
  assert.deepEqual(
    rows.map((r) => r.organization_id),
    [id(10), id(30)],
  );
  assert.equal(Number(rows[1].leads_last_7_days), 0);
  assert.equal(Number(rows[1].sales_last_7_days), 0);
  assert.deepEqual(rows[1].online_users, []);
  await asUser(2);
  assert.deepEqual(
    (await overview()).map((r) => r.organization_id),
    [id(20)],
  );
});

test("conta 168 horas por criação/venda; ignora futuro, leads excluídos/sombra e estornos", async () => {
  await asUser(1);
  const [row] = await overview();
  assert.equal(Number(row.leads_last_7_days), 2);
  assert.equal(Number(row.sales_last_7_days), 2);
});

for (const status of ["suspended", "cancelled", "expired"]) {
  test(`org ${status} permanece listada sem expor indicadores ou presença`, async () => {
    await db.exec(`UPDATE organizations SET subscription_status='${status}' WHERE id='${id(10)}'`);
    await asUser(1);
    const [row] = await overview();
    assert.equal(row.name, "Alpha");
    assert.equal(row.access_blocked, true);
    assert.equal(row.leads_last_7_days, null);
    assert.equal(row.sales_last_7_days, null);
    assert.deepEqual(row.online_users, []);
  });
  test(`override de org ${status} respeita a liberação existente`, async () => {
    await db.exec(`UPDATE organizations SET subscription_status='${status}',billing_override=true WHERE id='${id(10)}'`);
    await asUser(1);
    const [row] = await overview();
    assert.equal(row.access_blocked, false);
    assert.equal(Number(row.leads_last_7_days), 2);
    assert.equal(Number(row.sales_last_7_days), 2);
    assert.equal(row.online_users.length, 2);
  });
}

test("presença considera membros ativos da org, deduplica e expira em 2 minutos", async () => {
  await asUser(1);
  assert.deepEqual((await overview())[0].online_users, [
    { user_id: id(11), name: "Ana" },
    { user_id: id(15), name: "Limite" },
  ]);
});

test("gestor sem vínculos recebe lista vazia", async () => {
  await asUser(4);
  assert.deepEqual(await overview(), []);
});

for (const [label, user, role] of [
  ["gestor inativo", 3, "authenticated"],
  ["membro comum", 11, "authenticated"],
  ["master sem identidade gestor", 99, "authenticated"],
  ["identidade ausente", null, "authenticated"],
  ["anônimo", null, "anon"],
]) {
  test(`nega ${label}`, async () => {
    await asUser(user, role);
    await assert.rejects(overview, (error) => error.code === "42501");
  });
}

test("revogar vínculo remove a org na próxima leitura", async () => {
  await db.exec(
    `DELETE FROM gestor_organizations WHERE gestor_id='${id(101)}' AND organization_id='${id(10)}'`,
  );
  await asUser(1);
  assert.deepEqual(
    (await overview()).map((r) => r.organization_id),
    [id(30)],
  );
});

test("desativar gestor revoga imediatamente o resumo", async () => {
  await asUser(1);
  assert.equal((await overview()).length, 2);
  await db.exec("RESET ROLE");
  await db.exec(`UPDATE gestores SET is_active=false WHERE user_id='${id(1)}'`);
  await asUser(1);
  await assert.rejects(overview, (error) => error.code === "42501");
});

test("gestor não ganha leitura bruta de presença nem acesso à RPC master", async () => {
  await asUser(1);
  assert.deepEqual((await db.query("SELECT * FROM user_presence")).rows, []);
  await assert.rejects(
    () => db.query("SELECT * FROM public.master_org_user_activity()"),
    (error) => error.code === "42501",
  );
});

test("privilégios e search_path da função privada estão restritos", async () => {
  const {
    rows: [fn],
  } = await db.query(`SELECT p.prosecdef, p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') AS anon_access
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='private' AND p.proname='gestor_organization_overview'`);
  assert.equal(fn.prosecdef, true);
  assert.equal(fn.anon_access, false);
  assert.deepEqual(fn.proconfig, ['search_path=""']);
});
