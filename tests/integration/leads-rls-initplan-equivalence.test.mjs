// Leads RLS → InitPlans (20271107150000): same rows for every role, before and after.
//
// The skeleton (fixtures/leads-rls-baseline.sql) carries the prod bodies of the
// 16 functions the policies call; the first test pins them to the prod md5 of
// pg_get_functiondef (read 2026-10-05/06). A divergent md5 means the fixture is
// no longer prod and nothing below proves anything.
//
// Equivalence is proven three ways for 14 actors (+ anon) over a cartesian set of
// leads (org × pre/sale × sdr/closer × pipeline-entry keys × deleted):
//   1. per row  — COALESCE(old_qual,false) = COALESCE(new_qual,false) for every
//                 lead, evaluated with each actor's claims (catalog text of the
//                 policy before/after the migration, not a hand copy);
//   2. per set  — the exact ids visible (SELECT) and touched (UPDATE) as
//                 `authenticated` with claims, before vs after;
//   3. rollback — quals byte-identical to the original, same sets again.
// Positive controls: four one-term mutations of the new qual MUST be caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20271107150000_leads_select_rls_initplan.sql');
const RB = read('../../supabase/migrations/rollback/20271107150000_leads_select_rls_initplan.sql');
const SKELETON = read('./fixtures/leads-rls-baseline.sql');

const PROD_MD5 = {
  'can_see_lead_by_permissions(uuid,uuid)': '4f36e5d394a307215d69451155fb03b7',
  'get_my_gestor_organization_ids()': 'a342535bf36d39ce5dba59fd8441e122',
  'get_my_member_organization_ids()': '2335cc678384684526a34e384bfc7d26',
  'get_my_organization_ids()': '72fb9e49c1956386ac3eca3d96325a5a',
  'get_user_organization_id()': '833c3f54359e0ef60924b9e333fe78f6',
  'has_feature_permission(text,uuid)': '7e2cfbc44d0eac9e31919783c735898c',
  'has_feature_permission(text)': '78973ce76491257315788143ebddf057',
  'has_no_responsible(uuid,uuid,uuid)': '94c337ac25e16447e372c280410a0a11',
  'has_role(uuid,app_role)': 'a3b8be480ffca96c1fd266ef1dfc7309',
  'is_master_user(uuid)': '0fdb47977f7bc6a3b19a4c892e350075',
  'is_responsible_in_same_org(uuid,uuid)': '218f98d00a5d634b5caa555f098bf5cd',
  'is_user_admin()': 'd2c767591da0cc2a7391614322b52538',
  'is_user_responsible_in_any_pipe(uuid)': '2526bf603c67860b8aae00704eb2af15',
  'is_user_responsible(uuid,uuid,uuid)': '7994faaf4a6903512dcb3d5046f1cf3f',
  'is_user_responsible(uuid,uuid)': 'ce40007aecbd8b6f8785b0734f80bddf',
  'org_access_blocked(uuid)': 'b9120fe946711aa617fc84ad921a11a7',
  'user_has_org_permission(text)': '843a1c0896c12b4757961a7e619f4c89',
};

const hex = (n) => n.toString(16).padStart(12, '0');
const ORG = { A: `0a000000-0000-0000-0000-${hex(1)}`, B: `0a000000-0000-0000-0000-${hex(2)}`,
  X: `0a000000-0000-0000-0000-${hex(3)}` /* suspended */, Z: `0a000000-0000-0000-0000-${hex(4)}`,
  D: `0a000000-0000-0000-0000-${hex(5)}` /* org default view_all = true */ };
const U = (n) => `0b000000-0000-0000-0000-${hex(n)}`;
const T = {}; let tn = 0;
const tm = (name) => (T[name] ??= `0c000000-0000-0000-0000-${hex(++tn)}`);
// [team_member, user, org, role, is_active, created_at]
const TMS = [
  ['t3', 3, 'A', 'admin', true], ['t4', 4, 'A', 'member', true], ['t5', 5, 'A', 'member', true],
  ['t6', 6, 'D', 'member', true], ['t7', 7, 'A', 'member', true], ['t8', 8, 'A', 'member', true],
  ['t9', 9, 'A', 'member', true], ['t9x', 9, 'B', 'member', false], ['t10', 10, 'A', 'member', true],
  ['tC', 90, 'A', 'member', true], ['t11a', 11, 'A', 'member', false], ['t11b', 11, 'B', 'member', true],
  ['t12d', 12, 'D', 'member', true, '2020-01-01'], ['t12b', 12, 'B', 'member', true, '2024-01-01'],
  ['t13', 13, 'X', 'member', true], ['tZ', 91, 'Z', 'member', true], ['tB', 92, 'B', 'member', true],
];
const ACTORS = {
  U1_master: 1, U2_gestor_of_A: 2, U3_admin_A: 3, U4_global_admin_member_A: 4, U5_view_all_override: 5,
  U6_view_all_org_default: 6, U7_view_unassigned: 7, U8_view_subordinates: 8, U9_restricted_responsible: 9,
  U10_restricted_not_responsible: 10, U11_inactive_A_active_B: 11, U12_multi_org_primary_view_all: 12,
  U13_blocked_org_only: 13, U14_no_team_member: 14,
};

function fixtures() {
  const s = [];
  s.push(`INSERT INTO organizations(id,subscription_status) VALUES ('${ORG.A}','active'),('${ORG.B}','trial'),('${ORG.X}','suspended'),('${ORG.Z}','active'),('${ORG.D}','active');`);
  for (const [n, u, o, r, a, c] of TMS) s.push(`INSERT INTO team_members(id,user_id,organization_id,role,is_active,created_at) VALUES ('${tm(n)}','${U(u)}','${ORG[o]}','${r}',${a},'${c ?? '2025-01-01'}');`);
  s.push(`INSERT INTO master_users(user_id,is_active) VALUES ('${U(1)}',true);`);
  s.push(`INSERT INTO gestores(id,user_id,is_active) VALUES ('0d000000-0000-0000-0000-000000000001','${U(2)}',true);`);
  s.push(`INSERT INTO gestor_organizations(gestor_id,organization_id) VALUES ('0d000000-0000-0000-0000-000000000001','${ORG.A}');`);
  s.push(`INSERT INTO user_roles(user_id,role) VALUES ('${U(4)}','admin');`);
  // catalog as prod: every leads.* key defaults to true and is not admin-only
  for (const k of ['leads.view_all', 'leads.view_unassigned', 'leads.view_subordinates', 'leads.view_general_info', 'leads.delete'])
    s.push(`INSERT INTO feature_permissions(key,is_admin_only,default_value) VALUES ('${k}',false,true);`);
  for (const o of Object.keys(ORG)) for (const k of ['leads.view_all', 'leads.view_unassigned', 'leads.view_subordinates'])
    s.push(`INSERT INTO organization_feature_defaults(organization_id,feature_key,enabled) VALUES ('${ORG[o]}','${k}',${o === 'D' && k === 'leads.view_all'});`);
  s.push(`INSERT INTO member_feature_permissions(team_member_id,organization_id,feature_key,enabled) VALUES
    ('${tm('t5')}','${ORG.A}','leads.view_all',true),('${tm('t7')}','${ORG.A}','leads.view_unassigned',true),
    ('${tm('t8')}','${ORG.A}','leads.view_subordinates',true);`);
  const V = [null, 't9', 't9x', 'tC', 't11a', 't11b', 't12b', 'tZ', 't8', 'tB'].map((v) => (v ? tm(v) : null));
  const pairs = [[null, null], ...V.filter(Boolean).flatMap((v) => [[v, null], [null, v]])];
  const q = (v) => (v ? `'${v}'` : 'NULL');
  let i = 0; const rows = [];
  for (const o of Object.values(ORG)) for (const [p, sa] of pairs) for (const [sd, cl] of pairs) {
    i++; rows.push(`('${o}',${i % 11 === 0 ? 'now()' : 'NULL'},${q(p)},${q(sa)},${q(sd)},${q(cl)})`);
  }
  s.push(`INSERT INTO leads(organization_id,deleted_at,pre_sale_responsible_id,sale_responsible_id,sdr_id,closer_id) VALUES ${rows.join(',')};`);
  const KEYS = ['assigned_to', 'sdr_id', 'responsible_id', 'closer_id', 'pre_sale_responsible_id', 'sale_responsible_id'];
  let k = 0;
  for (const o of ['A', 'B']) for (const key of KEYS) for (const v of ['t9', 't9x', 'tC', 't11a', 't11b', 't12b']) {
    k++; const lid = `0e000000-0000-0000-0000-${hex(k)}`;
    s.push(`INSERT INTO leads(id,organization_id,deleted_at) VALUES ('${lid}','${ORG[o]}',${k % 13 === 0 ? 'now()' : 'NULL'});`);
    s.push(key === 'assigned_to'
      ? `INSERT INTO pipeline_entries(organization_id,lead_id,assigned_to) VALUES ('${ORG[o]}','${lid}','${tm(v)}');`
      : `INSERT INTO pipeline_entries(organization_id,lead_id,metadata) VALUES ('${ORG[o]}','${lid}','{"${key}":"${tm(v)}"}');`);
  }
  // one lead with two entries (colleague + mine), one without any entry
  s.push(`INSERT INTO leads(id,organization_id) VALUES ('0e000000-0000-0000-0000-00000000ff01','${ORG.A}'),('0e000000-0000-0000-0000-00000000ff02','${ORG.A}');`);
  s.push(`INSERT INTO pipeline_entries(organization_id,lead_id,assigned_to,metadata) VALUES
    ('${ORG.A}','0e000000-0000-0000-0000-00000000ff01','${tm('tC')}','{}'),
    ('${ORG.A}','0e000000-0000-0000-0000-00000000ff01',NULL,'{"closer_id":"${tm('t9')}"}');`);
  return s.join('\n');
}

const claims = (u) => `SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: U(u), role: 'authenticated' })}', false)`;
const POLICY_NAMES = ['leads_select_by_responsibility_and_permissions', 'leads_update_by_responsibility_and_permissions'];

async function visible(db, u) {
  await db.exec(`RESET ROLE; ${claims(u)}; SET ROLE authenticated;`);
  const r = await db.query('SELECT id FROM leads ORDER BY id');
  await db.exec('RESET ROLE');
  return r.rows.map((x) => x.id);
}
async function updatable(db, u) {
  await db.exec('RESET ROLE; TRUNCATE upd_log;');
  // no column read in SET/WHERE → only the UPDATE policy (USING + implicit WITH CHECK) applies
  await db.exec(`BEGIN; ${claims(u)}; SET LOCAL ROLE authenticated; UPDATE leads SET name = 'touched'; RESET ROLE;`);
  const ids = (await db.query('SELECT id FROM upd_log ORDER BY id')).rows.map((x) => x.id);
  await db.exec('ROLLBACK');
  return ids;
}
async function policies(db) {
  const r = await db.query(`SELECT policyname, qual, roles::text AS roles, with_check FROM pg_policies
    WHERE tablename = 'leads' AND policyname = ANY($1)`, [POLICY_NAMES]);
  return Object.fromEntries(r.rows.map((x) => [x.policyname, x]));
}
async function rowDiff(db, u, oldQ, newQ) {
  await db.exec(`RESET ROLE; ${claims(u)}`);
  return (await db.query(`SELECT count(*) FILTER (WHERE COALESCE((${oldQ}),false) IS DISTINCT FROM COALESCE((${newQ}),false))::int AS d FROM leads`)).rows[0].d;
}

test('leads RLS initplan rewrite keeps every role on exactly the same rows', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(SKELETON);

    await t.test('fixture functions are byte-identical to prod', async () => {
      const r = await db.query(`SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5
        FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`);
      const got = Object.fromEntries(r.rows.map((x) => [x.sig, x.md5]));
      for (const [sig, md5] of Object.entries(PROD_MD5)) assert.equal(got[sig], md5, `${sig} drifted from prod`);
    });

    await db.exec(fixtures());
    await db.exec(`CREATE TABLE upd_log(id uuid);
      CREATE FUNCTION log_upd() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO upd_log VALUES (NEW.id); RETURN NEW; END $$;
      CREATE TRIGGER t_log AFTER UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION log_upd();`);

    const before = await policies(db);
    const sel0 = {}, upd0 = {};
    for (const [name, u] of Object.entries(ACTORS)) { sel0[name] = await visible(db, u); upd0[name] = await updatable(db, u); }
    // fixture sanity: the matrix exercises allow AND deny for the restricted roles
    assert.ok(sel0.U9_restricted_responsible.length > 0 && sel0.U10_restricted_not_responsible.length === 0);
    assert.ok(sel0.U2_gestor_of_A.length > 0 && upd0.U2_gestor_of_A.length === 0, 'gestor reads but does not update (no gestor branch in UPDATE)');

    await db.exec(MIG);
    const after = await policies(db);

    await t.test('catalog: TO authenticated, UPDATE keeps WITH CHECK = USING, helpers locked down', async () => {
      for (const p of POLICY_NAMES) assert.equal(after[p].roles, '{authenticated}');
      assert.equal(after.leads_update_by_responsibility_and_permissions.with_check, null);
      const h = (await db.query(`SELECT p.oid::regprocedure::text AS sig, p.prosecdef, p.provolatile, p.proconfig::text AS cfg,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x, p.proacl::text AS acl
        FROM pg_proc p WHERE p.proname LIKE 'rls\\_%' ORDER BY 1`)).rows;
      assert.equal(h.length, 4);
      for (const f of h) {
        assert.ok(f.prosecdef && f.provolatile === 's', `${f.sig} must be STABLE SECURITY DEFINER`);
        assert.match(f.cfg, /search_path=/, `${f.sig} must pin search_path`);
        assert.ok(f.auth_x && !f.anon_x && !f.svc_x, `${f.sig} EXECUTE only for authenticated`);
        assert.doesNotMatch(f.acl, /(^|[{,])=X/, `${f.sig} must not be executable by PUBLIC`);
      }
    });

    for (const [name, u] of Object.entries(ACTORS)) {
      await t.test(`${name}: same rows (per row and per set, SELECT and UPDATE)`, async () => {
        assert.equal(await rowDiff(db, u, before[POLICY_NAMES[0]].qual, after[POLICY_NAMES[0]].qual), 0, 'per-row SELECT');
        assert.equal(await rowDiff(db, u, before[POLICY_NAMES[1]].qual, after[POLICY_NAMES[1]].qual), 0, 'per-row UPDATE');
        assert.deepEqual(await visible(db, u), sel0[name], 'visible set');
        assert.deepEqual(await updatable(db, u), upd0[name], 'updatable set');
      });
    }

    await t.test('implicit WITH CHECK still blocks handing a lead to a colleague', async () => {
      const { id } = (await db.query(`SELECT id FROM leads WHERE organization_id='${ORG.A}' AND deleted_at IS NULL
        AND pre_sale_responsible_id='${tm('t9')}' AND sale_responsible_id IS NULL AND sdr_id IS NULL AND closer_id IS NULL LIMIT 1`)).rows[0];
      await db.exec(`${claims(9)}; SET ROLE authenticated;`);
      await assert.rejects(db.exec(`UPDATE leads SET pre_sale_responsible_id='${tm('tC')}' WHERE id='${id}'`), /row-level security/);
      await db.exec('RESET ROLE');
    });

    await t.test('anon: permission denied on SELECT and EXPLAIN, process survives', async () => {
      await db.exec(`SELECT set_config('request.jwt.claims','{"role":"anon"}',false); SET ROLE anon;`);
      await assert.rejects(db.query('SELECT id FROM leads'), /permission denied/);
      await assert.rejects(db.query('EXPLAIN SELECT id FROM leads'), /permission denied/);
      await db.exec('RESET ROLE');
      assert.equal((await db.query('SELECT 1 AS ok')).rows[0].ok, 1);
      assert.equal((await db.query(`SELECT has_table_privilege('anon','public.leads','SELECT') AS p`)).rows[0].p, false);
    });

    await t.test('rls_lead_in_my_pipes is not an oracle for someone else\'s team member', async () => {
      const { lead_id } = (await db.query(`SELECT lead_id FROM pipeline_entries WHERE assigned_to='${tm('tC')}' AND organization_id='${ORG.A}' LIMIT 1`)).rows[0];
      await db.exec(`${claims(9)}; SET ROLE authenticated;`);
      const r = (await db.query(`SELECT rls_lead_in_my_pipes('${lead_id}', ARRAY['${tm('tC')}']::uuid[]) AS a,
        rls_lead_in_my_pipes('${lead_id}', ARRAY['${tm('tC')}','${tm('t9')}']::uuid[]) AS b`)).rows[0];
      await db.exec('RESET ROLE');
      assert.deepEqual(r, { a: false, b: false });
    });

    await t.test('positive controls: a one-term mutation is caught', async () => {
      const q = after[POLICY_NAMES[0]].qual;
      const mutations = {
        'pre_sale uses active-only ids': q.replace('pre_sale_responsible_id = ANY (( SELECT rls_my_team_member_ids(false)', 'pre_sale_responsible_id = ANY (( SELECT rls_my_team_member_ids(true)'),
        'gestor branch dropped': q.replace(/\(organization_id IN \( SELECT get_my_gestor_organization_ids\(\) AS get_my_gestor_organization_ids\)\) OR /, ''),
        'one-arg view_all dropped': q.replace(/\( SELECT has_feature_permission\('leads.view_all'::text\) AS has_feature_permission\) OR /, ''),
        'pipe gate inverted': q.replace('(cardinality(', '(NOT (cardinality(').replace('> 0) AND rls_lead_in_my_pipes', '> 0)) AND rls_lead_in_my_pipes'),
      };
      for (const [label, m] of Object.entries(mutations)) {
        assert.notEqual(m, q, `mutation '${label}' did not apply — the qual text changed, update the control`);
        let total = 0;
        for (const u of Object.values(ACTORS)) total += await rowDiff(db, u, before[POLICY_NAMES[0]].qual, m);
        assert.ok(total > 0, `positive control '${label}' was not detected`);
      }
    });

    await t.test('rollback restores the literal prod policies and the original rows', async () => {
      await db.exec(RB);
      const rb = await policies(db);
      for (const p of POLICY_NAMES) {
        assert.equal(rb[p].qual, before[p].qual);
        assert.equal(rb[p].roles, '{public}');
      }
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'rls\\_%'`)).rows[0].n, 0);
      for (const [name, u] of Object.entries(ACTORS)) assert.deepEqual(await visible(db, u), sel0[name], name);
      await db.exec(MIG); // forward again after rollback
    });
  } finally {
    await db.close();
  }
});
