// Cobrança · "no dia do vencimento" (20280120020000) num Postgres real (PGlite).
//
// Cobre: a coluna de 0 dias (de entrada ou dedicada) recebe e envia sozinha ao
// cadastrar um título que vence hoje; atraso maior cai na coluna certa e não
// manda a do vencimento; "Só mover" à mão não reenvia; a coluna de entrada só
// aceita 0; e o rollback pareado. GRANT/RLS do banco real ficam com o pgTAP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
const U_ADMIN = id(1);
const TM_ADMIN = id(11);
const INST_COBRANCA = id(501);

// Quarta, 21/10/2026, 14h em São Paulo — dentro da janela padrão.
const AGORA = '2026-10-21T14:00:00-03:00';
const dia = (offset) => new Date(Date.UTC(2026, 9, 21 + offset)).toISOString().slice(0, 10);

const MIGRATIONS = [
  '20271212000000_cobranca_fundacao',
  '20271212000010_cobranca_endurecer_acl',
  '20271213000000_cobranca_regua',
  '20271214000000_cobranca_colunas_da_regua',
  '20280118010000_cobranca_trilhas_colunas_manuais_e_prazo',
];
const NOVA = '20280120020000_cobranca_entrada_no_vencimento';
const MSG0 = 'Olá {nome}, seu título de {valor} vence hoje ({vencimento}). Dias de atraso: {dias_atraso}.';

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${TORQUE}', 'TorqueCRM', 'torquecrm');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin');
    INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status) VALUES
      ('${INST_COBRANCA}', '${TORQUE}', 'cobrança', 'uazapi', 'connected');
  `);
  for (const m of MIGRATIONS) await db.exec(read(`../../supabase/migrations/${m}.sql`));
  await as(db, U_ADMIN);
  await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COBRANCA}')`);
  await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', true)`);
  await asPostgres(db);
  await db.exec(read(`../../supabase/migrations/${NOVA}.sql`));
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

async function devedor(db, { nome, telefone = '5548999990001', vencimento, valor = 100 }) {
  await as(db, U_ADMIN);
  const inad = await val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL,
    '${JSON.stringify({ nome, telefone, titulos: [{ valor, vencimento }] }).replace(/'/g, "''")}'::jsonb)`);
  await asPostgres(db);
  const caso = await val(db, `SELECT id FROM cobranca_casos WHERE inadimplente_id = '${inad}' AND encerrado_em IS NULL`);
  return { inad, caso };
}
const planejar = (db, agora = AGORA) => one(db, `SELECT cobranca_regua_planejar('${agora}') AS r`).then((x) => x.r);
const colunaDo = (db, caso) => val(db, `SELECT e.nome FROM cobranca_casos c JOIN cobranca_etapas e ON e.id = c.etapa_id WHERE c.id = '${caso}'`);
const coluna = (db, nome) => val(db, `SELECT id FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND nome = '${nome}'`);
const envios = (db, caso) => rows(db, `SELECT en.gatilho, en.dias, en.status, e.nome AS coluna
  FROM cobranca_regua_envios en LEFT JOIN cobranca_etapas e ON e.id = en.etapa_id
  WHERE en.caso_id = '${caso}' ORDER BY en.created_at, en.dias`);

async function salvarColuna(db, dados, etapa = null) {
  await as(db, U_ADMIN);
  try {
    return await val(db, `SELECT cobranca_coluna_salvar('${TORQUE}', ${etapa ? `'${etapa}'` : 'NULL'},
      '${JSON.stringify(dados).replace(/'/g, "''")}'::jsonb)`);
  } finally {
    await asPostgres(db);
  }
}
async function mover(db, caso, nome, enviar = false) {
  await as(db, U_ADMIN);
  const r = await val(db, `SELECT cobranca_caso_mover('${caso}', '${await coluna(db, nome)}', NULL, ${enviar})`);
  await asPostgres(db);
  return r;
}

test('coluna de entrada: aceita só 0 dias; faixa 0..365; coluna com dias não volta a null', async () => {
  const db = await setup();
  try {
    const entrada = await coluna(db, 'Vencido');
    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', '${entrada}', '{"entrada_dias":5}'::jsonb)`)).detail,
      'entrada_so_no_vencimento');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":366}'::jsonb)`)).message,
      'Dias de atraso de 0 a 365.');
    await asPostgres(db);

    await salvarColuna(db, { entrada_dias: 0, mensagem: MSG0 }, entrada);
    assert.equal(await val(db, `SELECT entrada_dias FROM cobranca_etapas WHERE id = '${entrada}'`), 0);
    assert.equal(await val(db, `SELECT private.cobranca_rotulo_de_dias(0)`), 'No dia do vencimento');

    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', '${entrada}', '{"entrada_dias":null}'::jsonb)`)).detail,
      'dias_obrigatorios');
    await asPostgres(db);
    // O dia 0 é único por org.
    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"nome":"Outra","entrada_dias":0}'::jsonb)`)).detail,
      'coluna_duplicada');
    await asPostgres(db);
  } finally {
    await db.close();
  }
});

test('cadastro com título que vence hoje: a coluna de entrada de 0 dias envia sozinha, uma vez', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { entrada_dias: 0, mensagem: MSG0 }, await coluna(db, 'Vencido'));
    const { caso } = await devedor(db, { nome: 'Hoje Vence', vencimento: dia(0), valor: 261.99 });
    assert.equal(await colunaDo(db, caso), 'Vencido', 'nasce na coluna de entrada');

    await planejar(db);
    assert.deepEqual((await envios(db, caso)).map((e) => `${e.gatilho}:${e.dias}:${e.status}:${e.coluna}`), ['atraso:0:pendente:Vencido']);
    assert.equal(await colunaDo(db, caso), 'Vencido');

    await planejar(db);
    await planejar(db);
    assert.equal((await envios(db, caso)).length, 1, 'planejar de novo não duplica');

    const [env] = await rows(db, `SELECT * FROM cobranca_regua_reservar(10, '${AGORA}')`);
    assert.equal(env.variaveis.dias_atraso, 0);
    assert.match(env.mensagem, /vence hoje/);
  } finally {
    await db.close();
  }
});

test('coluna dedicada de 0 dias: o cadastro anda para ela e envia; atraso maior não manda a do vencimento', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { nome: 'No vencimento', entrada_dias: 0, mensagem: MSG0 });
    const hoje = await devedor(db, { nome: 'Hoje', telefone: '5548999990001', vencimento: dia(0) });
    const dez = await devedor(db, { nome: 'Dez dias', telefone: '5548999990002', vencimento: dia(-10) });
    await planejar(db);

    assert.equal(await colunaDo(db, hoje.caso), 'No vencimento');
    assert.deepEqual((await envios(db, hoje.caso)).map((e) => `${e.dias}:${e.status}`), ['0:pendente']);
    assert.equal(await colunaDo(db, dez.caso), '7 dias de atraso', 'maior coluna vencida, não a do vencimento');
    assert.deepEqual((await envios(db, dez.caso)).map((e) => e.dias), [7]);
  } finally {
    await db.close();
  }
});

test('"Só mover" à mão ou voltar o card não faz a régua enviar o vencimento depois', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { entrada_dias: 0, mensagem: MSG0 }, await coluna(db, 'Vencido'));
    const { caso } = await devedor(db, { nome: 'Manual', vencimento: dia(0) });
    await mover(db, caso, 'Em negociação');
    await mover(db, caso, 'Vencido');
    await planejar(db);
    assert.equal((await envios(db, caso)).length, 0, 'equipe mexeu no card: a régua não reenvia o vencimento');
  } finally {
    await db.close();
  }
});

test('rollback pareado: volta a faixa 1..365 e a régua segue funcionando', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { entrada_dias: 0, mensagem: MSG0 }, await coluna(db, 'Vencido'));
    await salvarColuna(db, { nome: 'Dedicada', entrada_dias: 0 }).catch(() => {});
    const { caso } = await devedor(db, { nome: 'Rb', vencimento: dia(-5) });

    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));

    assert.equal(await val(db, `SELECT count(*) FROM cobranca_etapas WHERE entrada_dias = 0`), 0);
    assert.equal(await val(db, `SELECT private.cobranca_rotulo_de_dias(1)`), '1 dia de atraso');
    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":0}'::jsonb)`)).message,
      'Dias de atraso de 1 a 365.');
    await asPostgres(db);
    await planejar(db);
    assert.equal(await colunaDo(db, caso), '3 dias de atraso');
  } finally {
    await db.close();
  }
});
