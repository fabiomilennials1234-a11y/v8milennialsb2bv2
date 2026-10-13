// Handoff pegajoso (H2) — 20271120000000 + scripts/copilot-handoff-backfill-20271120.sql, em PGlite.
//
// O esqueleto (fixtures/copilot-handoff-baseline.sql) carrega os corpos de
// PROD das funções envolvidas; o 1º teste prende os dois alvos ao md5 de prod
// (pg_get_functiondef, lido em 2026-10-13). Provado:
//   1. red de hoje: RPC num lead "travado" (lead off, preferência on) NÃO
//      desliga a preferência — e a migration corrige;
//   2. RPC em lead novo grava pref off + 'handoff' + set_at do desligamento;
//   3. virada da flag sem ai_disabled_by → 'handoff'; com usuário → NULL;
//      religar → NULL;
//   4. RPC sobre desligamento manual/bulk preserva set_by/set_at/motivo;
//   5. lead sem normalized_phone: sem upsert, sem erro;
//   6. ACL/prosecdef/proconfig preservados; reaplicar a migration é no-op;
//   7. guarda da religação (`disabled_reason IS NULL`) não religa handoff;
//   8. backfill B1/B2a/B2b com controles; rodar 2× = mesmo estado.
//
// Rodar: node --test tests/integration/copilot-handoff-sticky.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIG = read('../../supabase/migrations/20271120000000_copilot_handoff_disabled_reason.sql');
const BACKFILL = read('../../scripts/copilot-handoff-backfill-20271120.sql');
const RB = read('../../supabase/migrations/rollback/20271120000000_copilot_handoff_disabled_reason.sql');
const SKELETON = read('./fixtures/copilot-handoff-baseline.sql');

const PROD_MD5 = {
  'transfer_lead_to_human(uuid)': '3b7c391d7722f94df9417435f5e71777',
  'sync_lead_ai_to_preferences()': '072d1c5e311582643fc13685ae28d1f8',
  'sync_ai_state_from_preferences()': '1b20534ec18e1716c5d063977c7fd2f6',
  'update_updated_at()': '79badfc0cc10f9cd17c33b7d71702a6e',
};

const ORG = '0a000000-0000-0000-0000-000000000001';
const USER = '0b000000-0000-0000-0000-000000000001';
const T0 = '2026-06-01T10:00:00+00';

async function fresh({ migrate = true } = {}) {
  const db = new PGlite();
  await db.exec(SKELETON);
  await db.query('INSERT INTO public.organizations (id) VALUES ($1)', [ORG]);
  await db.query('INSERT INTO auth.users (id) VALUES ($1)', [USER]);
  if (migrate) await db.exec(MIG);
  return db;
}

let seq = 0;
async function lead(db, { phone = `119${String(++seq).padStart(8, '0')}`, aiDisabled = false, at = null, by = null, deleted = false, created = null } = {}) {
  const { rows } = await db.query(
    `INSERT INTO public.leads (organization_id, normalized_phone, ai_disabled, ai_disabled_at, ai_disabled_by, deleted_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now())) RETURNING id`,
    [ORG, phone, aiDisabled, at, by, deleted ? new Date().toISOString() : null, created],
  );
  return { id: rows[0].id, phone };
}
async function pref(db, phone, { aiDisabled, setBy = null, setAt = T0, reason = undefined }) {
  const cols = ['organization_id', 'normalized_phone', 'ai_disabled', 'set_by', 'set_at'];
  const vals = [ORG, phone, aiDisabled, setBy, setAt];
  if (reason !== undefined) { cols.push('disabled_reason'); vals.push(reason); }
  await db.query(
    `INSERT INTO public.phone_ai_preferences (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})`,
    vals,
  );
}
async function conv(db, leadId, state) {
  await db.query('INSERT INTO public.conversations (lead_id, state) VALUES ($1, $2)', [leadId, state]);
}
const getPref = async (db, phone) =>
  (await db.query(
    `SELECT ai_disabled, set_by, set_at::text AS set_at, ${'disabled_reason'} AS reason
       FROM public.phone_ai_preferences WHERE organization_id = $1 AND normalized_phone = $2`,
    [ORG, phone],
  )).rows[0] ?? null;
const getLead = async (db, id) =>
  (await db.query('SELECT ai_disabled, ai_disabled_at::text AS ai_disabled_at FROM public.leads WHERE id = $1', [id])).rows[0];
const rpc = (db, id) => db.query('SELECT public.transfer_lead_to_human($1)', [id]);

test('esqueleto = prod (md5 de pg_get_functiondef)', async () => {
  const db = await fresh({ migrate: false });
  const { rows } = await db.query(`
    SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'`);
  const got = Object.fromEntries(rows.map((r) => [r.sig, r.md5]));
  for (const [sig, md5] of Object.entries(PROD_MD5)) assert.equal(got[sig], md5, sig);
});

test('RED de hoje: RPC em lead travado não desliga a preferência (sem a migration)', async () => {
  const db = await fresh({ migrate: false });
  const l = await lead(db, { aiDisabled: true, at: '2026-09-01T00:00:00+00' });
  await db.query('INSERT INTO public.phone_ai_preferences (organization_id, normalized_phone, ai_disabled, set_at) VALUES ($1,$2,false,$3)', [ORG, l.phone, T0]);
  await rpc(db, l.id);
  const p = (await db.query('SELECT ai_disabled FROM public.phone_ai_preferences WHERE normalized_phone = $1', [l.phone])).rows[0];
  assert.equal(p.ai_disabled, false, 'controle positivo: o defeito existe no baseline');
});

test('RPC em lead novo: pref off + handoff + set_at do desligamento; set_by NULL', async () => {
  const db = await fresh();
  const l = await lead(db);
  await rpc(db, l.id);
  const p = await getPref(db, l.phone);
  const ld = await getLead(db, l.id);
  assert.equal(p.ai_disabled, true);
  assert.equal(p.reason, 'handoff');
  assert.equal(p.set_by, null);
  assert.equal(p.set_at, ld.ai_disabled_at);
  assert.equal(ld.ai_disabled, true);
});

test('RPC em lead travado (lead off, pref on): desliga a pref com handoff e set_at novo', async () => {
  const db = await fresh();
  const l = await lead(db, { aiDisabled: true, at: '2026-09-01T00:00:00+00' });
  await pref(db, l.phone, { aiDisabled: false, setAt: T0 });
  await db.exec('BEGIN');
  await rpc(db, l.id);
  const now = (await db.query('SELECT now()::text AS now')).rows[0].now;
  const p = await getPref(db, l.phone);
  await db.exec('COMMIT');
  assert.equal(p.ai_disabled, true);
  assert.equal(p.reason, 'handoff');
  assert.equal(p.set_at, now);
  assert.equal(p.set_by, null);
});

test('virada da flag: sem usuário → handoff; com usuário → NULL; religar → NULL', async () => {
  const db = await fresh();
  const a = await lead(db);
  await db.query('UPDATE public.leads SET ai_disabled = true WHERE id = $1', [a.id]);
  assert.equal((await getPref(db, a.phone)).reason, 'handoff');

  await db.query('UPDATE public.leads SET ai_disabled = false, ai_disabled_at = NULL WHERE id = $1', [a.id]);
  const off = await getPref(db, a.phone);
  assert.equal(off.ai_disabled, false);
  assert.equal(off.reason, null);

  await db.query('UPDATE public.leads SET ai_disabled = true, ai_disabled_by = $2, ai_disabled_at = now() WHERE id = $1', [a.id, USER]);
  const manual = await getPref(db, a.phone);
  assert.equal(manual.ai_disabled, true);
  assert.equal(manual.reason, null);
  assert.equal(manual.set_by, USER);
});

test('RPC sobre desligamento manual preserva set_by/set_at/motivo', async () => {
  const db = await fresh();
  const l = await lead(db, { aiDisabled: true, at: T0, by: USER });
  await pref(db, l.phone, { aiDisabled: true, setBy: USER, setAt: T0 });
  const before = await getPref(db, l.phone);
  await rpc(db, l.id);
  assert.deepEqual(await getPref(db, l.phone), before);
});

test('RPC sobre bulk do sistema (set_by NULL, motivo NULL) preserva — não vira handoff', async () => {
  const db = await fresh();
  const l = await lead(db, { aiDisabled: true });
  await pref(db, l.phone, { aiDisabled: true, setAt: T0 });
  const before = await getPref(db, l.phone);
  await rpc(db, l.id);
  assert.deepEqual(await getPref(db, l.phone), before);
});

test('lead sem normalized_phone: RPC desliga o lead e não cria preferência', async () => {
  const db = await fresh();
  const { rows } = await db.query('INSERT INTO public.leads (organization_id, normalized_phone) VALUES ($1, NULL) RETURNING id', [ORG]);
  await rpc(db, rows[0].id);
  assert.equal((await getLead(db, rows[0].id)).ai_disabled, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.phone_ai_preferences')).rows[0].n, 0);
});

test('RPC: lead inexistente é no-op; NULL levanta', async () => {
  const db = await fresh();
  await rpc(db, '0f000000-0000-0000-0000-000000000000');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.phone_ai_preferences')).rows[0].n, 0);
  await assert.rejects(() => db.query('SELECT public.transfer_lead_to_human(NULL)'), /cannot be null/);
});

test('ACL, prosecdef e proconfig preservados; reaplicar a migration é no-op', async () => {
  const db = await fresh();
  await db.exec(MIG); // 2ª aplicação
  const priv = async (role) => (await db.query(
    `SELECT has_function_privilege($1, 'public.transfer_lead_to_human(uuid)', 'EXECUTE') AS ok`, [role])).rows[0].ok;
  assert.equal(await priv('anon'), false);
  assert.equal(await priv('authenticated'), false);
  assert.equal(await priv('service_role'), true);
  const fn = async (sig) => (await db.query(
    `SELECT prosecdef, proconfig, proacl::text AS acl FROM pg_proc WHERE oid = $1::regprocedure`, [sig])).rows[0];
  const t = await fn('public.transfer_lead_to_human(uuid)');
  assert.equal(t.prosecdef, true);
  assert.deepEqual(t.proconfig, ['search_path=public']);
  assert.equal(t.acl, '{postgres=X/postgres,service_role=X/postgres}');
  const s = await fn('public.sync_lead_ai_to_preferences()');
  assert.equal(s.prosecdef, false);
  assert.deepEqual(s.proconfig, ['search_path=public, extensions']);
  const cons = (await db.query(
    `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'phone_ai_preferences_disabled_reason_check'`)).rows[0].n;
  assert.equal(cons, 1);
  await assert.rejects(() => pref(db, '11900000000', { aiDisabled: true, reason: 'outro' }), /disabled_reason_check/);
});

test('guarda da religação (`disabled_reason IS NULL`) não religa handoff; religa o bulk', async () => {
  const db = await fresh();
  const h = await lead(db);
  await rpc(db, h.id);
  const b = await lead(db, { aiDisabled: true });
  await pref(db, b.phone, { aiDisabled: true });
  // Espelho do UPDATE de reactivateSystemDisabledContact (cancellation.ts).
  const relink = (phone) => db.query(
    `UPDATE public.phone_ai_preferences SET ai_disabled = false
      WHERE organization_id = $1 AND normalized_phone = $2 AND set_by IS NULL AND disabled_reason IS NULL`,
    [ORG, phone]);
  assert.equal((await relink(h.phone)).affectedRows, 0);
  assert.equal((await getPref(db, h.phone)).ai_disabled, true);
  assert.equal((await relink(b.phone)).affectedRows, 1);
});

test('rollback restaura as funções de prod e remove a coluna', async () => {
  const db = await fresh();
  await db.exec(RB);
  const { rows } = await db.query(`
    SELECT p.oid::regprocedure::text AS sig, md5(pg_get_functiondef(p.oid)) AS md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`);
  const got = Object.fromEntries(rows.map((r) => [r.sig, r.md5]));
  assert.equal(got['transfer_lead_to_human(uuid)'], PROD_MD5['transfer_lead_to_human(uuid)']);
  assert.equal(got['sync_lead_ai_to_preferences()'], PROD_MD5['sync_lead_ai_to_preferences()']);
  const col = (await db.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'phone_ai_preferences' AND column_name = 'disabled_reason'`)).rows[0].n;
  assert.equal(col, 0);
});

async function snapshot(db) {
  const prefs = (await db.query(
    `SELECT normalized_phone, ai_disabled, set_by, set_at::text, disabled_reason, updated_at::text
       FROM public.phone_ai_preferences ORDER BY normalized_phone`)).rows;
  const leads = (await db.query(
    `SELECT id, ai_disabled, ai_disabled_at::text FROM public.leads ORDER BY id`)).rows;
  const backup = (await db.query(
    `SELECT step, count(*)::int AS n FROM backup.copilot_handoff_backfill_20271120 GROUP BY step ORDER BY step`)).rows;
  return { prefs, leads, backup };
}

test('backfill B1/B2a/B2b com controles; 2× = mesmo resultado', async () => {
  const db = await fresh();
  const at = '2026-09-10T12:00:00+00';

  // B1: pref off sem usuário + lead mais recente desligado por handoff (_at)
  const b1 = await lead(db, { aiDisabled: true, at });
  await pref(db, b1.phone, { aiDisabled: true, setAt: at });
  // controle B1: bulk (lead sem _at) → fica religável
  const bulk = await lead(db, { aiDisabled: true });
  await pref(db, bulk.phone, { aiDisabled: true });
  // controle B1: manual (set_by) → intocado
  const man = await lead(db, { aiDisabled: true, at, by: USER });
  await pref(db, man.phone, { aiDisabled: true, setBy: USER, setAt: at });
  // controle B1: lead mais recente do telefone está ligado → intocado
  const oldPhone = '11977777777';
  await lead(db, { phone: oldPhone, aiDisabled: true, at, created: '2026-01-01T00:00:00+00' });
  await lead(db, { phone: oldPhone, aiDisabled: false, created: '2026-02-01T00:00:00+00' });
  await pref(db, oldPhone, { aiDisabled: true });

  // B2a: travado, WAITING_HUMAN, handoff posterior à pref
  const b2a = await lead(db, { aiDisabled: true, at });
  await pref(db, b2a.phone, { aiDisabled: false, setAt: T0 });
  await conv(db, b2a.id, 'WAITING_HUMAN');
  // B2b: travado sem WAITING_HUMAN
  const b2b = await lead(db, { aiDisabled: true, at });
  await pref(db, b2b.phone, { aiDisabled: false, setAt: T0 });
  await conv(db, b2b.id, 'QUALIFYING');
  // B2b: WAITING_HUMAN mas pref mudou DEPOIS do lead
  const b2bOld = await lead(db, { aiDisabled: true, at: T0 });
  await pref(db, b2bOld.phone, { aiDisabled: false, setAt: at });
  await conv(db, b2bOld.id, 'WAITING_HUMAN');
  // controle: lead apagado travado não conta
  const del = await lead(db, { aiDisabled: true, at, deleted: true });
  await pref(db, del.phone, { aiDisabled: false, setAt: T0 });
  // controle: consistente ligado
  const ok = await lead(db);
  await pref(db, ok.phone, { aiDisabled: false });

  await db.exec(BACKFILL);
  const first = await snapshot(db);

  assert.equal((await getPref(db, b1.phone)).reason, 'handoff');
  assert.equal((await getPref(db, bulk.phone)).reason, null);
  assert.equal((await getPref(db, man.phone)).reason, null);
  assert.equal((await getPref(db, oldPhone)).reason, null);

  const pa = await getPref(db, b2a.phone);
  assert.equal(pa.ai_disabled, true);
  assert.equal(pa.reason, 'handoff');
  assert.equal(pa.set_at, (await getLead(db, b2a.id)).ai_disabled_at);
  assert.equal((await getLead(db, b2a.id)).ai_disabled, true);

  for (const x of [b2b, b2bOld]) {
    const ld = await getLead(db, x.id);
    assert.equal(ld.ai_disabled, false);
    assert.equal(ld.ai_disabled_at, null);
    const p = await getPref(db, x.phone);
    assert.equal(p.ai_disabled, false);
    assert.equal(p.reason, null);
  }
  assert.equal((await getLead(db, del.id)).ai_disabled, true, 'apagado intocado');
  assert.equal((await getPref(db, ok.phone)).ai_disabled, false);
  assert.deepEqual(first.backup, [
    { step: 'B1', n: 1 }, { step: 'B2a', n: 1 }, { step: 'B2b', n: 2 },
  ]);

  await db.exec(BACKFILL);
  assert.deepEqual(await snapshot(db), first, 'idempotente: 2ª execução não muda nada');
});

test('backfill: verificação aborta se sobrar lead travado (controle positivo)', async () => {
  const db = await fresh();
  // Travado que B2a/B2b não alcançam: pref ligada e lead sem linha de conversa,
  // mas com a guarda de B2b neutralizada por um trigger que religa o lead.
  const l = await lead(db, { aiDisabled: true, at: '2026-09-10T12:00:00+00' });
  await pref(db, l.phone, { aiDisabled: false, setAt: T0 });
  await db.exec(`
    CREATE FUNCTION public.t_keep_disabled() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN NEW.ai_disabled := true; RETURN NEW; END $$;
    CREATE TRIGGER t_keep_disabled BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.t_keep_disabled();`);
  await assert.rejects(() => db.exec(BACKFILL), /ainda travado/);
});

test('backfill fora de supabase/migrations (F4) e numa transação só', () => {
  const pend = readdirSync(new URL('../../supabase/migrations/', import.meta.url))
    .filter((f) => f.startsWith('20271120'));
  assert.deepEqual(pend, ['20271120000000_copilot_handoff_disabled_reason.sql']);
  assert.match(BACKFILL, /^BEGIN;$/m);
  assert.match(BACKFILL, /^COMMIT;$/m);
  assert.equal(BACKFILL.match(/^COMMIT;$/gm).length, 1, 'COMMIT único — o ensaio troca só ele');
});

test('ensaio (COMMIT → ROLLBACK) não deixa rastro', async () => {
  const db = await fresh();
  const l = await lead(db, { aiDisabled: true, at: '2026-09-10T12:00:00+00' });
  await pref(db, l.phone, { aiDisabled: false, setAt: T0 });
  const before = { p: await getPref(db, l.phone), l: await getLead(db, l.id) };

  await db.exec(BACKFILL.replace(/^COMMIT;$/m, 'ROLLBACK;'));

  assert.deepEqual({ p: await getPref(db, l.phone), l: await getLead(db, l.id) }, before);
  const { rows } = await db.query(`SELECT to_regclass('backup.copilot_handoff_backfill_20271120') AS t`);
  assert.equal(rows[0].t, null, 'tabela de backup some junto no ROLLBACK');
});
