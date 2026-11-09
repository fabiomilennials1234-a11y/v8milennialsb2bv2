import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let db;
const query = (text, params = []) => db.query(text, params);
const one = async (text, params = []) => (await query(text, params)).rows[0];
const login = async (user = 1, role = 'authenticated') => {
  await db.exec('RESET ROLE');
  await query("select set_config('request.jwt.claim.sub', $1, false)", [user ? id(user) : '']);
  await db.exec('SET ROLE ' + role);
};
const rpc = async (kind, disabled = false, target = 30) => {
  if (kind === 'phone') return query('select toggle_phone_ai($1, $2, $3)', [target === 30 ? '+55 (11) 98765-4321' : '21987654321', disabled, id(10)]);
  return query('select ' + (kind === 'master' ? 'master_set_copilot_disabled' : 'toggle_lead_ai') + '($1, $2)', [id(target), disabled]);
};
const pauseRows = async () => (await query('select organization_id, normalized_phone, ai_disabled, human_paused_until from phone_ai_preferences order by organization_id, normalized_phone')).rows;

before(async () => {
  db = new PGlite();
  await db.exec(sql('tests/fixtures/copilot-reactivation-schema.sql'));
  await db.exec(process.env.COPILOT_REACTIVATION_SQL
    ? readFileSync(process.env.COPILOT_REACTIVATION_SQL, 'utf8')
    : sql('supabase/migrations/20271230000000_copilot_explicit_reactivation_clears_pause.sql'));
  // Reproduce production EXECUTE ACLs; the migration must not expand them.
  await db.exec('REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role');
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('RESET ROLE; TRUNCATE conversations,leads,team_members,master_users,phone_ai_preferences,lead_history,master_audit_logs');
  await query('insert into team_members(id, organization_id, user_id, name) values($1,$2,$3,$4)', [id(11), id(10), id(1), 'Operador']);
  await query('insert into master_users(id,user_id) values($1,$2)', [id(12), id(2)]);
  // Two leads sharing a phone in A, another phone in A, and the same phone in B.
  for (const [lead, org, phone] of [[30,10,'11987654321'],[31,10,'11987654321'],[32,10,'21987654321'],[90,90,'11987654321'],[33,10,null]]) {
    await query('insert into leads(id,organization_id,normalized_phone,ai_disabled) values($1,$2,$3,true)', [id(lead),id(org),phone]);
    await query("insert into conversations(id,organization_id,lead_id,state,human_paused_until) values($1,$2,$3,'WAITING_HUMAN',now()+interval '1 hour')", [id(lead+100),id(org),id(lead)]);
    if (phone) await query("insert into phone_ai_preferences(organization_id,normalized_phone,ai_disabled,human_paused_until) values($1,$2,true,now()+interval '1 hour') on conflict do nothing", [id(org),phone]);
  }
});

for (const kind of ['lead', 'phone', 'master']) {
  test(kind + ': explicit activation clears both pauses, synchronizes duplicates, preserves other phone/org and audit', async () => {
    await login(kind === 'master' ? 2 : 1);
    await rpc(kind);
    const prefs = await pauseRows();
    assert.equal(prefs[0].human_paused_until, null);
    assert.equal(prefs[0].ai_disabled, false);
    assert.ok(prefs[1].human_paused_until);
    assert.ok(prefs[2].human_paused_until);
    const rows = (await query('select * from conversations order by lead_id')).rows;
    for (const row of rows.filter(r => [id(30),id(31)].includes(r.lead_id))) {
      assert.equal(row.human_paused_until, null);
      assert.equal(row.state, 'QUALIFYING');
    }
    assert.ok(rows.filter(r => ![id(30),id(31)].includes(r.lead_id)).every(r => r.human_paused_until && r.state === 'WAITING_HUMAN'));
    assert.equal((await one('select count(*)::int n from leads where not ai_disabled')).n, 2);
    const history = await one("select * from lead_history where lead_id=$1 and action='ai_reactivated'", [id(30)]);
    assert.equal(history.metadata.reactivated_by, id(kind === 'master' ? 2 : 1));
    if (kind === 'master') assert.equal((await one("select count(*)::int n from master_audit_logs where action='copilot_enabled'")).n, 1);
  });

  test(kind + ': disabling preserves the temporary pause and waiting state', async () => {
    const before = await pauseRows();
    await login(kind === 'master' ? 2 : 1);
    await rpc(kind, true);
    assert.deepEqual(await pauseRows(), before);
    assert.equal((await one("select count(*)::int n from conversations where state='WAITING_HUMAN' and human_paused_until is not null")).n, 5);
  });

  test(kind + ': unauthenticated and unauthorized callers cannot clear pauses', async () => {
    const before = await pauseRows();
    await login(null);
    await assert.rejects(() => rpc(kind), /Not authenticated/);
    await login(kind === 'master' ? 1 : 9);
    await assert.rejects(() => rpc(kind), /not an active (member|master)/);
    assert.deepEqual(await pauseRows(), before);
    await login(null, 'anon');
    await assert.rejects(() => rpc(kind), /permission denied/);
  });
}

test('phone: activation works before any lead or conversation exists', async () => {
  await db.exec("delete from conversations where lead_id='" + id(32) + "'; delete from leads where id='" + id(32) + "'");
  await login();
  const result = (await one('select toggle_phone_ai($1,false,$2) result', ['21987654321',id(10)])).result;
  assert.equal(result.affected_leads, 0);
  assert.equal((await one('select human_paused_until from phone_ai_preferences where organization_id=$1 and normalized_phone=$2',[id(10),'21987654321'])).human_paused_until, null);
});

for (const kind of ['lead','master']) {
  test(kind + ': a lead without a phone clears only its own conversation pause', async () => {
    const before = await pauseRows();
    await login(kind === 'master' ? 2 : 1);
    await rpc(kind,false,33);
    assert.deepEqual(await pauseRows(),before);
    assert.equal((await one('select human_paused_until from conversations where lead_id=$1',[id(33)])).human_paused_until,null);
    assert.equal((await one('select count(*)::int n from conversations where human_paused_until is not null')).n,4);
  });
}

test('lead: active membership in a different org cannot enable the target lead', async () => {
  await login();
  await assert.rejects(() => rpc('lead',false,90), /not an active member/);
  assert.equal((await one('select ai_disabled from leads where id=$1',[id(90)])).ai_disabled,true);
});

test('phone: invalid numbers and inactive membership do not clear pauses', async () => {
  await query('update team_members set is_active=false');
  await login();
  await assert.rejects(() => rpc('phone'), /not an active member/);
  await db.exec('RESET ROLE; update team_members set is_active=true');
  await login();
  await assert.rejects(() => query('select toggle_phone_ai($1,false,$2)',['abc',id(10)]), /Invalid phone number/);
  assert.ok((await pauseRows()).every(r => r.human_paused_until));
});
