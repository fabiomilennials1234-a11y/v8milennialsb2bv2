import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const org = "4922638c-4909-494e-ba10-12282ec0b161";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = readFileSync(new URL("../../supabase/migrations/20271021000013_toth_order_drafts.sql", import.meta.url), "utf8");
let db;
const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.result;
const workspace = () => value("select public.toth_order_workspace($1) result", [id(40)]);
const save = (revision = 0, items = [], notes = "Preparação local") => value(
  "select public.toth_save_order_draft($1,$2,$3,$4) result", [id(40), revision, JSON.stringify(items), notes]);
const review = (revision = 1) => value("select public.toth_review_order_draft($1,$2) result", [id(40), revision]);
const send = (revision = 1) => value("select public.toth_request_order_send($1,$2) result", [id(40), revision]);
const grant = (enabled = true, member = id(12)) => value("select public.toth_set_order_preparer($1,$2,$3) result", [id(40), member, enabled]);
const login = async (user = id(1), role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`SET ROLE ${role}`);
};
const catalog = [{ product_external_id: "CAFE-01", quantity: 2.5 }];
const ownerExec = async (sql) => { await db.exec("RESET ROLE"); await db.exec(sql); await db.exec("SET ROLE authenticated"); };
const snapshot = () => value(`select jsonb_build_object('deals',(select jsonb_agg(d) from deals d),
  'leads',(select jsonb_agg(l) from leads l),'clients',(select jsonb_agg(c) from upsell_clients c),
  'orders',(select jsonb_agg(o) from upsell_orders o),'sales',(select jsonb_agg(s) from sale_events s)) result`);

before(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.master_users(user_id uuid PRIMARY KEY,is_active boolean DEFAULT true);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TYPE public.app_role AS ENUM ('admin','sdr','closer','agency','bdr','cliente','member');
    CREATE TABLE organizations(id uuid PRIMARY KEY,feature_flags jsonb DEFAULT '{}');
    CREATE TABLE team_members(id uuid PRIMARY KEY,user_id uuid,organization_id uuid,name text,role public.app_role,is_active boolean DEFAULT true);
    CREATE TABLE leads(id uuid PRIMARY KEY,organization_id uuid,name text,deleted_at timestamptz,responsible_id uuid,erp_code text);
    CREATE TABLE deals(id uuid PRIMARY KEY,organization_id uuid,source_lead_id uuid,deleted_at timestamptz,value numeric,outcome text);
    CREATE TABLE upsell_clients(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid,external_id text,external_source text,is_active boolean DEFAULT true);
    CREATE TABLE upsell_orders(id uuid PRIMARY KEY,organization_id uuid,value numeric);
    CREATE TABLE sale_events(id uuid PRIMARY KEY,organization_id uuid,value numeric);
    CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT organization_id FROM public.team_members WHERE user_id=auth.uid() AND is_active $$;
    CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS (SELECT 1 FROM public.master_users WHERE user_id=auth.uid() AND is_active) $$;
    CREATE FUNCTION can_link_or_read_lead(p_lead uuid,p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
      SELECT EXISTS (SELECT 1 FROM public.leads l WHERE l.id=p_lead AND l.organization_id=p_org AND l.deleted_at IS NULL
        AND (public.is_master_user() OR EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id=l.organization_id
          AND m.user_id=auth.uid() AND m.is_active AND (m.role='admin' OR l.responsible_id=m.id)))) $$;
    -- Reproduce the project's explicit default ACLs as well as PUBLIC EXECUTE.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
  `);
  await db.exec(migration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`RESET ROLE;
    TRUNCATE toth_order_draft_audit,toth_order_drafts,toth_order_preparers,toth_order_catalog_items,
      deals,leads,upsell_clients,upsell_orders,sale_events,team_members,organizations,master_users,auth.users CASCADE;
    INSERT INTO auth.users VALUES ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
    INSERT INTO organizations VALUES ('${org}','{"toth_order_drafts":true}'),('${id(20)}','{"toth_order_drafts":true}');
    INSERT INTO team_members(id,user_id,organization_id,name,role) VALUES
      ('${id(11)}','${id(1)}','${org}','Administrador','admin'),
      ('${id(12)}','${id(2)}','${org}','Comercial','member'),
      ('${id(13)}','${id(3)}','${org}','Sem acesso ao lead','member'),
      ('${id(14)}','${id(4)}','${id(20)}','Outra organização','admin');
    INSERT INTO leads VALUES ('${id(30)}','${org}','Cliente teste',NULL,'${id(12)}','DISPLAY-ONLY'),
      ('${id(31)}','${id(20)}','Outro cliente',NULL,'${id(14)}',NULL);
    INSERT INTO deals VALUES ('${id(40)}','${org}','${id(30)}',NULL,100,'open'),
      ('${id(41)}','${id(20)}','${id(31)}',NULL,900,'won');
    INSERT INTO upsell_clients VALUES ('${id(50)}','${org}','${id(30)}','CLIENT-01','toth',true);
    INSERT INTO upsell_orders VALUES ('${id(60)}','${org}',100);
    INSERT INTO sale_events VALUES ('${id(70)}','${org}',100);
    INSERT INTO toth_order_catalog_items(organization_id,product_external_id,description) VALUES ('${org}','CAFE-01','Café de teste');
  `);
  await login();
});

test("migration has no activation, catalog seeds or writes to existing business data", async () => {
  assert.doesNotMatch(migration, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?:deals|leads|upsell_clients|upsell_orders|sale_events|organizations)\b/i);
  await db.exec("RESET ROLE");
  const before = await snapshot();
  await login();
  const created = await save(0, catalog);
  assert.equal(created.draft.customer_external_id, "CLIENT-01", "display-only erp_code must not determine identity");
  await review();
  await assert.rejects(send(), /toth_write_contract_unverified/);
  await db.exec("RESET ROLE");
  assert.deepEqual(await snapshot(), before);
});

test("workspace returns only confirmed catalog with mandatory unresolved blockers", async () => {
  const state = await workspace();
  assert.equal(state.enabled, true);
  assert.equal(state.can_prepare, true);
  assert.equal(state.can_review, true);
  assert.equal(state.draft, null);
  assert.deepEqual(state.catalog, [{ product_external_id: "CAFE-01", description: "Café de teste" }]);
  assert.deepEqual(state.blockers, ["supplier_contract_unverified", "homologation_unverified", "commercial_validation_unavailable", "writes_disabled"]);
});

test("missing, false, null and string feature flags stay disabled on server", async () => {
  for (const flags of ["{}", '{"toth_order_drafts":false}', '{"toth_order_drafts":null}', '{"toth_order_drafts":"true"}']) {
    await ownerExec(`UPDATE organizations SET feature_flags='${flags}' WHERE id='${org}';`);
    const state = await workspace();
    assert.equal(state.enabled, false);
    assert.equal(state.can_prepare, false);
    assert.deepEqual(state.catalog, []);
    await assert.rejects(save(), /toth_drafts_disabled/);
    await assert.rejects(review(), /toth_drafts_disabled/);
    await assert.rejects(send(), /toth_drafts_disabled/);
    await assert.rejects(grant(), /toth_drafts_disabled/);
  }
});

test("explicit true flag cannot activate an organization outside the pilot", async () => {
  await login(id(4));
  const state = await value("select toth_order_workspace($1) result", [id(41)]);
  assert.equal(state.enabled, false);
  await assert.rejects(value("select toth_save_order_draft($1,0,'[]','') result", [id(41)]), /toth_drafts_disabled/);
});

test("no catalog means empty notes-only drafts; local review refuses empty items", async () => {
  await ownerExec("DELETE FROM toth_order_catalog_items");
  assert.ok((await workspace()).blockers.includes("catalog_unavailable"));
  const state = await save();
  assert.equal(state.draft.revision, 1);
  assert.deepEqual(state.draft.items, []);
  await assert.rejects(review(), /toth_review_requires_items/);
  await assert.rejects(save(1, catalog), /toth_catalog_item_unavailable/);
});

test("one draft per deal uses compare-and-swap; stale creates/updates/reviews cannot overwrite", async () => {
  const first = (await save(0, catalog)).draft;
  await assert.rejects(save(0, catalog), /toth_revision_conflict/);
  const second = (await save(1, catalog, "Nova revisão")).draft;
  assert.equal(second.id, first.id);
  assert.equal(second.revision, 2);
  await assert.rejects(save(1, catalog, "Sobrescrita"), /toth_revision_conflict/);
  await assert.rejects(review(1), /toth_revision_conflict/);
  await assert.rejects(save(null, catalog), /toth_revision_conflict/);
  assert.equal((await workspace()).draft.notes, "Nova revisão");
  assert.equal(await value("select count(*)::int result from toth_order_drafts"), 1);
});

test("review acknowledges exact local revision, is idempotent, and next save invalidates it", async () => {
  await save(0, catalog);
  const reviewed = await review();
  assert.equal(reviewed.draft.reviewed_revision, 1);
  assert.equal(reviewed.draft.reviewed_by, id(1));
  assert.ok(reviewed.draft.reviewed_at);
  assert.equal(reviewed.audit[1].action, "draft_reviewed_locally");
  assert.equal(reviewed.audit[1].actor_name, "Administrador");
  assert.ok(reviewed.blockers.includes("writes_disabled"));
  await review();
  assert.equal((await workspace()).audit.length, 2);
  const updated = await save(1, catalog);
  assert.equal(updated.draft.reviewed_revision, null);
  assert.equal(updated.draft.reviewed_at, null);
  assert.equal(updated.draft.reviewed_by, null);
  assert.equal(updated.audit.length, 3);
});

test("members require a separate grant; granting never confers admin review/send", async () => {
  await login(id(2));
  assert.equal((await workspace()).can_prepare, false);
  await assert.rejects(save(0, catalog), /toth_access_denied/);
  await assert.rejects(grant(), /toth_access_denied/);
  await assert.rejects(value("select toth_order_preparer_access($1) result", [id(40)]), /toth_access_denied/);
  await login();
  const access = await grant();
  assert.equal(access.find((m) => m.team_member_id === id(12)).can_prepare, true);
  await login(id(2));
  const saved = await save(0, catalog);
  assert.equal(saved.can_prepare, true);
  assert.equal(saved.can_review, false);
  await assert.rejects(review(), /toth_access_denied/);
  await assert.rejects(send(), /toth_access_denied/);
  await login(); await grant(false); await login(id(2));
  await assert.rejects(save(1, catalog), /toth_access_denied/);
});

test("global master status without active pilot membership never grants ERP operator access", async () => {
  await save(0, catalog);
  await ownerExec(`INSERT INTO master_users(user_id) VALUES ('${id(4)}');`);
  await login(id(4));
  assert.equal(await value("select is_master_user() result"), true);
  assert.equal(await value("select can_link_or_read_lead($1,$2) result", [id(30),org]), true,
    "existing lead visibility may allow master, but the operator boundary must still deny");
  for (const action of [workspace, () => save(1, catalog), review, send, grant,
    () => value("select toth_order_preparer_access($1) result", [id(40)])]) {
    await assert.rejects(action(), /toth_access_denied/);
  }
  assert.equal(await value("select toth_order_can_read($1) result", [id(40)]), false);
  assert.deepEqual((await db.query("select * from toth_order_drafts")).rows, []);
  assert.deepEqual((await db.query("select * from toth_order_draft_audit")).rows, []);
  await ownerExec(`INSERT INTO team_members(id,user_id,organization_id,name,role,is_active)
    VALUES('${id(15)}','${id(4)}','${org}','Master inativo','admin',false);`);
  await assert.rejects(workspace(), /toth_access_denied/);
});

test("master with active org admin membership follows normal admin and send barriers", async () => {
  await ownerExec(`INSERT INTO master_users(user_id) VALUES ('${id(1)}');`);
  assert.equal(await value("select is_master_user() result"), true);
  await grant();
  const saved = await save(0, catalog);
  assert.equal(saved.can_prepare, true);
  assert.equal(saved.can_review, true);
  const reviewed = await review();
  assert.equal(reviewed.draft.reviewed_by, id(1));
  await assert.rejects(send(), /toth_write_contract_unverified/);
});

test("master with active member membership still needs a grant and cannot review/send", async () => {
  await ownerExec(`INSERT INTO master_users(user_id) VALUES ('${id(2)}');`);
  await login(id(2));
  assert.equal(await value("select is_master_user() result"), true);
  assert.equal((await workspace()).can_prepare, false);
  await assert.rejects(save(0, catalog), /toth_access_denied/);
  await login(); await grant(); await login(id(2));
  const saved = await save(0, catalog);
  assert.equal(saved.can_prepare, true);
  assert.equal(saved.can_review, false);
  await assert.rejects(review(), /toth_access_denied/);
  await assert.rejects(send(), /toth_access_denied/);
  await assert.rejects(grant(false), /toth_access_denied/);
});

test("an admin cannot grant another tenant, inactive member, or toggle implicit admin access", async () => {
  await assert.rejects(grant(true, id(14)), /toth_invalid_preparer/);
  await assert.rejects(grant(false, id(11)), /toth_invalid_preparer/);
  await ownerExec(`UPDATE team_members SET is_active=false WHERE id='${id(12)}';`);
  await assert.rejects(grant(), /toth_invalid_preparer/);
  await assert.rejects(grant(null, id(13)), /toth_invalid_preparer/);
});

test("lead visibility, tenant and active membership checks apply to every draft call", async () => {
  await save(0, catalog);
  await grant(true, id(13));
  for (const user of [id(3), id(4), ""]) {
    await login(user);
    for (const action of [workspace, () => save(1, catalog), review, send, grant]) {
      await assert.rejects(action(), /toth_access_denied/);
    }
    assert.deepEqual((await db.query("select * from toth_order_drafts")).rows, []);
    assert.deepEqual((await db.query("select * from toth_order_draft_audit")).rows, []);
  }
  await login();
  await ownerExec(`UPDATE team_members SET is_active=false WHERE id='${id(11)}';`);
  await assert.rejects(workspace(), /toth_access_denied/);
});

test("missing/deleted deal and deleted/cross-tenant lead never permit a draft", async () => {
  await assert.rejects(value("select toth_order_workspace($1) result", [id(999)]), /toth_deal_unavailable/);
  await ownerExec(`UPDATE deals SET deleted_at=now() WHERE id='${id(40)}';`);
  await assert.rejects(save(), /toth_deal_unavailable/);
  await ownerExec(`UPDATE deals SET deleted_at=NULL,source_lead_id='${id(31)}' WHERE id='${id(40)}';`);
  await assert.rejects(save(), /toth_access_denied/);
});

test("catalog validates exact IDs, active state, item shape and quantities on server", async () => {
  for (const invalid of [null, {}, [null], [{}], [{ ...catalog[0], unit_price: 1 }], [catalog[0], catalog[0]],
    [{ product_external_id: " CAFE-01", quantity: 1 }], [{ product_external_id: "CAFE-01", quantity: "2" }],
    [{ product_external_id: "CAFE-01", quantity: 0 }], [{ product_external_id: "CAFE-01", quantity: -1 }],
    [{ product_external_id: "CAFE-01", quantity: 1e9 + 1 }], Array(201).fill(catalog[0])]) {
    await assert.rejects(save(0, invalid), /toth_invalid_items/);
  }
  await assert.rejects(save(0, [{ product_external_id: "INVENTED", quantity: 1 }]), /toth_catalog_item_unavailable/);
  await assert.rejects(save(0, [], null), /toth_invalid_notes/);
  await assert.rejects(save(0, [], "x".repeat(1001)), /toth_invalid_notes/);
  await save(0, catalog);
  await ownerExec("UPDATE toth_order_catalog_items SET active=false");
  await assert.rejects(review(), /toth_catalog_item_unavailable/);
  assert.equal((await workspace()).draft.reviewed_revision, null);
});

test("ERP client identity must be exact, active and unambiguous", async () => {
  await ownerExec("UPDATE upsell_clients SET external_source='manual'");
  assert.equal((await workspace()).can_prepare, false);
  assert.ok((await workspace()).blockers.includes("client_link_unavailable"));
  await assert.rejects(save(), /toth_client_link_unavailable/);
  await ownerExec("UPDATE upsell_clients SET external_source='toth',is_active=false");
  await assert.rejects(save(), /toth_client_link_unavailable/);
  await ownerExec(`UPDATE upsell_clients SET is_active=true; INSERT INTO upsell_clients VALUES ('${id(51)}','${org}','${id(30)}','CLIENT-02','toth',true);`);
  await assert.rejects(save(), /toth_client_link_unavailable/);
  await ownerExec(`DELETE FROM upsell_clients WHERE id='${id(51)}';`);
  await save(0, catalog);
  await ownerExec("UPDATE upsell_clients SET external_id='CHANGED'");
  await assert.rejects(save(1, catalog), /toth_client_link_changed/);
  await assert.rejects(review(), /toth_client_link_changed/);
  assert.equal((await workspace()).can_prepare, false);
  assert.ok((await workspace()).blockers.includes("client_link_changed"));
});

test("a malformed second ERP link cannot disappear before ambiguity is counted", async () => {
  await ownerExec(`INSERT INTO upsell_clients VALUES ('${id(51)}','${org}','${id(30)}','','toth',true);`);
  await assert.rejects(save(), /toth_client_link_unavailable/);
  await ownerExec(`UPDATE upsell_clients SET external_id='DUPLICATE' WHERE id='${id(51)}';
    INSERT INTO upsell_clients VALUES ('${id(52)}','${org}','${id(30)}','DUPLICATE','toth',true);`);
  await assert.rejects(save(), /toth_client_link_unavailable/);
  assert.equal((await workspace()).can_prepare, false);
});

test("lead reassignment hides original draft and snapshots from the newly authorized viewer", async () => {
  await save(0, catalog, "Informação do primeiro cliente");
  await grant(true, id(13));
  await ownerExec(`INSERT INTO leads VALUES ('${id(32)}','${org}','Novo cliente',NULL,'${id(13)}',NULL);
    INSERT INTO upsell_clients VALUES ('${id(52)}','${org}','${id(32)}','CLIENT-NEW','toth',true);
    UPDATE deals SET source_lead_id='${id(32)}' WHERE id='${id(40)}';`);
  await login(id(3));
  const state = await workspace();
  assert.equal(state.enabled, true);
  assert.equal(state.can_prepare, false);
  assert.equal(state.draft, null);
  assert.deepEqual(state.audit, []);
  assert.ok(state.blockers.includes("client_link_changed"));
  assert.deepEqual((await db.query("select * from toth_order_drafts")).rows, []);
  assert.deepEqual((await db.query("select * from toth_order_draft_audit")).rows, []);
  await assert.rejects(save(1, catalog), /toth_client_link_changed/);
  await login();
  await assert.rejects(review(), /toth_client_link_changed/);
});

test("a new admin can acknowledge the same revision if the original reviewer was deleted", async () => {
  await save(0, catalog); await review();
  await ownerExec(`DELETE FROM auth.users WHERE id='${id(1)}'; UPDATE team_members SET role='admin' WHERE id='${id(12)}';`);
  await login(id(2));
  const reviewed = await review();
  assert.equal(reviewed.draft.reviewed_revision, 1);
  assert.equal(reviewed.draft.reviewed_by, id(2));
  assert.equal(reviewed.audit.filter((a) => a.action === "draft_reviewed_locally").length, 2);
});

test("preparer management hides implicit admins and keeps access-change audit out of draft history", async () => {
  const access = await grant();
  assert.ok(access.every((member) => !member.is_admin));
  assert.equal((await workspace()).audit.length, 0);
  await db.exec("RESET ROLE");
  const event = await value("select to_jsonb(a) result from toth_order_draft_audit a");
  assert.equal(event.action, "preparer_granted");
  assert.equal(event.actor_id, id(1));
  assert.equal(event.after_snapshot.team_member_id, id(12));
});

test("authenticated cannot write draft, audit, catalog or preparer rows directly", async () => {
  await save(0, catalog);
  for (const table of ["toth_order_drafts", "toth_order_draft_audit", "toth_order_catalog_items", "toth_order_preparers"]) {
    for (const statement of [`INSERT INTO ${table} DEFAULT VALUES`, `UPDATE ${table} SET organization_id='${org}'`, `DELETE FROM ${table}`]) {
      await assert.rejects(db.exec(statement), /permission denied/);
    }
  }
  for (const table of ["toth_order_catalog_items", "toth_order_preparers"]) {
    await assert.rejects(db.exec(`SELECT * FROM ${table}`), /permission denied/);
  }
});

test("RLS hides rows after feature disable while preserving stored draft and audit", async () => {
  await save(0, catalog);
  assert.equal(await value("select count(*)::int result from toth_order_drafts"), 1);
  await ownerExec("UPDATE organizations SET feature_flags='{}'");
  assert.equal(await value("select count(*)::int result from toth_order_drafts"), 0);
  assert.equal(await value("select count(*)::int result from toth_order_draft_audit"), 0);
  assert.equal((await workspace()).draft, null);
  await db.exec("RESET ROLE");
  assert.equal(await value("select count(*)::int result from toth_order_drafts"), 1);
});

test("public RPC ACLs are authenticated-only despite explicit default function grants", async () => {
  const functions = ["toth_order_can_read(uuid)", "toth_order_workspace(uuid)", "toth_save_order_draft(uuid,integer,jsonb,text)",
    "toth_review_order_draft(uuid,integer)", "toth_request_order_send(uuid,integer)", "toth_order_preparer_access(uuid)", "toth_set_order_preparer(uuid,uuid,boolean)"];
  for (const name of functions) {
    assert.equal(await value("select has_function_privilege('anon',$1,'EXECUTE') result", [`public.${name}`]), false);
    assert.equal(await value("select has_function_privilege('authenticated',$1,'EXECUTE') result", [`public.${name}`]), true);
  }
  await db.exec("RESET ROLE");
  assert.equal(await value("select has_function_privilege('authenticated','toth_order_private.context(uuid,boolean)','EXECUTE') result"), false);
  await login("", "anon");
  await assert.rejects(workspace(), /permission denied/);
  await assert.rejects(save(), /permission denied/);
  await assert.rejects(send(), /permission denied/);
});

test("permanent send barrier rejects reviewed and missing drafts without creating an operation", async () => {
  await assert.rejects(send(), /toth_write_contract_unverified/);
  await save(0, catalog); await review();
  const before = await workspace();
  for (const revision of [0, 1, 999, null]) await assert.rejects(send(revision), /toth_write_contract_unverified/);
  assert.deepEqual(await workspace(), before);
});
