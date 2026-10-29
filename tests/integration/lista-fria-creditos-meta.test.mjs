// Lista Fria · dois saldos de crédito (ADR-0044): NORMAL (Maps, CNPJ) e META (Instagram).
//
// Cobre a migration 20271220000000 num Postgres real (PGlite): o saldo por tipo, a concessão, qual saldo
// cada fonte gasta, a devolução da sobra para o saldo de origem, a compatibilidade com o que já está em
// produção (a RPC antiga de saldo e a concessão de 3 argumentos) e o rollback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLLBACK_META, TORQUE, U_ADMIN, U_MEMBRO, U_LIBERADO, U_MASTER,
  read, setup, as, asWorker, asPostgres, one, val, maps, criarBusca, item, registrar, comSaldo,
} from './helpers/lista-fria-db.mjs';

const ig = { url: 'https://www.instagram.com/clinica/' };
const saldos = async (db) => (await one(db, `SELECT lista_fria_saldos('${TORQUE}') AS s`)).s;

test('saldos separados: a concessão escolhe o tipo; o saldo antigo segue devolvendo o normal', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 40, 'meta');
    await as(db, U_LIBERADO);
    assert.deepEqual(await saldos(db), { normal: 100, meta: 40 });
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 100, 'o front já publicado lê só o normal e continua certo');
    await as(db, U_MASTER);
    assert.equal(await val(db, `SELECT lista_fria_creditos_conceder('${TORQUE}', 10, 'mais', 'meta')`), 50, 'devolve o saldo do tipo concedido');
    assert.equal(await val(db, `SELECT lista_fria_creditos_conceder('${TORQUE}', 5, 'mais')`), 105, 'sem tipo = normal (chamada antiga)');
  } finally { await db.close(); }
});

test('só master concede, e o tipo tem de ser normal ou meta', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    await assert.rejects(db.query(`SELECT lista_fria_creditos_conceder('${TORQUE}', 10, 'x', 'meta')`), /Só o time Torque/);
    await as(db, U_MASTER);
    for (const t of ['ouro', '', 'NORMAL']) {
      await assert.rejects(db.query(`SELECT lista_fria_creditos_conceder('${TORQUE}', 10, 'x', '${t}')`), /Tipo de crédito inválido/, `tipo "${t}"`);
    }
    await assert.rejects(db.query(`SELECT lista_fria_creditos_conceder('${TORQUE}', 0, 'x', 'meta')`), /1 a 1\.000\.000/);
    await asPostgres(db);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_creditos`), 0, 'nada entrou no livro');
  } finally { await db.close(); }
});

test('cada fonte gasta do seu saldo: Maps e CNPJ do normal, Instagram do Meta', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 40, 'meta');
    await as(db, U_LIBERADO);
    await criarBusca(db, 'maps', maps, 10);
    await criarBusca(db, 'cnpj', { cnaes: ['4639'], uf: 'SP' }, 20);
    await criarBusca(db, 'instagram', ig, 15);
    assert.deepEqual(await saldos(db), { normal: 70, meta: 25 });
    await asPostgres(db);
    const livro = (await db.query(`SELECT tipo, motivo, sum(delta)::int AS soma FROM lista_fria_creditos GROUP BY 1, 2 ORDER BY 1, 2`)).rows;
    assert.deepEqual(livro, [
      { tipo: 'meta', motivo: 'concessao', soma: 40 }, { tipo: 'meta', motivo: 'reserva', soma: -15 },
      { tipo: 'normal', motivo: 'concessao', soma: 100 }, { tipo: 'normal', motivo: 'reserva', soma: -30 },
    ]);
  } finally { await db.close(); }
});

test('um saldo não paga a fonte do outro (e a recusa diz qual faltou)', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 1000);               // muito normal, nenhum Meta
    await as(db, U_LIBERADO);
    await assert.rejects(criarBusca(db, 'instagram', ig, 5), (e) => /Saldo de créditos Meta insuficiente/.test(e.message) && e.detail === 'creditos_meta_insuficientes');
    await comSaldo(db, 500, 'meta');
    await as(db, U_LIBERADO);
    await criarBusca(db, 'instagram', ig, 500);          // gasta todo o Meta
    await assert.rejects(criarBusca(db, 'instagram', ig, 1), /Meta insuficiente/);
    await criarBusca(db, 'maps', maps, 5);              // o normal segue intacto para Maps
    await asPostgres(db);
    await db.exec(`DELETE FROM lista_fria_buscas`);       // zera para testar o inverso
    await db.exec(`DELETE FROM lista_fria_creditos WHERE tipo = 'normal'`);
    await as(db, U_LIBERADO);
    await assert.rejects(criarBusca(db, 'maps', maps, 1), (e) => /Saldo de créditos insuficiente/.test(e.message) && e.detail === 'creditos_insuficientes');
    await assert.rejects(criarBusca(db, 'cnpj', { cnaes: ['4639'], uf: 'SP' }, 1), /insuficiente/);
  } finally { await db.close(); }
});

test('a sobra volta para o saldo de onde a reserva saiu', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 50, 'meta');
    await as(db, U_LIBERADO);
    const m = await criarBusca(db, 'maps', maps, 5);
    const i = await criarBusca(db, 'instagram', ig, 10);
    await asWorker(db);
    const a = await one(db, `SELECT id, fonte FROM lista_fria_worker_reivindicar('w1')`);
    const b = await one(db, `SELECT id, fonte FROM lista_fria_worker_reivindicar('w1')`);
    assert.deepEqual([a.fonte, b.fonte].sort(), ['instagram', 'maps']);
    await registrar(db, m, 'w1', [item('a', { telefone: '11999990001' }), item('b', { telefone: '11999990002' })]);
    await registrar(db, i, 'w1', [item('x', { telefone: '11999990003' }), item('y', { email: 'y@teste.com.br' }), item('z', { telefone: '11999990004' })]);
    await db.query(`SELECT lista_fria_worker_encerrar('${m}', 'w1', 'concluida')`);
    await db.query(`SELECT lista_fria_worker_encerrar('${i}', 'w1', 'concluida')`);
    await asPostgres(db);
    const dev = (await db.query(`SELECT tipo, delta FROM lista_fria_creditos WHERE motivo = 'devolucao' ORDER BY tipo`)).rows;
    assert.deepEqual(dev, [{ tipo: 'meta', delta: 7 }, { tipo: 'normal', delta: 3 }], 'Instagram devolve 10-3 ao Meta; Maps devolve 5-2 ao normal');
    await as(db, U_LIBERADO);
    assert.deepEqual(await saldos(db), { normal: 98, meta: 47 });
  } finally { await db.close(); }
});

test('cancelar a busca de Instagram devolve a reserva inteira ao saldo Meta', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 50, 'meta');
    await as(db, U_LIBERADO);
    const i = await criarBusca(db, 'instagram', ig, 20);
    assert.deepEqual(await saldos(db), { normal: 100, meta: 30 });
    await db.query(`SELECT lista_fria_busca_cancelar('${i}')`);
    assert.deepEqual(await saldos(db), { normal: 100, meta: 50 }, 'voltou para o Meta, o normal não mexeu');
  } finally { await db.close(); }
});

test('quem não tem permissão na Lista fria não lê os saldos', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 10, 'meta');
    await as(db, U_MEMBRO);
    await assert.rejects(db.query(`SELECT lista_fria_saldos('${TORQUE}')`), /permissão para usar a Lista fria/);
    await assert.rejects(db.query(`SELECT private.lista_fria_saldo_da_org('${TORQUE}', 'meta')`), /permission denied/, 'a função interna não é chamável pelo usuário');
  } finally { await db.close(); }
});

test('rollback: recusa com crédito Meta no livro; sem ele, volta ao saldo único', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 50, 'meta');
    await asPostgres(db);
    await assert.rejects(db.exec(read(ROLLBACK_META)), /Há créditos Meta no livro/);
    await db.exec('ROLLBACK'); // o script abre BEGIN; ao recusar, a transação fica aberta
    await db.exec(`DELETE FROM lista_fria_creditos WHERE tipo = 'meta'`);
    await db.exec(read(ROLLBACK_META));
    assert.equal(await val(db, `SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'lista_fria_creditos' AND column_name = 'tipo'`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname IN ('lista_fria_saldos', 'lista_fria_tipo_da_fonte')`), 0);
    await as(db, U_MASTER);
    assert.equal(await val(db, `SELECT lista_fria_creditos_conceder('${TORQUE}', 5, 'volta')`), 105, 'a concessão de 3 argumentos voltou');
    await as(db, U_LIBERADO);
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 105);
    await criarBusca(db, 'instagram', ig, 5); // de novo gasta do saldo único
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 100);
  } finally { await db.close(); }
});
