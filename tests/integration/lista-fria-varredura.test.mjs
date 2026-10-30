// Lista Fria · crédito Meta cobrado por seguidor varrido (ADR-0046).
//
// Cobre a migration 20271221000000 num Postgres real (PGlite): a reserva fixa do Instagram, o débito
// progressivo e monotônico, o teto na reserva, o contato que não gasta crédito, a devolução de metade quando
// a busca termina sem nenhum resultado, a auditoria (varridos e custo) e o rollback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLLBACK_VARREDURA, TORQUE, U_ADMIN, U_LIBERADO,
  read, setup, as, asWorker, asPostgres, one, val, maps, criarBusca, item, registrar, comSaldo,
} from './helpers/lista-fria-db.mjs';

const ig = { url: 'https://www.instagram.com/clinica/' };
const saldos = async (db) => (await one(db, `SELECT lista_fria_saldos('${TORQUE}') AS s`)).s;
// Lê como dono do banco: o custo real fica numa tabela que o cliente não alcança.
const busca = async (db, id) => (await asPostgres(db), one(db, `SELECT status, contatos_novos, cobranca, creditos_limite, creditos_usados, varridos, (SELECT custo_usd::float FROM lista_fria_busca_custos WHERE busca_id = b.id) AS custo_usd, seguidores_por_credito FROM lista_fria_buscas b WHERE id = '${id}'`));
const varrer = async (db, id, n, custo = null, worker = 'w1') =>
  val(db, `SELECT lista_fria_worker_varrer('${id}', '${worker}', ${n}, ${custo === null ? 'NULL' : custo})`);

/** Cria a busca de Instagram, deixa o worker w1 reivindicá-la e volta como worker. */
async function instagramEmAndamento(db, pedido = 10) {
  await comSaldo(db, 100, 'meta');
  await as(db, U_LIBERADO);
  const id = await criarBusca(db, 'instagram', ig, pedido);
  await asWorker(db);
  await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
  return id;
}

// Primeiro a sobra da reserva, depois (se houver) a metade da busca sem contato: a ordem é a da nota.
const devolucoes = async (db, id) => {
  await asPostgres(db);
  return (await db.query(`SELECT delta, nota FROM lista_fria_creditos WHERE busca_id = '${id}' AND motivo = 'devolucao' ORDER BY nota DESC`)).rows;
};

test('o Instagram reserva 50 créditos Meta, por varredura, não importa o que o cliente pediu; Maps e CNPJ seguem por contato', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 120, 'meta');
    await as(db, U_LIBERADO);
    for (const pedido of [1, 10, 100000]) {
      const i = await criarBusca(db, 'instagram', ig, pedido);
      assert.deepEqual(await busca(db, i), { status: 'na_fila', contatos_novos: 0, cobranca: 'por_varredura', creditos_limite: 50, creditos_usados: 0, varridos: 0, custo_usd: null, seguidores_por_credito: 1 }, `pedido ${pedido}`);
      await db.query(`SELECT lista_fria_busca_cancelar('${i}')`);
    }
    const m = await criarBusca(db, 'maps', maps, 7);
    const c = await criarBusca(db, 'cnpj', { cnaes: ['4639'], uf: 'SP' }, 9);
    assert.deepEqual([(await busca(db, m)).cobranca, (await busca(db, c)).cobranca], ['por_contato', 'por_contato']);
    assert.deepEqual([(await busca(db, m)).creditos_limite, (await busca(db, c)).creditos_limite], [7, 9], 'só o Instagram ignora o pedido');
  } finally { await db.close(); }
});

test('com menos de 50 créditos Meta a busca de Instagram é recusada, mesmo pedindo 1', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 49, 'meta');
    await as(db, U_LIBERADO);
    await assert.rejects(criarBusca(db, 'instagram', ig, 1), (e) => /Meta insuficiente/.test(e.message) && e.detail === 'creditos_meta_insuficientes');
    assert.deepEqual(await saldos(db), { normal: 0, meta: 49 }, 'nada foi reservado');
  } finally { await db.close(); }
});

test('o débito é progressivo, monotônico e para na reserva', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    assert.deepEqual(await varrer(db, id, 20, 0.24), { ativa: true, cobrando: true, creditos_usados: 20, limite_atingido: false });
    assert.equal((await busca(db, id)).creditos_usados, 20);

    // Chamada repetida, atrasada ou menor: não cobra de novo e não desfaz.
    assert.equal((await varrer(db, id, 20, 0.24)).creditos_usados, 20, 'repetir não cobra duas vezes');
    assert.equal((await varrer(db, id, 5, 0.01)).creditos_usados, 20, 'um total menor (chamada atrasada) não desfaz');
    assert.deepEqual(await busca(db, id), { ...(await busca(db, id)), varridos: 20, custo_usd: 0.24 }, 'varridos e custo só crescem');

    assert.equal((await varrer(db, id, 33, 0.4)).creditos_usados, 33);
    const fim = await varrer(db, id, 80, 1.0); // a Apify entregou além da reserva
    assert.deepEqual(fim, { ativa: true, cobrando: true, creditos_usados: 50, limite_atingido: true }, 'o cliente nunca paga acima da reserva');
    assert.equal((await busca(db, id)).varridos, 80, 'o que a Apify processou fica registrado para a auditoria');
    // A constraint usados <= limite nunca é violada: nenhuma chamada lançou.
  } finally { await db.close(); }
});

test('entrada ruim não corrompe a cobrança: negativo, nulo e absurdo', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 10, 0.1);
    assert.equal((await varrer(db, id, -5, -1)).creditos_usados, 10, 'negativo não reduz');
    assert.equal(await val(db, `SELECT (lista_fria_worker_varrer('${id}', 'w1', NULL, NULL) ->> 'creditos_usados')::int`), 10, 'nulo não muda nada');
    assert.equal((await busca(db, id)).custo_usd, 0.1, 'custo nulo ou negativo não apaga o que já havia');
    assert.equal((await varrer(db, id, 2_000_000_000, 99999999)).creditos_usados, 50, 'absurdo é cortado na reserva, sem estourar o inteiro');
  } finally { await db.close(); }
});

test('só o worker dono de uma busca em execução varre; busca fechada não cobra mais', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    assert.equal((await varrer(db, id, 10, null, 'outro-worker')).ativa, false, 'worker que não é o dono');
    assert.equal((await busca(db, id)).creditos_usados, 0);

    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    const depois = await varrer(db, id, 40);
    assert.equal(depois.ativa, false);
    assert.equal((await busca(db, id)).creditos_usados, 0, 'depois de encerrada, nada é cobrado');
  } finally { await db.close(); }
});

test('só a chave de serviço chama a RPC de varredura, e o custo real nunca chega ao cliente', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 10, 0.12);
    await as(db, U_ADMIN);
    await assert.rejects(db.query(`SELECT lista_fria_worker_varrer('${id}', 'w1', 50, 0)`), /permission denied/, 'usuário logado não se cobra menos nem mais');
    await as(db, U_LIBERADO);
    await assert.rejects(db.query(`SELECT * FROM lista_fria_busca_custos`), /permission denied/, 'o custo (a margem da casa) não é lido pelo cliente');
    const linha = await one(db, `SELECT * FROM lista_fria_buscas WHERE id = '${id}'`);
    assert.equal(Object.keys(linha).some((k) => /custo/.test(k)), false, 'e `select *` da busca não o traz');
  } finally { await db.close(); }
});

test('contato achado não gasta crédito: o registro de uma busca por varredura não cobra nem corta o lote', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    const itens = Array.from({ length: 12 }, (_, n) => item(`c${n}`, { telefone: `1199999${String(1000 + n)}` }));
    const r = await registrar(db, id, 'w1', itens);
    assert.deepEqual([r.aceitos, r.limite_atingido, r.ativa], [12, false, true], 'os 12 entram, sem cobrar e sem sinal de limite');
    assert.deepEqual([(await busca(db, id)).creditos_usados, (await busca(db, id)).contatos_novos], [0, 12], 'conta os contatos, não os créditos');

    await varrer(db, id, 50);
    const r2 = await registrar(db, id, 'w1', [item('tardio', { email: 'tardio@teste.com.br' })]);
    assert.equal(r2.aceitos, 1, 'o que foi varrido e pago entra mesmo com a reserva no fim');
    assert.equal(r2.limite_atingido, false, 'quem encerra a busca é o varrer, não o registro');
  } finally { await db.close(); }
});

test('com resultado: a sobra da reserva volta e nada além disso', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await registrar(db, id, 'w1', [item('a', { telefone: '11999990001' })]);
    await varrer(db, id, 20, 0.24);
    await asWorker(db);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    assert.deepEqual((await devolucoes(db, id)).map((d) => d.delta), [30], 'devolve 50 - 20');
    assert.equal((await busca(db, id)).creditos_usados, 20);
    await as(db, U_LIBERADO);
    assert.deepEqual(await saldos(db), { normal: 0, meta: 80 }, '100 - 50 + 30');
  } finally { await db.close(); }
});

test('SEM nenhum resultado: devolve metade dos créditos gastos, arredondada para baixo, além da sobra', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 41, 0.49);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    const dev = await devolucoes(db, id);
    assert.deepEqual(dev.map((d) => d.delta), [9, 20], 'sobra 50-41 = 9; metade de 41 = 20 (para baixo)');
    assert.match(dev[1].nota, /sem nenhum contato/);
    const b = await busca(db, id);
    assert.equal(b.creditos_usados, 21, 'o cliente pagou 21 dos 41 varridos');
    assert.equal(b.status, 'concluida');
    await as(db, U_LIBERADO);
    assert.deepEqual(await saldos(db), { normal: 0, meta: 79 }, '100 - 50 + 9 + 20 = 79');
  } finally { await db.close(); }
});

test('a busca de 50 sem contato fecha em 25 créditos pagos (R$ 3,75 a R$ 0,15), como o ADR', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 50, 0.6);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    assert.equal((await busca(db, id)).creditos_usados, 25);
    assert.deepEqual((await devolucoes(db, id)).map((d) => d.delta), [25], 'sobra 0, metade de 50 = 25');
  } finally { await db.close(); }
});

test('resultado que já é lead conta como resultado: não é "zero" e não devolve metade', async () => {
  const db = await setup();
  try {
    await asPostgres(db);
    await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('${TORQUE}', 'Já cliente', '5511993195517')`);
    const id = await instagramEmAndamento(db);
    const r = await registrar(db, id, 'w1', [item('bia', { telefone: '11993195517' })]);
    assert.deepEqual([r.aceitos, r.ja_eram_leads], [0, 1]);
    await varrer(db, id, 30);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    assert.deepEqual((await devolucoes(db, id)).map((d) => d.delta), [20], 'só a sobra');
    assert.equal((await busca(db, id)).creditos_usados, 30);
  } finally { await db.close(); }
});

test('busca que falha sem resultado também devolve metade; a que o usuário para, não; zero varridos, nada', async () => {
  const db = await setup();
  try {
    // Falhou depois de varrer 10: o cliente não fica com a falha.
    const f = await instagramEmAndamento(db);
    await varrer(db, f, 10);
    await db.query(`SELECT lista_fria_worker_encerrar('${f}', 'w1', 'falhou', 'coletor_falhou')`);
    assert.deepEqual((await devolucoes(db, f)).map((d) => d.delta), [40, 5]);
    assert.equal((await busca(db, f)).creditos_usados, 5);

    // Falhou sem varrer nada: só volta a reserva.
    await as(db, U_LIBERADO);
    const z = await criarBusca(db, 'instagram', ig, 1);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await db.query(`SELECT lista_fria_worker_encerrar('${z}', 'w1', 'falhou', 'coletor_falhou')`);
    assert.deepEqual((await devolucoes(db, z)).map((d) => d.delta), [50]);

    // O usuário para a busca depois de varrer 30 (sem resultado): ele mesmo parou, não há "metade".
    await as(db, U_LIBERADO);
    const c = await criarBusca(db, 'instagram', ig, 1);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await varrer(db, c, 30);
    await as(db, U_LIBERADO);
    await db.query(`SELECT lista_fria_busca_cancelar('${c}')`);
    assert.deepEqual((await devolucoes(db, c)).map((d) => d.delta), [20], 'só a sobra');
    assert.equal((await busca(db, c)).status, 'parada');
    assert.equal((await busca(db, c)).creditos_usados, 30, 'paga o que o coletor já varreu');
  } finally { await db.close(); }
});

test('encerrar duas vezes não devolve duas vezes (idempotente)', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 40);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    await asPostgres(db);
    await db.query(`SELECT private.lista_fria_encerrar('${id}', 'falhou', 'de novo')`);
    assert.deepEqual((await devolucoes(db, id)).map((d) => d.delta), [10, 20]);
    assert.equal((await busca(db, id)).status, 'concluida');
  } finally { await db.close(); }
});

test('worker que morreu no meio: a recuperação devolve a sobra e a metade, pelo mesmo caminho', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 24);
    await asPostgres(db);
    await db.exec(`UPDATE lista_fria_buscas SET heartbeat_at = now() - interval '11 minutes' WHERE id = '${id}'`);
    await asWorker(db);
    assert.equal(await val(db, `SELECT lista_fria_worker_recuperar_travadas()`), 1);
    assert.deepEqual((await devolucoes(db, id)).map((d) => d.delta), [26, 12]);
  } finally { await db.close(); }
});

test('Maps e CNPJ não mudam: cobram por contato, não devolvem metade, e a varredura só audita', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_LIBERADO);
    const m = await criarBusca(db, 'maps', maps, 5);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);

    const r = await registrar(db, m, 'w1', [item('a', { telefone: '11999990001' }), item('b', { telefone: '11999990002' })]);
    assert.deepEqual([r.aceitos, r.limite_atingido], [2, false]);
    const v = await varrer(db, m, 40, 0.3);
    assert.deepEqual(v, { ativa: true, cobrando: false, creditos_usados: 2, limite_atingido: false }, 'só audita');
    assert.deepEqual(await busca(db, m), { ...(await busca(db, m)), creditos_usados: 2, varridos: 40, custo_usd: 0.3 });

    const lote = Array.from({ length: 4 }, (_, n) => item(`x${n}`, { telefone: `1199998${String(1000 + n)}` }));
    assert.equal((await registrar(db, m, 'w1', lote)).limite_atingido, true, 'por contato ainda para no limite');
    assert.equal((await busca(db, m)).creditos_usados, 5);

    // Maps sem resultado nenhum não devolve metade.
    await as(db, U_LIBERADO);
    const vazio = await criarBusca(db, 'maps', { nicho: 'Padarias', cidade: 'Recife - PE' }, 8);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await db.query(`SELECT lista_fria_worker_encerrar('${vazio}', 'w1', 'concluida')`);
    assert.deepEqual((await devolucoes(db, vazio)).map((d) => d.delta), [8], 'só a reserva volta');
  } finally { await db.close(); }
});

test('busca de Instagram já em andamento ANTES da migration segue por contato', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100, 'meta');
    await as(db, U_LIBERADO);
    const id = await criarBusca(db, 'instagram', ig, 10);
    // Simula a busca criada antes: modo antigo e reserva de 10.
    await asPostgres(db);
    await db.exec(`UPDATE lista_fria_buscas SET cobranca = 'por_contato', creditos_limite = 10 WHERE id = '${id}'`);
    await db.exec(`UPDATE lista_fria_creditos SET delta = -10 WHERE busca_id = '${id}' AND motivo = 'reserva'`);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await registrar(db, id, 'w1', [item('a', { telefone: '11999990001' }), item('b', { telefone: '11999990002' })]);
    assert.equal((await varrer(db, id, 50, 0.6)).cobrando, false, 'varrer não cobra busca por contato');
    assert.equal((await busca(db, id)).creditos_usados, 2, 'cobrou os 2 contatos, como antes');
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`);
    assert.deepEqual((await devolucoes(db, id)).map((d) => d.delta), [8]);
  } finally { await db.close(); }
});

test('o livro fecha: concessão + reserva + devoluções = o saldo que o cliente vê', async () => {
  const db = await setup();
  try {
    const id = await instagramEmAndamento(db);
    await varrer(db, id, 33);
    await db.query(`SELECT lista_fria_worker_encerrar('${id}', 'w1', 'concluida')`); // zero resultados: sobra 17 + metade 16
    await asPostgres(db);
    const soma = await val(db, `SELECT sum(delta)::int FROM lista_fria_creditos WHERE tipo = 'meta'`);
    assert.equal(soma, 100 - 33 + 16, 'o cliente pagou 17 créditos');
    await as(db, U_LIBERADO);
    assert.equal((await saldos(db)).meta, soma);
    assert.equal((await busca(db, id)).creditos_usados, 17);
  } finally { await db.close(); }
});

test('rollback: recusa com busca por varredura; sem ela, volta ao modo por contato', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100, 'meta');
    await as(db, U_LIBERADO);
    const id = await criarBusca(db, 'instagram', ig, 10);
    await asPostgres(db);
    await assert.rejects(db.exec(read(ROLLBACK_VARREDURA)), /cobradas por varredura/);
    await db.exec('ROLLBACK'); // o script abre BEGIN; ao recusar, a transação fica aberta
    await db.exec(`DELETE FROM lista_fria_buscas WHERE id = '${id}'`);
    await db.exec(read(ROLLBACK_VARREDURA));
    assert.equal(await val(db, `SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'lista_fria_buscas' AND column_name IN ('cobranca', 'varridos', 'custo_usd', 'seguidores_por_credito')`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname = 'lista_fria_worker_varrer'`), 0);

    // Voltou o corpo anterior: o Instagram reserva o que o cliente pediu e cobra por contato.
    await db.exec(`DELETE FROM lista_fria_creditos WHERE motivo = 'reserva'`);
    await as(db, U_LIBERADO);
    const velho = await criarBusca(db, 'instagram', ig, 10);
    assert.equal(await val(db, `SELECT creditos_limite FROM lista_fria_buscas WHERE id = '${velho}'`), 10);
  } finally { await db.close(); }
});
