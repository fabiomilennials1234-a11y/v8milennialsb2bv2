// Cobrança · reordenar colunas pela tela (20280121010000) num Postgres real (PGlite).
//
// Cobre: mover dentro da zona livre (pausadas sem dias: Em negociação,
// Promessa, colunas manuais) para cima, para baixo e para os extremos; as
// posições seguem contíguas; entrada, colunas de dias, Jurídico e desfechos são
// recusados; permissão; e o rollback pareado. GRANT/RLS do banco real ficam com
// o pgTAP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
const OUTRA = id(900);
const U_ADMIN = id(1);
const U_MEMBRO = id(2);
const U_OUTRA = id(3);
const TM_ADMIN = id(11);
const TM_MEMBRO = id(12);
const TM_OUTRA = id(13);

const MIGRATIONS = [
  '20271212000000_cobranca_fundacao',
  '20271212000010_cobranca_endurecer_acl',
  '20271213000000_cobranca_regua',
  '20271214000000_cobranca_colunas_da_regua',
  '20280118010000_cobranca_trilhas_colunas_manuais_e_prazo',
];
const NOVA = '20280121010000_cobranca_ordem_das_colunas';

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${TORQUE}', 'TorqueCRM', 'torquecrm'),
      ('${OUTRA}', 'Outra', 'outra');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member'),
      ('${TM_OUTRA}', '${OUTRA}', '${U_OUTRA}', 'Admin Outra', 'admin');
  `);
  for (const m of MIGRATIONS) await db.exec(read(`../../supabase/migrations/${m}.sql`));
  await db.exec(read(`../../supabase/migrations/${NOVA}.sql`));
  // Três colunas manuais: a zona livre fica [Em negociação, Promessa ou acordo, A, B, C].
  for (const nome of ['Manual A', 'Manual B', 'Manual C']) {
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '${JSON.stringify({ nome, manual: true })}'::jsonb)`);
    await asPostgres(db);
  }
  return db;
}

async function as(db, uid) {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET test.role = 'authenticated'; SET ROLE authenticated;`);
}
async function asPostgres(db) {
  await db.exec(`RESET ROLE; SET test.uid = ''; SET test.role = '';`);
}
const one = async (db, sql) => (await db.query(sql)).rows[0];
const val = async (db, sql) => Object.values(await one(db, sql))[0];
const rows = async (db, sql) => (await db.query(sql)).rows;
const erro = async (db, sql) => {
  try { await db.query(sql); } catch (e) { return e; }
  assert.fail(`esperava erro em: ${sql}`);
};

const ordem = (db) => rows(db, `SELECT nome, posicao FROM cobranca_etapas WHERE organization_id = '${TORQUE}' ORDER BY posicao`);
const nomes = async (db) => (await ordem(db)).map((e) => e.nome);
const coluna = (db, nome) => val(db, `SELECT id FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND nome = '${nome}'`);
async function mover(db, nome, para, uid = U_ADMIN) {
  await as(db, uid);
  try {
    await db.query(`SELECT cobranca_coluna_mover_ordem('${await coluna(db, nome)}', ${para})`);
  } finally {
    await asPostgres(db);
  }
}

const FIXAS_ANTES = ['Vencido', '1 dia de atraso', '3 dias de atraso', '7 dias de atraso', '15 dias de atraso', '30 dias de atraso'];
const FIXAS_DEPOIS = ['Jurídico', 'Recuperado', 'Perdido', 'Cancelado'];

test('mover dentro da zona livre: para cima, para baixo e para os extremos; posições contíguas', async () => {
  const db = await setup();
  try {
    assert.deepEqual(await nomes(db), [...FIXAS_ANTES, 'Em negociação', 'Promessa ou acordo', 'Manual A', 'Manual B', 'Manual C', ...FIXAS_DEPOIS]);

    await mover(db, 'Manual C', 1); // a última vira a primeira da zona = logo depois das colunas de dias
    assert.deepEqual(await nomes(db), [...FIXAS_ANTES, 'Manual C', 'Em negociação', 'Promessa ou acordo', 'Manual A', 'Manual B', ...FIXAS_DEPOIS]);

    await mover(db, 'Manual C', 3); // desce duas
    assert.deepEqual(await nomes(db), [...FIXAS_ANTES, 'Em negociação', 'Promessa ou acordo', 'Manual C', 'Manual A', 'Manual B', ...FIXAS_DEPOIS]);

    await mover(db, 'Em negociação', 5); // a primeira vai para o fim
    assert.deepEqual(await nomes(db), [...FIXAS_ANTES, 'Promessa ou acordo', 'Manual C', 'Manual A', 'Manual B', 'Em negociação', ...FIXAS_DEPOIS]);

    // Fora da faixa: encosta no extremo (0 → primeira, 99 → última); mesma posição não muda nada.
    await mover(db, 'Manual B', 0);
    assert.equal((await nomes(db))[FIXAS_ANTES.length], 'Manual B');
    await mover(db, 'Manual B', 99);
    const depois = await nomes(db);
    assert.equal(depois[depois.length - FIXAS_DEPOIS.length - 1], 'Manual B');
    const antes = await ordem(db);
    await mover(db, 'Manual B', 5);
    assert.deepEqual(await ordem(db), antes);

    const q = await ordem(db);
    assert.deepEqual(q.map((c) => c.posicao), q.map((_, i) => i + 1), 'posições contíguas de 1 a N');
  } finally {
    await db.close();
  }
});

test('coluna nova manual entra no fim da zona livre e o Fluxo Cartorial da vida real vira a 5ª', async () => {
  const db = await setup();
  try {
    // Quadro como o da Agilsul: 4 colunas antes da zona livre.
    await db.exec(`DELETE FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND nome IN ('15 dias de atraso', '30 dias de atraso')`);
    await db.exec(`SELECT private.cobranca_etapas_reordenar('${TORQUE}')`);
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '${JSON.stringify({ nome: 'FLUXO CARTORIAL', manual: true })}'::jsonb)`);
    await asPostgres(db);
    const fim = await nomes(db);
    assert.equal(fim[fim.length - FIXAS_DEPOIS.length - 1], 'FLUXO CARTORIAL', 'nasce no fim da zona livre');

    await mover(db, 'FLUXO CARTORIAL', 1);
    const q = await ordem(db);
    assert.equal(q[4].nome, 'FLUXO CARTORIAL', 'quinta coluna do quadro');
    assert.equal(q[4].posicao, 5);
  } finally {
    await db.close();
  }
});

test('entrada, colunas de dias, Jurídico e desfechos não se movem', async () => {
  const db = await setup();
  try {
    for (const nome of ['Vencido', '1 dia de atraso', '30 dias de atraso', 'Jurídico', 'Recuperado', 'Perdido', 'Cancelado']) {
      await as(db, U_ADMIN);
      const e = await erro(db, `SELECT cobranca_coluna_mover_ordem('${await coluna(db, nome)}', 1)`);
      await asPostgres(db);
      assert.equal(e.detail, 'coluna_fixa', nome);
    }
    assert.deepEqual(await nomes(db), [...FIXAS_ANTES, 'Em negociação', 'Promessa ou acordo', 'Manual A', 'Manual B', 'Manual C', ...FIXAS_DEPOIS]);
  } finally {
    await db.close();
  }
});

test('permissão: membro sem cobranca.edit, admin de outra org e coluna inexistente recusam', async () => {
  const db = await setup();
  try {
    await assert.rejects(mover(db, 'Manual A', 1, U_MEMBRO));
    await assert.rejects(mover(db, 'Manual A', 1, U_OUTRA));
    await as(db, U_ADMIN);
    const e = await erro(db, `SELECT cobranca_coluna_mover_ordem('${id(999)}', 1)`);
    await asPostgres(db);
    assert.equal(e.detail, 'coluna_inexistente');
    assert.deepEqual(await nomes(db), [...FIXAS_ANTES, 'Em negociação', 'Promessa ou acordo', 'Manual A', 'Manual B', 'Manual C', ...FIXAS_DEPOIS]);
  } finally {
    await db.close();
  }
});

test('rollback pareado remove as duas RPCs e deixa a ordem como está', async () => {
  const db = await setup();
  try {
    await mover(db, 'Manual C', 1);
    const antes = await nomes(db);
    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname = 'cobranca_coluna_mover_ordem'`), 0);
    assert.deepEqual(await nomes(db), antes);
  } finally {
    await db.close();
  }
});
