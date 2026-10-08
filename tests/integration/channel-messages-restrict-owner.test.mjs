// channel_messages RLS (20271107160000): chat_restrict_to_owner stops being decorative.
//
// The skeleton (fixtures/channel-messages-rls-baseline.sql) carries the prod
// bodies of the functions the policies call and the prod text of the 5
// channel_messages policies; the first test pins both to prod (md5 of
// pg_get_functiondef and pg_policies.qual, read 2026-10-06).
//
// For 15 actors × 6 orgs (restricted / unrestricted / suspended), the exact ids
// visible as `authenticated` with claims are taken before the migration, after
// it, and after the rollback. Proven:
//   1. leak reproduced before: non-responsible member of a restricted org reads
//      a colleague's messages;
//   2. after = before ∩ (org unrestricted ∨ can_see_chat_scope ∨ master), per
//      row — the whatsapp_messages semantics, nothing else moves;
//   3. nobody gains a row; unrestricted orgs are byte-identical for everyone;
//   4. hand-written expectations per role (independent of the functions);
//   5. rollback restores the policy text and the visible sets;
//   6. positive controls: two broken variants of the new policy MUST fail (2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20271107160000_channel_messages_restrict_to_owner.sql');
const RB = read('../../supabase/migrations/rollback/20271107160000_channel_messages_restrict_to_owner.sql');
const SKELETON = read('./fixtures/channel-messages-rls-baseline.sql');

const PROD_MD5 = {
  'can_see_chat_scope(uuid,uuid,text)': '60c63e8d04c48f8dd2c7cdd288f5c806',
  'get_my_gestor_organization_ids()': 'a342535bf36d39ce5dba59fd8441e122',
  'get_my_member_organization_ids()': '2335cc678384684526a34e384bfc7d26',
  'get_my_organization_ids()': '72fb9e49c1956386ac3eca3d96325a5a',
  'is_master_user(uuid)': '0fdb47977f7bc6a3b19a4c892e350075',
  'normalize_brazilian_phone(text)': '019f20a0c1155f127846684189247b84',
  'org_access_blocked(uuid)': 'b9120fe946711aa617fc84ad921a11a7',
  'private.chat_scope_for_recipient(uuid,uuid,uuid,text)': '5ed2341d89f0a30ee9d72ccc31535198',
};
// pg_policies.qual in prod, 2026-10-06
const PROD_QUAL = {
  channel_messages_org_access: '(organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids))',
  channel_messages_select_by_owner: '((organization_id IN ( SELECT get_my_organization_ids() AS get_my_organization_ids)) AND can_see_chat_scope(organization_id, lead_id, normalize_brazilian_phone(phone_number)))',
};

const hex = (n) => n.toString(16).padStart(12, '0');
const ORG = {
  R: `0a000000-0000-0000-0000-${hex(1)}`,  // restricted, active  (Riofix-like)
  R2: `0a000000-0000-0000-0000-${hex(2)}`, // restricted, active, other tenant
  N: `0a000000-0000-0000-0000-${hex(3)}`,  // unrestricted, active
  N2: `0a000000-0000-0000-0000-${hex(4)}`, // unrestricted, active, other tenant
  S: `0a000000-0000-0000-0000-${hex(5)}`,  // restricted, suspended (Pinheiros-like)
  NS: `0a000000-0000-0000-0000-${hex(6)}`, // unrestricted, suspended
};
const RESTRICTED = new Set([ORG.R, ORG.R2, ORG.S]);
const U = (n) => `0b000000-0000-0000-0000-${hex(n)}`;
const T = {}; let tn = 0;
const tm = (name) => (T[name] ??= `0c000000-0000-0000-0000-${hex(++tn)}`);
// [team_member, user, org, role, is_active]
const TMS = [
  ['t3', 3, 'R', 'admin', true],
  ['t4n', 4, 'N', 'admin', true], ['t4r', 4, 'R', 'member', true],
  ['t5', 5, 'R', 'member', true], ['t6', 6, 'R', 'member', true], ['t7', 7, 'R', 'member', true],
  ['t8', 8, 'R', 'member', true], ['t9', 9, 'N', 'member', true], ['t10', 10, 'R', 'member', false],
  ['t11', 11, 'S', 'member', true], ['t13r', 13, 'R', 'member', true], ['t13n', 13, 'N', 'member', true],
  ['t14', 14, 'R2', 'member', true], ['t15', 15, 'R', 'member', true], ['tN2', 92, 'N2', 'member', true],
];
const ACTORS = {
  U1_master: 1, U2_gestor_of_R_and_N: 2, U3_admin_R: 3, U4_admin_N_member_R: 4, U5_view_all_R: 5,
  U6_view_unassigned_R: 6, U7_responsible_R: 7, U8_mostly_not_responsible_R: 8, U9_member_N: 9,
  U10_inactive_R: 10, U11_member_suspended_S: 11, U12_outsider: 12, U13_member_R_and_N: 13,
  U14_member_R2: 14, U15_user_roles_admin_member_R: 15,
};

// leads: [key, org, deleted, {pre,sale,sdr,closer}]
const LEADS = [
  ['L7', 'R', false, { pre: 't7' }], ['L78', 'R', false, { sdr: 't7', closer: 't8' }],
  ['L8', 'R', false, { sale: 't8' }], ['Lun', 'R', false, {}], ['Ldel', 'R', true, { pre: 't7' }],
  ['L3', 'R', false, { pre: 't3' }], ['L4', 'R', false, { closer: 't4r' }],
  ['Lr2', 'R2', false, { pre: 't14' }], ['Lr2u', 'R2', false, {}],
  ['Ln', 'N', false, { pre: 't9' }], ['Lnu', 'N', false, {}], ['Ln2', 'N2', false, { pre: 'tN2' }],
  ['Ls', 'S', false, { pre: 't11' }], ['Lns', 'NS', false, {}],
];
const L = {}; const PHONE = {};
LEADS.forEach(([k], i) => { L[k] = `0e000000-0000-0000-0000-${hex(i + 1)}`; PHONE[k] = `1199${String(i + 1).padStart(7, '0')}`; });

// messages: [key, org, lead_id|null, phone|null, instance?]
function messages() {
  const m = [];
  for (const [k, o] of LEADS) {
    m.push([`${k}:lead`, o, L[k], null, false]);                     // linked by lead_id
    m.push([`${k}:phone`, o, null, `+55 ${PHONE[k]}`, false]);       // linked by phone (normalized)
  }
  for (const o of Object.keys(ORG)) {
    m.push([`${o}:ig1`, o, null, null, false]);                      // Instagram: no lead, no phone
    m.push([`${o}:ig2`, o, null, null, false]);
    m.push([`${o}:nophone`, o, null, '+55 21900000000', false]);     // phone of nobody
  }
  m.push(['L7:inst', 'R', L.L7, null, true]);                        // RESTRICTIVE box policy bites
  m.push(['L8:lead+L7phone', 'R', L.L8, `+55 ${PHONE.L7}`, false]); // lead_id wins over phone
  return m;
}
const MSGS = messages();
const MID = Object.fromEntries(MSGS.map(([k], i) => [k, `0f000000-0000-0000-0000-${hex(i + 1)}`]));
const KEY = Object.fromEntries(Object.entries(MID).map(([k, v]) => [v, k]));

function fixtures() {
  const s = [];
  s.push(`INSERT INTO organizations(id,subscription_status,billing_override,chat_restrict_to_owner) VALUES
    ('${ORG.R}','active',false,true),('${ORG.R2}','active',false,true),('${ORG.N}','active',false,false),
    ('${ORG.N2}','trial',false,false),('${ORG.S}','suspended',false,true),('${ORG.NS}','suspended',false,false);`);
  for (const [n, u, o, r, a] of TMS) s.push(`INSERT INTO team_members(id,user_id,organization_id,role,is_active) VALUES ('${tm(n)}','${U(u)}','${ORG[o]}','${r}',${a});`);
  s.push(`INSERT INTO master_users(user_id,is_active) VALUES ('${U(1)}',true);`);
  s.push(`INSERT INTO gestores(id,user_id,is_active) VALUES ('0d000000-0000-0000-0000-000000000001','${U(2)}',true);`);
  s.push(`INSERT INTO gestor_organizations(gestor_id,organization_id) VALUES
    ('0d000000-0000-0000-0000-000000000001','${ORG.R}'),('0d000000-0000-0000-0000-000000000001','${ORG.N}');`);
  s.push(`INSERT INTO user_roles(user_id,role) VALUES ('${U(15)}','admin');`);
  s.push(`INSERT INTO member_feature_permissions(team_member_id,feature_key,enabled) VALUES
    ('${tm('t5')}','leads.view_all',true),('${tm('t6')}','leads.view_unassigned',true),
    ('${tm('t8')}','leads.view_all',false),('${tm('t9')}','leads.view_all',false);`);
  const q = (v) => (v ? `'${tm(v)}'` : 'NULL');
  for (const [k, o, del, r] of LEADS) {
    s.push(`INSERT INTO leads(id,organization_id,deleted_at,normalized_phone,pre_sale_responsible_id,sale_responsible_id,sdr_id,closer_id)
      VALUES ('${L[k]}','${ORG[o]}',${del ? 'now()' : 'NULL'},'${PHONE[k]}',${q(r.pre)},${q(r.sale)},${q(r.sdr)},${q(r.closer)});`);
  }
  for (const [k, o, lead, phone, inst] of MSGS) {
    s.push(`INSERT INTO channel_messages(id,organization_id,instance_id,lead_id,phone_number,content) VALUES
      ('${MID[k]}','${ORG[o]}',${inst ? "'0aaaaaaa-0000-0000-0000-000000000001'" : 'NULL'},${lead ? `'${lead}'` : 'NULL'},${phone ? `'${phone}'` : 'NULL'},'x');`);
  }
  return s.join('\n');
}

const claims = (u) => `SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: U(u), role: 'authenticated' })}', false)`;

async function visible(db, u) {
  await db.exec(`RESET ROLE; ${claims(u)}; SET ROLE authenticated;`);
  const r = await db.query('SELECT id FROM channel_messages ORDER BY id');
  await db.exec('RESET ROLE');
  return r.rows.map((x) => x.id);
}
async function snapshot(db) {
  const out = {};
  for (const [name, u] of Object.entries(ACTORS)) out[name] = await visible(db, u);
  return out;
}
// The target semantics, evaluated row by row as superuser with the actor's claims:
// whatever was visible before AND (org unrestricted OR can_see_chat_scope OR master).
async function oracle(db, u, beforeIds) {
  await db.exec(`RESET ROLE; ${claims(u)}`);
  const r = await db.query(`SELECT m.id FROM channel_messages m JOIN organizations o ON o.id = m.organization_id
     WHERE m.id = ANY($1::uuid[])
       AND (NOT o.chat_restrict_to_owner
            OR public.is_master_user()
            OR public.can_see_chat_scope(m.organization_id, m.lead_id, public.normalize_brazilian_phone(m.phone_number)))
     ORDER BY m.id`, [beforeIds]);
  return r.rows.map((x) => x.id);
}
async function policies(db) {
  const r = await db.query(`SELECT policyname, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies
    WHERE tablename = 'channel_messages' ORDER BY policyname`);
  return r.rows;
}
const keys = (ids) => ids.map((id) => KEY[id]).sort();
const orgOf = Object.fromEntries(MSGS.map(([k, o]) => [MID[k], ORG[o]]));
const inOrgs = (ids, orgs) => ids.filter((id) => orgs.includes(orgOf[id]));
const UNRESTRICTED = [ORG.N, ORG.N2, ORG.NS];

async function assertTargetSemantics(db, before, after) {
  for (const [name, u] of Object.entries(ACTORS)) {
    assert.deepEqual(after[name], await oracle(db, u, before[name]), `${name}: after != before ∩ scope`);
    assert.ok(after[name].every((id) => before[name].includes(id)), `${name}: gained a row`);
    assert.deepEqual(inOrgs(after[name], UNRESTRICTED), inOrgs(before[name], UNRESTRICTED), `${name}: unrestricted org moved`);
  }
}

test('channel_messages: chat_restrict_to_owner enforced, everything else unchanged', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(SKELETON);

    await t.test('fixture is prod: function md5 and policy text', async () => {
      const r = await db.query(`SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5
        FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)`);
      const got = Object.fromEntries(r.rows.map((x) => [x.sig, x.md5]));
      for (const [sig, md5] of Object.entries(PROD_MD5)) assert.equal(got[sig], md5, `${sig} drifted from prod`);
      const p = Object.fromEntries((await policies(db)).map((x) => [x.policyname, x.qual]));
      for (const [n, q] of Object.entries(PROD_QUAL)) assert.equal(p[n], q, `${n} text drifted from prod`);
    });

    await db.exec(fixtures());
    const before = await snapshot(db);
    const polBefore = await policies(db);

    await t.test('leak reproduced on the prod policies (positive control of the bug)', () => {
      const k8 = keys(before.U8_mostly_not_responsible_R);
      for (const leaked of ['L7:lead', 'L7:phone', 'Lun:lead', 'L3:lead', 'R:ig1']) assert.ok(k8.includes(leaked), `U8 should read ${leaked} today`);
      assert.ok(keys(before.U13_member_R_and_N).includes('L7:lead'));
      assert.ok(!keys(before.U8_mostly_not_responsible_R).includes('L7:inst'), 'RESTRICTIVE box policy in force');
    });

    await db.exec(MIG);
    const after = await snapshot(db);

    await t.test('catalog: one scoped SELECT policy TO authenticated, helper locked down', async () => {
      const p = await policies(db);
      assert.deepEqual(p.map((x) => x.policyname), ['channel_messages_instance_read_access', 'channel_messages_select_by_owner',
        'channel_messages_service_role', 'master_all_channel_messages']);
      const sel = p.find((x) => x.policyname === 'channel_messages_select_by_owner');
      assert.equal(sel.roles, '{authenticated}');
      assert.equal(sel.permissive, 'PERMISSIVE');
      assert.match(sel.qual, /SELECT private\.chat_unrestricted_org_ids\(\)/);
      for (const x of p.filter((y) => y.policyname !== 'channel_messages_select_by_owner')) {
        assert.deepEqual(x, polBefore.find((y) => y.policyname === x.policyname), `${x.policyname} must be untouched`);
      }
      const h = (await db.query(`SELECT p.prosecdef, p.provolatile, p.proconfig::text AS cfg, p.proacl::text AS acl,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
          has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
        FROM pg_proc p WHERE p.oid = 'private.chat_unrestricted_org_ids()'::regprocedure`)).rows[0];
      assert.ok(h.prosecdef && h.provolatile === 's', 'STABLE SECURITY DEFINER');
      assert.match(h.cfg, /search_path=/);
      assert.ok(h.auth_x && !h.anon_x && !h.svc_x, 'EXECUTE only for authenticated');
      assert.doesNotMatch(h.acl, /(^|[{,])=X/, 'not executable by PUBLIC');
    });

    await t.test('per row: after = before ∩ (unrestricted ∨ can_see_chat_scope ∨ master); no gain; unrestricted orgs identical', async () => {
      await assertTargetSemantics(db, before, after);
    });

    await t.test('hand-written expectations per role', () => {
      const R = (name) => keys(inOrgs(after[name], [ORG.R]));
      const allR = (name) => keys(inOrgs(before[name], [ORG.R]));
      // keep everything
      for (const n of ['U1_master', 'U3_admin_R', 'U4_admin_N_member_R', 'U5_view_all_R', 'U15_user_roles_admin_member_R', 'U9_member_N']) {
        assert.deepEqual(after[n], before[n], `${n} unchanged`);
        if (n !== 'U9_member_N') assert.ok(R(n).length > 0);
      }
      assert.ok(after.U9_member_N.length > 0);
      // responsible: own leads (lead_id or phone), never deleted, never IG, never colleague
      assert.deepEqual(R('U7_responsible_R'), ['L78:lead', 'L78:phone', 'L7:lead', 'L7:phone']);
      assert.deepEqual(R('U8_mostly_not_responsible_R'), ['L78:lead', 'L78:phone', 'L8:lead', 'L8:lead+L7phone', 'L8:phone']);
      assert.deepEqual(R('U6_view_unassigned_R'), ['Lun:lead', 'Lun:phone']);
      assert.deepEqual(R('U13_member_R_and_N'), []);
      assert.ok(allR('U13_member_R_and_N').length > 0);
      assert.deepEqual(inOrgs(after.U13_member_R_and_N, [ORG.N]), inOrgs(before.U13_member_R_and_N, [ORG.N]));
      // R2: only own lead; N2/R tenants never cross
      assert.deepEqual(keys(after.U14_member_R2), ['Lr2:lead', 'Lr2:phone']);
      // gestor (not a team_member): restricted org closes, unrestricted unchanged — same as whatsapp_messages
      assert.deepEqual(R('U2_gestor_of_R_and_N'), []);
      assert.ok(allR('U2_gestor_of_R_and_N').length > 0);
      assert.deepEqual(inOrgs(after.U2_gestor_of_R_and_N, [ORG.N]), inOrgs(before.U2_gestor_of_R_and_N, [ORG.N]));
      assert.ok(inOrgs(after.U2_gestor_of_R_and_N, [ORG.N]).length > 0);
      // nothing before, nothing after
      for (const n of ['U10_inactive_R', 'U11_member_suspended_S', 'U12_outsider']) {
        assert.deepEqual(before[n], []); assert.deepEqual(after[n], []);
      }
      // box RESTRICTIVE still bites non-admins
      assert.ok(!keys(after.U7_responsible_R).includes('L7:inst'));
      assert.ok(keys(after.U3_admin_R).includes('L7:inst'));
    });

    await t.test('performance: helper once per query; per-row DEFINER only in restricted orgs', async () => {
      await db.exec('RESET ROLE; SET track_functions = \'all\'');
      const calls = async (u, org) => {
        const n = async () => {
          await db.exec('SELECT pg_stat_force_next_flush()'); await db.exec('SELECT pg_stat_clear_snapshot()');
          const r = (await db.query(`SELECT funcname, calls::int FROM pg_stat_user_functions
            WHERE funcname IN ('can_see_chat_scope', 'chat_unrestricted_org_ids')`)).rows;
          return Object.fromEntries(r.map((x) => [x.funcname, x.calls]));
        };
        const a = await n();
        await db.exec(`${claims(u)}; SET ROLE authenticated;`);
        const rows = (await db.query(`SELECT id FROM channel_messages WHERE organization_id = '${org}'`)).rows.length;
        await db.exec('RESET ROLE');
        const b = await n();
        const d = (f) => (b[f] ?? 0) - (a[f] ?? 0);
        return { rows, scope: d('can_see_chat_scope'), helper: d('chat_unrestricted_org_ids') };
      };
      const n = await calls(9, ORG.N);
      assert.ok(n.rows > 0);
      assert.equal(n.helper, 1, 'helper is an InitPlan: one call per query');
      assert.equal(n.scope, 0, 'unrestricted org: zero per-row can_see_chat_scope');
      const r = await calls(8, ORG.R);
      assert.ok(r.scope > 0, 'restricted org: per-row scope check runs (control)');
      await db.exec('RESET track_functions');
    });

    await t.test('anon: no grant, no rows', async () => {
      await db.exec(`SELECT set_config('request.jwt.claims','{"role":"anon"}',false); SET ROLE anon;`);
      await assert.rejects(db.query('SELECT id FROM channel_messages'), /permission denied/);
      await db.exec('RESET ROLE');
    });

    await t.test('rollback: policy text and visible sets back to prod', async () => {
      await db.exec(RB);
      assert.deepEqual(await policies(db), polBefore);
      assert.deepEqual(await snapshot(db), before);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'chat_unrestricted_org_ids'`)).rows[0].n, 0);
      await db.exec(MIG);
      assert.deepEqual(await snapshot(db), after, 're-apply is deterministic');
    });

    await t.test('positive controls: broken variants of the policy are caught', async () => {
      const variants = {
        'fast path ignores the restriction': `CREATE OR REPLACE FUNCTION private.chat_unrestricted_org_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
          AS $$ SELECT COALESCE(array_agg(m.org_id), ARRAY[]::uuid[]) FROM public.get_my_organization_ids() AS m(org_id) $$;`,
        'fast path ignores the tenant': `CREATE OR REPLACE FUNCTION private.chat_unrestricted_org_ids() RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
          AS $$ SELECT COALESCE(array_agg(o.id), ARRAY[]::uuid[]) FROM public.organizations o WHERE NOT o.chat_restrict_to_owner $$;`,
      };
      for (const [label, sql] of Object.entries(variants)) {
        await db.exec(`BEGIN; ${sql}`);
        const broken = await snapshot(db);
        await assert.rejects(assertTargetSemantics(db, before, broken), assert.AssertionError, `${label} must be caught`);
        await db.exec('ROLLBACK');
      }
      assert.deepEqual(await snapshot(db), after, 'controls left no residue');
    });
  } finally {
    await db.close();
  }
});
