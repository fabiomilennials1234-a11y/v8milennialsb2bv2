// Chamado 793f4b05 · PR1/5 — lead_owners contra um PostgreSQL local descartável.
// Rodado por scripts/test-lead-owners-db.mjs (K3). Nunca aponte para um projeto.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;
const sql = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const MIGRATION = 'supabase/migrations/20271116000000_lead_owners_n_donos.sql';
const ROLLBACK = 'supabase/migrations/rollback/20271116000000_lead_owners_n_donos.sql';

const port = Number(process.env.LEAD_OWNERS_PG_PORT ?? 55488);
const database = `torque_lead_owners_test_${process.pid}`;

const ORG_A = '793f4b05-0000-4000-8000-00000000000a';
const ORG_B = '793f4b05-0000-4000-8000-00000000000b';
const user = s => `793f4b05-0000-4000-8000-0000000000${s}`;
const tm = s => `793f4b05-0000-4000-8000-0000000001${s}`;
const lead = s => `793f4b05-0000-4000-8000-0000000002${s}`;
// a1 admin · a2 Varejo · a3 Envase · a4 SDR · a5 sem vínculo · b1 org B · c1 master

let admin, db;

const root = () => db.query('RESET ROLE');
const as = async u => {
  await root();
  await db.query("SELECT set_config('request.jwt.claims', $1, false)",
    [JSON.stringify({ sub: user(u), role: 'authenticated' })]);
  await db.query('SET ROLE authenticated');
};
const donos = async id => {
  await root();
  const { rows } = await db.query(
    `SELECT right(team_member_id::text, 2) || ':' || role || ':' || source AS d
       FROM lead_owners WHERE lead_id = $1 ORDER BY role, team_member_id`, [id]);
  return rows.map(r => r.d).join(',');
};
const visible = async (u, id) => {
  await as(u);
  const { rowCount } = await db.query('SELECT 1 FROM leads WHERE id = $1', [id]);
  await root();
  return rowCount === 1;
};
const leadsPolicies = async () => (await db.query(
  `SELECT policyname, cmd, roles::text, qual, with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leads' ORDER BY policyname`)).rows;
const canUpdateLeadDef = async () => (await db.query(
  `SELECT pg_get_functiondef('public.can_update_lead(uuid)'::regprocedure) AS d`)).rows[0].d;

let policiesBefore, canUpdateBefore;

before(async () => {
  admin = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  db = new Client({ host: '127.0.0.1', port, user: 'postgres', database });
  await db.connect();
  await db.query(sql('tests/fixtures/lead-owners-schema.sql'));
  await db.query(sql('supabase/migrations/20271110000000_lead_documents_override.sql'));

  await db.query(`INSERT INTO organizations (id, name) VALUES ($1, 'A'), ($2, 'B')`, [ORG_A, ORG_B]);
  await db.query(`INSERT INTO team_members (id, organization_id, user_id, name, role, is_active) VALUES
    ($1, $7, $8,  'Admin A',  'admin',  true),
    ($2, $7, $9,  'Varejo A', 'member', true),
    ($3, $7, $10, 'Envase A', 'member', true),
    ($4, $7, $11, 'SDR A',    'member', true),
    ($5, $7, $12, 'Alheio A', 'member', true),
    ($6, $13, $14, 'Admin B', 'admin',  true)`,
  [tm('a1'), tm('a2'), tm('a3'), tm('a4'), tm('a5'), tm('b1'), ORG_A,
    user('a1'), user('a2'), user('a3'), user('a4'), user('a5'), ORG_B, user('b1')]);
  await db.query('INSERT INTO master_users (user_id, is_active) VALUES ($1, true)', [user('c1')]);
  await db.query(`INSERT INTO organization_feature_defaults (organization_id, feature_key, enabled) VALUES
    ($1, 'leads.view_all', false), ($1, 'leads.view_unassigned', false), ($1, 'leads.view_subordinates', false)`, [ORG_A]);

  // Dados ANTES da migration, com os triggers de prod (canônico + mesma org).
  await db.query(`INSERT INTO leads (id, organization_id, name, sale_responsible_id, pre_sale_responsible_id) VALUES
    ($1, $5, 'L1', $6, $7),
    ($2, $5, 'L2', $6, NULL),
    ($3, $5, 'L3', NULL, NULL),
    ($4, NULL, 'LN', $6, NULL)`,
  [lead('a1'), lead('a2'), lead('a3'), lead('a9'), ORG_A, tm('a2'), tm('a4')]);
  // L6: dono veio do ERP por responsible_id (closer_id NULL), como 3.952 leads da org.
  await db.query(`INSERT INTO leads (id, organization_id, name, responsible_id) VALUES ($1, $2, 'L6', $3)`,
    [lead('a6'), ORG_A, tm('a2')]);
  // closer_id NULL sem passar pelo trigger canônico (que espelharia a coluna).
  await db.query('SET session_replication_role = replica');
  await db.query('UPDATE leads SET closer_id = NULL WHERE id = $1', [lead('a6')]);
  await db.query('SET session_replication_role = origin');

  policiesBefore = await leadsPolicies();
  canUpdateBefore = await canUpdateLeadDef();
  await db.query(sql(MIGRATION));
});

after(async () => {
  if (db) await db.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    await admin.end();
  }
});

test('backfill: principais por papel, ignora org NULL; segunda volta grava 0', async () => {
  assert.equal(await donos(lead('a1')), 'a4:pre_venda:backfill,a2:venda:backfill');
  assert.equal(await donos(lead('a2')), 'a2:venda:backfill');
  assert.equal(await donos(lead('a3')), '');
  assert.equal(await donos(lead('a9')), '');
  const { rows } = await db.query('SELECT public.lead_owners_backfill() AS n');
  assert.equal(rows[0].n, 0);
});

test('comportamento neutro logo após a migration: mesmas visibilidades de antes', async () => {
  assert.equal(await visible('a2', lead('a1')), true);
  assert.equal(await visible('a3', lead('a1')), false);
  assert.equal(await visible('a5', lead('a2')), false);
  assert.equal(await visible('b1', lead('a1')), false);
});

test('ERP: UPDATE só de responsible_id troca o principal (BEFORE trigger reescreve a coluna)', async () => {
  await root();
  assert.equal(await donos(lead('a6')), 'a2:venda:backfill');
  await db.query('UPDATE leads SET responsible_id = $2 WHERE id = $1', [lead('a6'), tm('a3')]);
  const { rows } = await db.query('SELECT sale_responsible_id FROM leads WHERE id = $1', [lead('a6')]);
  assert.equal(rows[0].sale_responsible_id, tm('a3'));
  assert.equal(await donos(lead('a6')), 'a3:venda:canonical');
});

test('transferência Varejo → Envase mantém a anterior como co-dona; ela vê e edita', async () => {
  await as('a2');
  const { rows } = await db.query("SELECT public.lead_owner_transfer($1, $2, 'venda') AS r", [lead('a1'), tm('a3')]);
  assert.equal(rows[0].r.owners[0].team_member_id, tm('a3'));
  assert.equal(await donos(lead('a1')), 'a2:co:transfer,a4:pre_venda:backfill,a3:venda:transfer');
  assert.equal(await visible('a2', lead('a1')), true);
  assert.equal(await visible('a3', lead('a1')), true);
  await as('a2');
  const upd = await db.query("UPDATE leads SET name = 'L1 editado' WHERE id = $1", [lead('a1')]);
  assert.equal(upd.rowCount, 1);
  const cu = await db.query('SELECT public.can_update_lead($1) AS ok', [lead('a1')]).catch(e => e);
  assert.equal(cu.code, '42501', 'can_update_lead é fechada para authenticated');
  await root();
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user('a2'), role: 'authenticated' })]);
  assert.equal((await db.query('SELECT public.can_update_lead($1) AS ok', [lead('a1')])).rows[0].ok, true);
});

test('ERP/round-robin troca o principal sem apagar transfer; canonical substituído some', async () => {
  await root();
  await db.query('UPDATE leads SET sale_responsible_id = $2 WHERE id = $1', [lead('a1'), tm('a1')]);
  assert.equal(await donos(lead('a1')), 'a2:co:transfer,a3:co:transfer,a4:pre_venda:backfill,a1:venda:canonical');
  await db.query('UPDATE leads SET sale_responsible_id = $2 WHERE id = $1', [lead('a1'), tm('a3')]);
  assert.equal(await donos(lead('a1')), 'a2:co:transfer,a4:pre_venda:backfill,a3:venda:canonical');
});

test('add/remove: sem vínculo não se adiciona; outra org recebe 404; master atua', async () => {
  await as('a5');
  await assert.rejects(db.query('SELECT public.lead_owner_add($1, $2)', [lead('a2'), tm('a5')]), e => e.code === '42501');
  await as('b1');
  await assert.rejects(db.query('SELECT public.lead_owner_add($1, $2)', [lead('a2'), tm('b1')]), e => e.code === 'PT404');
  await as('c1');
  await db.query('SELECT public.lead_owner_add($1, $2)', [lead('a2'), tm('a5')]);
  assert.equal(await visible('a5', lead('a2')), true);
  await as('a1');
  await assert.rejects(db.query('SELECT public.lead_owner_remove($1, $2)', [lead('a2'), tm('a2')]), e => e.code === 'PT409');
  await db.query('SELECT public.lead_owner_remove($1, $2)', [lead('a2'), tm('a5')]);
  assert.equal(await visible('a5', lead('a2')), false);
});

test('escrita direta recusada; anon sem EXECUTE; org NULL não quebra', async () => {
  await as('a1');
  await assert.rejects(db.query(
    `INSERT INTO lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
     VALUES ($1, $2, $3, 'co', false, 'manual')`, [ORG_A, lead('a3'), tm('a1')]), e => e.code === '42501');
  await root();
  await db.query('SET ROLE anon');
  await assert.rejects(db.query('SELECT public.lead_owner_add($1, $2)', [lead('a2'), tm('a5')]), e => e.code === '42501');
  await root();
  await db.query('UPDATE leads SET sale_responsible_id = $2 WHERE id = $1', [lead('a9'), tm('a3')]);
  assert.equal(await donos(lead('a9')), '');
});

test('rollback devolve policies e can_update_lead literais; reaplicar é idempotente', async () => {
  await root();
  const before = (await db.query('SELECT count(*)::int AS n FROM lead_owners')).rows[0].n;
  await db.query(sql(ROLLBACK));
  assert.deepEqual(await leadsPolicies(), policiesBefore);
  assert.equal(await canUpdateLeadDef(), canUpdateBefore);
  assert.equal((await db.query("SELECT to_regclass('public.lead_owners') AS t")).rows[0].t, null);
  await db.query(sql(MIGRATION));
  const after = (await db.query('SELECT count(*)::int AS n FROM lead_owners')).rows[0].n;
  assert.ok(after > 0 && after <= before, `reaplicada: ${after} linhas (antes ${before}, co-donos se perdem no rollback)`);
  const { rows } = await db.query('SELECT public.lead_owners_backfill() AS n');
  assert.equal(rows[0].n, 0);
});
