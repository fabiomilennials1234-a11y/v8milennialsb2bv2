// Realtime Broadcast S1 (20271205000000): who joins org:{org}:pe, what the
// trigger publishes, and the transport plan the front reads.
//
// The skeleton (fixtures/realtime-broadcast-s1-baseline.sql) carries the prod
// bodies of the functions the join predicate calls; the first test pins them to
// prod (md5 of pg_get_functiondef, read 2026-10-19).
//
// The join is simulated the way Realtime authorizes a private channel: a probe
// message for the topic exists (inserted by the superuser, as Realtime does
// inside its own rolled-back transaction), `realtime.topic` is set, and the
// SELECT runs as `authenticated` WITH the user's JWT claims. 1 row = joins,
// 0 rows = refused. Every "refused" sits next to a positive control (someone
// who DOES join the same topic in the same setup), so a refusal can never be
// a broken harness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20271205000000_realtime_broadcast_s1_pipeline_entries.sql');
const RB = read('../../supabase/migrations/rollback/20271205000000_realtime_broadcast_s1_pipeline_entries.sql');
const SKELETON = read('./fixtures/realtime-broadcast-s1-baseline.sql');
const FRONT = read('../../src/shared/realtime/broadcastTransport.ts');

const PROD_MD5 = {
  'get_my_gestor_organization_ids()': 'a342535bf36d39ce5dba59fd8441e122',
  'get_my_member_organization_ids()': '2335cc678384684526a34e384bfc7d26',
  'get_my_organization_ids()': '72fb9e49c1956386ac3eca3d96325a5a',
  'is_master_user(uuid)': '0fdb47977f7bc6a3b19a4c892e350075',
  'org_access_blocked(uuid)': 'b9120fe946711aa617fc84ad921a11a7',
  'private.strict_lead_member_orgs()': 'c6b82ddf4b615caa60d0cd079f013f86',
  'realtime.send(jsonb,text,text,boolean)': '77afe4a67a0330f080cb562cec0898bd',
  'realtime.topic()': 'cd1d746eed2ae8a6e309899adfe95988',
};

const hex = (n) => n.toString(16).padStart(12, '0');
const ORG = {
  A: `0a000000-0000-0000-0000-${hex(1)}`,  // flag on
  B: `0a000000-0000-0000-0000-${hex(2)}`,  // flag on, other tenant
  S: `0a000000-0000-0000-0000-${hex(3)}`,  // flag on, strict_lead_owner_access
  X: `0a000000-0000-0000-0000-${hex(4)}`,  // flag on, suspended
  OFF: `0a000000-0000-0000-0000-${hex(5)}`, // flag off
};
const U = (n) => `0b000000-0000-0000-0000-${hex(n)}`;
const USERS = {
  memberA: 1, memberB: 2, adminS: 3, memberS: 4, memberX: 5, master: 6, gestorA: 7, inactiveA: 8,
  memberOFF: 9, outsider: 10,
};
const topic = (org) => `org:${org}:pe`;

function seed() {
  const s = [];
  const flag = (extra = {}) => `'${JSON.stringify({ realtime_broadcast_pe: true, ...extra })}'::jsonb`;
  s.push(`INSERT INTO organizations(id, subscription_status, feature_flags) VALUES
    ('${ORG.A}','active',${flag()}), ('${ORG.B}','active',${flag()}),
    ('${ORG.S}','active',${flag({ strict_lead_owner_access: true })}),
    ('${ORG.X}','suspended',${flag()}), ('${ORG.OFF}','active','{}'::jsonb);`);
  const tm = [
    ['memberA', 'A', 'member', true], ['memberB', 'B', 'member', true], ['adminS', 'S', 'admin', true],
    ['memberS', 'S', 'member', true], ['memberX', 'X', 'member', true], ['inactiveA', 'A', 'member', false],
    ['memberOFF', 'OFF', 'member', true],
  ];
  for (const [u, o, role, active] of tm) {
    s.push(`INSERT INTO team_members(user_id, organization_id, role, is_active) VALUES ('${U(USERS[u])}','${ORG[o]}','${role}',${active});`);
  }
  s.push(`INSERT INTO master_users(user_id, is_active) VALUES ('${U(USERS.master)}', true);`);
  s.push(`INSERT INTO gestores(id, user_id) VALUES ('0d000000-0000-0000-0000-000000000001','${U(USERS.gestorA)}');`);
  s.push(`INSERT INTO gestor_organizations(gestor_id, organization_id) VALUES ('0d000000-0000-0000-0000-000000000001','${ORG.A}');`);
  return s.join('\n');
}

const claimsSql = (u) =>
  u === null
    ? `SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`
    : `SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: U(USERS[u]), role: 'authenticated' })}', true)`;

/** Realtime's private-channel read check: probe row + topic + SELECT as the user. */
async function joins(db, u, t, { extension = 'broadcast', role = 'authenticated' } = {}) {
  await db.exec('BEGIN');
  try {
    await db.query(`INSERT INTO realtime.messages(topic, extension, payload, private) VALUES ($1, $2, '{}', true)`, [t, extension]);
    await db.exec(`${claimsSql(u)}; SELECT set_config('realtime.topic', '${t.replace(/'/g, "''")}', true); SET LOCAL ROLE ${role};`);
    const r = await db.query('SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1', [t]);
    return r.rows[0].n === 1;
  } finally {
    await db.exec('ROLLBACK');
  }
}

async function plan(db, u, org) {
  await db.exec('BEGIN');
  try {
    await db.exec(`${claimsSql(u)}; SET LOCAL ROLE ${u === null ? 'anon' : 'authenticated'};`);
    const r = await db.query('SELECT public.realtime_subscription_plan($1::uuid) AS p', [org]);
    return r.rows[0].p.pipeline_entries;
  } finally {
    await db.exec('ROLLBACK');
  }
}

async function messages(db) {
  const r = await db.query(`SELECT topic, event, private, extension, payload FROM realtime.messages ORDER BY ctid`);
  return r.rows;
}

/** Allowlist declared in the front — must equal the row the trigger serializes. */
function frontAllowlist() {
  const block = FRONT.match(/pipeline_entries:\s*\{[\s\S]*?columns:\s*\[([\s\S]*?)\]/);
  assert.ok(block, 'BROADCAST_TABLES.pipeline_entries.columns found in broadcastTransport.ts');
  return [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
}

test('realtime broadcast S1 — pipeline_entries', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(SKELETON);
    await db.exec(seed());

    await t.test('skeleton functions are the prod bodies', async () => {
      for (const [sig, md5] of Object.entries(PROD_MD5)) {
        const r = await db.query(`SELECT md5(pg_get_functiondef($1::regprocedure)) AS m`, [sig]);
        assert.equal(r.rows[0].m, md5, `${sig} drifted from prod`);
      }
    });

    await t.test('migration text: no ALTER TABLE on realtime.* (42501 aborts the txn in prod)', () => {
      const code = MIG.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
      assert.doesNotMatch(code, /ALTER\s+TABLE[^;]*realtime\./i);
      assert.doesNotMatch(code, /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      assert.match(code, /CREATE POLICY rt_broadcast_select\s+ON realtime\.messages/);
    });

    await t.test('before the migration nobody joins (0 policies)', async () => {
      assert.equal(await joins(db, 'memberA', topic(ORG.A)), false);
    });

    await db.exec(MIG);

    await t.test('policy shape: SELECT only, authenticated only', async () => {
      const r = await db.query(`SELECT policyname, cmd, roles::text AS roles, permissive FROM pg_policies WHERE schemaname='realtime' AND tablename='messages'`);
      assert.deepEqual(r.rows, [{ policyname: 'rt_broadcast_select', cmd: 'SELECT', roles: '{authenticated}', permissive: 'PERMISSIVE' }]);
    });

    await t.test('join matrix (each refusal next to a positive control on the same topic)', async () => {
      const cases = [
        // [who, org, expected]
        ['memberA', 'A', true],
        ['memberB', 'A', false], // other tenant
        ['memberB', 'B', true],  //   control: B's own member joins B
        ['memberA', 'B', false], //   and A's member does not
        ['gestorA', 'A', true],  // gestor of A (get_my_organization_ids includes it)
        ['gestorA', 'B', false],
        ['inactiveA', 'A', false], // inactive member
        ['adminS', 'S', true],   // strict org admin: not in strict_lead_member_orgs
        ['memberS', 'S', false], // strict org member: per-lead visibility, org-wide topic would leak
        ['memberX', 'X', false], // suspended org (org_access_blocked)
        ['master', 'A', false],  // master without membership: REST sees all, broadcast does not
        ['outsider', 'A', false],
        ['memberOFF', 'OFF', true], // flag does not gate the join; the plan + trigger do
      ];
      for (const [u, o, want] of cases) {
        assert.equal(await joins(db, u, topic(ORG[o])), want, `${u} → org ${o}`);
      }
    });

    await t.test('topic grammar is closed (default-deny), with control', async () => {
      assert.equal(await joins(db, 'memberA', topic(ORG.A)), true, 'control');
      for (const bad of [
        `${topic(ORG.A)}:x`, `org:${ORG.A}:wa`, `org:${ORG.A}`, `org:${ORG.A.toUpperCase()}:pe`,
        ` org:${ORG.A}:pe`, `org:${ORG.A}:pe\n`, 'org:not-a-uuid:pe', `lead:${ORG.A}`, '',
      ]) {
        assert.equal(await joins(db, 'memberA', bad), false, `refuses ${JSON.stringify(bad)}`);
      }
      // realtime.topic unset (NULL) while the probe row exists.
      await db.exec('BEGIN');
      await db.query(`INSERT INTO realtime.messages(topic, extension, payload, private) VALUES ($1, 'broadcast', '{}', true)`, [topic(ORG.A)]);
      await db.exec(`${claimsSql('memberA')}; SET LOCAL ROLE authenticated;`);
      const r = await db.query('SELECT count(*)::int AS n FROM realtime.messages');
      await db.exec('ROLLBACK');
      assert.equal(r.rows[0].n, 0, 'no realtime.topic → refused');
    });

    await t.test('rows of another topic stay hidden even with an authorized realtime.topic', async () => {
      await db.exec('BEGIN');
      await db.query(`INSERT INTO realtime.messages(topic, extension, payload, private) VALUES ($1, 'broadcast', '{}', true), ($2, 'broadcast', '{}', true)`, [topic(ORG.A), topic(ORG.B)]);
      await db.exec(`${claimsSql('memberA')}; SELECT set_config('realtime.topic', '${topic(ORG.A)}', true); SET LOCAL ROLE authenticated;`);
      const r = await db.query('SELECT topic FROM realtime.messages ORDER BY topic');
      await db.exec('ROLLBACK');
      assert.deepEqual(r.rows.map((x) => x.topic), [topic(ORG.A)], 'only A (control) — never B');
    });

    await t.test('presence extension is not authorized', async () => {
      assert.equal(await joins(db, 'memberA', topic(ORG.A), { extension: 'presence' }), false);
    });

    await t.test('anon: no policy, no rows (control: same topic joins as member)', async () => {
      assert.equal(await joins(db, 'memberA', topic(ORG.A)), true);
      assert.equal(await joins(db, null, topic(ORG.A), { role: 'anon' }), false);
      assert.equal(await joins(db, null, topic(ORG.A), { role: 'authenticated' }), false, 'authenticated without sub');
    });

    await t.test('clients cannot publish (no INSERT policy) — control: postgres can', async () => {
      await db.exec('BEGIN');
      await db.exec(`${claimsSql('memberA')}; SET LOCAL ROLE authenticated;`);
      await assert.rejects(
        db.query(`INSERT INTO realtime.messages(topic, extension, payload, private) VALUES ($1, 'broadcast', '{}', true)`, [topic(ORG.A)]),
        /row-level security/,
      );
      await db.exec('ROLLBACK');
      await db.exec('BEGIN');
      const r = await db.query(`INSERT INTO realtime.messages(topic, extension, payload, private) VALUES ($1, 'broadcast', '{}', true)`, [topic(ORG.A)]);
      assert.equal(r.affectedRows, 1);
      await db.exec('ROLLBACK');
    });

    await t.test('grants: only authenticated executes the predicate and the plan', async () => {
      const r = await db.query(`SELECT r.rolname,
          has_function_privilege(r.rolname, 'private.realtime_can_join(text)', 'execute') AS can_join,
          has_function_privilege(r.rolname, 'public.realtime_subscription_plan(uuid)', 'execute') AS plan,
          has_function_privilege(r.rolname, 'private.rt_broadcast_pipeline_entries()', 'execute') AS trg
        FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') ORDER BY 1`);
      assert.deepEqual(r.rows, [
        { rolname: 'anon', can_join: false, plan: false, trg: false },
        { rolname: 'authenticated', can_join: true, plan: true, trg: false },
        { rolname: 'service_role', can_join: false, plan: false, trg: false },
      ]);
      const d = await db.query(`SELECT proname, prosecdef, proconfig::text AS cfg FROM pg_proc
        WHERE proname IN ('realtime_can_join','realtime_subscription_plan','rt_broadcast_pipeline_entries') ORDER BY 1`);
      for (const row of d.rows) {
        assert.equal(row.prosecdef, true, `${row.proname} is SECURITY DEFINER`);
        assert.match(row.cfg, /^\{"?search_path=(""|\\"\\")"?\}$/, `${row.proname} pins search_path to ''`);
      }
    });

    await t.test('transport plan', async () => {
      assert.equal(await plan(db, 'memberA', ORG.A), 'broadcast');
      assert.equal(await plan(db, 'memberA', ORG.B), 'pg_changes', 'not an oracle for other orgs');
      assert.equal(await plan(db, 'memberB', ORG.B), 'broadcast', 'control');
      assert.equal(await plan(db, 'memberOFF', ORG.OFF), 'pg_changes', 'flag off');
      assert.equal(await plan(db, 'adminS', ORG.S), 'broadcast');
      assert.equal(await plan(db, 'memberS', ORG.S), 'pg_changes', 'strict member stays on postgres_changes');
      assert.equal(await plan(db, 'master', ORG.A), 'pg_changes');
      assert.equal(await plan(db, 'memberA', null), 'pg_changes');
      await db.exec('BEGIN');
      await db.exec(`${claimsSql(null)}; SET LOCAL ROLE anon;`);
      await assert.rejects(db.query('SELECT public.realtime_subscription_plan($1::uuid)', [ORG.A]), /permission denied/);
      await db.exec('ROLLBACK');
    });

    await t.test('trigger: publishes allowlisted row on the org topic, as the writing user', async () => {
      const id = '0f000000-0000-0000-0000-000000000001';
      const pipe = '0f100000-0000-0000-0000-000000000001';
      await db.exec('DELETE FROM realtime.messages');
      // Writes run as authenticated with claims: realtime.send is INVOKER and
      // would hit the RLS on realtime.messages; the trigger is DEFINER.
      await db.exec('BEGIN');
      await db.exec(`${claimsSql('memberA')}; SET LOCAL ROLE authenticated;`);
      await db.query(`INSERT INTO pipeline_entries(id, organization_id, pipeline_id, stage_key, notes, metadata)
        VALUES ($1, $2, $3, 'novo', 'cpf 123', '{"phone":"119"}')`, [id, ORG.A, pipe]);
      await db.query(`UPDATE pipeline_entries SET stage_key = 'qualificado' WHERE id = $1`, [id]);
      await db.query(`UPDATE pipeline_entries SET updated_at = now() + interval '1 s' WHERE id = $1`, [id]); // touch: no event
      await db.query(`UPDATE pipeline_entries SET notes = 'outra' WHERE id = $1`, [id]); // notes changed: event, notes not in payload
      await db.query(`DELETE FROM pipeline_entries WHERE id = $1`, [id]);
      await db.exec('COMMIT');

      const ms = await messages(db);
      assert.deepEqual(ms.map((m) => m.payload.op), ['INSERT', 'UPDATE', 'UPDATE', 'DELETE']);
      for (const m of ms) {
        assert.equal(m.topic, topic(ORG.A));
        assert.equal(m.event, 'pipeline_entries');
        assert.equal(m.private, true);
        assert.equal(m.extension, 'broadcast');
        assert.equal(m.payload.v, 1);
        assert.equal(m.payload.t, 'pipeline_entries');
        assert.equal(m.payload.id, id);
        for (const part of [m.payload.row, m.payload.old]) {
          if (part === null || part === undefined) continue;
          assert.deepEqual(Object.keys(part).sort(), frontAllowlist(), 'payload = allowlist (front and SQL agree)');
          assert.ok(!('notes' in part) && !('metadata' in part), 'no notes/metadata');
        }
      }
      assert.equal(ms[0].payload.row.stage_key, 'novo');
      assert.equal(ms[0].payload.old, null);
      assert.equal(ms[1].payload.row.stage_key, 'qualificado');
      assert.equal(ms[1].payload.old.stage_key, 'novo');
      assert.equal(ms[3].payload.row, null);
      assert.equal(ms[3].payload.old.pipeline_id, pipe);
      assert.ok(!JSON.stringify(ms).includes('cpf 123') && !JSON.stringify(ms).includes('"119"'));
    });

    await t.test('the published message is visible only to who joins the topic', async () => {
      // Realtime delivers what the joined user can SELECT on that topic: the
      // trigger's rows, read as A's member vs B's member.
      const read = async (u) => {
        await db.exec('BEGIN');
        await db.exec(`${claimsSql(u)}; SELECT set_config('realtime.topic', '${topic(ORG.A)}', true); SET LOCAL ROLE authenticated;`);
        const r = await db.query(`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1`, [topic(ORG.A)]);
        await db.exec('ROLLBACK');
        return r.rows[0].n;
      };
      assert.equal(await read('memberA'), 4, 'control: A member reads all 4');
      assert.equal(await read('memberB'), 0);
      assert.equal(await read('memberS'), 0);
    });

    await t.test('trigger: flag off, mute, org move', async () => {
      await db.exec('DELETE FROM realtime.messages');
      await db.query(`INSERT INTO pipeline_entries(organization_id, stage_key) VALUES ($1, 'x')`, [ORG.OFF]);
      assert.equal((await messages(db)).length, 0, 'flag off: nothing');
      await db.query(`INSERT INTO pipeline_entries(organization_id, stage_key) VALUES ($1, 'x')`, [ORG.A]);
      assert.equal((await messages(db)).length, 1, 'control: flag on publishes');

      await db.exec('DELETE FROM realtime.messages');
      await db.exec(`BEGIN; SET LOCAL app.rt_mute = 'on';`);
      await db.query(`INSERT INTO pipeline_entries(organization_id, stage_key) VALUES ($1, 'x')`, [ORG.A]);
      await db.exec('COMMIT');
      assert.equal((await messages(db)).length, 0, 'muted');

      const id = '0f000000-0000-0000-0000-000000000002';
      await db.query(`INSERT INTO pipeline_entries(id, organization_id, stage_key) VALUES ($1, $2, 'x')`, [id, ORG.A]);
      await db.exec('DELETE FROM realtime.messages');
      await db.query(`UPDATE pipeline_entries SET organization_id = $2 WHERE id = $1`, [id, ORG.B]);
      const ms = await messages(db);
      assert.deepEqual(ms.map((m) => [m.topic, m.payload.op]), [[topic(ORG.A), 'DELETE'], [topic(ORG.B), 'UPDATE']]);
      await db.exec('DELETE FROM realtime.messages');
      await db.query(`UPDATE pipeline_entries SET organization_id = $2 WHERE id = $1`, [id, ORG.OFF]);
      assert.deepEqual((await messages(db)).map((m) => [m.topic, m.payload.op]), [[topic(ORG.B), 'DELETE']], 'moving to a flag-off org: only the exit');
    });

    await t.test('positive control: an INVOKER trigger loses the event in silence', async () => {
      await db.exec('DELETE FROM realtime.messages');
      await db.exec('BEGIN; ALTER FUNCTION private.rt_broadcast_pipeline_entries() SECURITY INVOKER;');
      // Everything else the INVOKER body needs, so the only refusal left is the RLS one.
      await db.exec(`GRANT EXECUTE ON FUNCTION private.rt_pipeline_entry_row(public.pipeline_entries) TO authenticated;
        GRANT SELECT ON public.organizations TO authenticated;`);
      await db.exec(`${claimsSql('memberA')}; SET LOCAL ROLE authenticated;`);
      await db.query(`INSERT INTO pipeline_entries(organization_id, stage_key) VALUES ($1, 'x')`, [ORG.A]);
      await db.exec('RESET ROLE');
      assert.equal((await messages(db)).length, 0, 'RLS refused the insert; realtime.send swallowed it');
      await db.exec('ROLLBACK');
    });

    await t.test('positive control: a predicate without the strict clause is caught', async () => {
      await db.exec(`BEGIN;
        CREATE OR REPLACE FUNCTION private.realtime_can_join(p_topic text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
        AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.get_my_organization_ids() m(o) WHERE 'org:' || m.o || ':pe' = p_topic) $$;`);
      const leaked = await (async () => {
        await db.query(`INSERT INTO realtime.messages(topic, extension, payload, private) VALUES ($1, 'broadcast', '{}', true)`, [topic(ORG.S)]);
        await db.exec(`${claimsSql('memberS')}; SELECT set_config('realtime.topic', '${topic(ORG.S)}', true); SET LOCAL ROLE authenticated;`);
        const r = await db.query('SELECT count(*)::int AS n FROM realtime.messages WHERE topic = $1', [topic(ORG.S)]);
        return r.rows[0].n;
      })();
      await db.exec('ROLLBACK');
      assert.equal(leaked, 1, 'the broken predicate lets the strict member in — the matrix would catch it');
      assert.equal(await joins(db, 'memberS', topic(ORG.S)), false, 'real predicate restored');
    });

    await t.test('rollback removes everything; re-apply is clean', async () => {
      await db.exec(RB);
      const left = await db.query(`SELECT
          (SELECT count(*)::int FROM pg_policies WHERE schemaname='realtime') AS pols,
          (SELECT count(*)::int FROM pg_proc WHERE proname IN ('realtime_can_join','realtime_subscription_plan','rt_broadcast_pipeline_entries','rt_pipeline_entry_row')) AS fns,
          (SELECT count(*)::int FROM pg_trigger WHERE tgname LIKE 'zz_rt_broadcast%') AS trg`);
      assert.deepEqual(left.rows[0], { pols: 0, fns: 0, trg: 0 });
      assert.equal(await joins(db, 'memberA', topic(ORG.A)), false);
      await db.exec(MIG);
      assert.equal(await joins(db, 'memberA', topic(ORG.A)), true);
    });
  } finally {
    await db.close();
  }
});
