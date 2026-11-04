// Lista Fria · fonte CNPJ — a migration 20271219000000 num Postgres real (PGlite).
//
// Cobre o que mudou no banco: a busca de CNPJ (validação, normalização, reserva), a restrição que
// liga cada fonte ao seu alvo, a entrega dos filtros ao worker e o rollback. O fluxo de créditos,
// importação e guardas é o da fundação e já tem teste em lista-fria-fundacao.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLLBACK_CNPJ, ROLLBACK_META, ROLLBACK_VARREDURA, ROLLBACK_POR_CREDITOS, TORQUE, U_ADMIN, read, setup, as, asWorker, asPostgres, one, val, maps, criarBusca, comSaldo,
} from './helpers/lista-fria-db.mjs';

const cnpj = { cnaes: ['4639'], uf: 'SP' };

test('busca de CNPJ: guarda os filtros normalizados e reserva os créditos', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 500);
    await as(db, U_ADMIN);
    const id = await criarBusca(db, 'cnpj', {
      cnaes: ['46.39-7-01', '4639701', ' 8630 ', '5611'], uf: ' sp ', municipio: ' SAO PAULO ', contato: 'email',
    }, 200);
    await asPostgres(db);
    const b = await one(db, `SELECT fonte, nicho, cidade, instagram_handle, filtros, status, creditos_limite FROM lista_fria_buscas WHERE id = '${id}'`);
    assert.equal(b.fonte, 'cnpj');
    assert.equal(b.nicho, null);
    assert.equal(b.cidade, null);
    assert.equal(b.instagram_handle, null);
    assert.equal(b.status, 'na_fila');
    assert.equal(b.creditos_limite, 200);
    assert.deepEqual(b.filtros, { cnaes: ['4639701', '5611', '8630'], uf: 'SP', municipio: 'SAO PAULO', contato: 'email' }, 'sem repetição, só dígitos, UF maiúscula');
    assert.equal(await val(db, `SELECT private.lista_fria_saldo_da_org('${TORQUE}')`), 300, 'a reserva saiu do saldo');
  } finally { await db.close(); }
});

test('busca de CNPJ: município some do filtro quando vazio e contato assume "qualquer"', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_ADMIN);
    const id = await criarBusca(db, 'cnpj', { ...cnpj, municipio: '   ' }, 10);
    await asPostgres(db);
    assert.deepEqual((await one(db, `SELECT filtros FROM lista_fria_buscas WHERE id = '${id}'`)).filtros, { cnaes: ['4639'], uf: 'SP', contato: 'qualquer' });
  } finally { await db.close(); }
});

test('busca de CNPJ: alvo inválido é recusado e não reserva nada', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_ADMIN);
    const muitos = Array.from({ length: 21 }, (_, i) => String(1000 + i));
    const ruins = [
      [{ uf: 'SP' }, 'sem cnaes'],
      [{ cnaes: 'x', uf: 'SP' }, 'cnaes não é lista'],
      [{ cnaes: [], uf: 'SP' }, 'lista vazia'],
      [{ cnaes: ['abc', '1'], uf: 'SP' }, 'nenhum código válido'],
      [{ cnaes: muitos, uf: 'SP' }, 'mais de 20'],
      [{ cnaes: ['4639'] }, 'sem UF'],
      [{ cnaes: ['4639'], uf: 'XX' }, 'UF inexistente'],
      [{ cnaes: ['4639'], uf: 'SP', municipio: 'x' }, 'município curto'],
      [{ cnaes: ['4639'], uf: 'SP', municipio: 'A'.repeat(81) }, 'município longo'],
      [{ cnaes: ['4639'], uf: 'SP', contato: 'sms' }, 'contato desconhecido'],
    ];
    for (const [params, porque] of ruins) {
      await assert.rejects(criarBusca(db, 'cnpj', params, 10), /Escolha|inválido/, porque);
    }
    await asPostgres(db);
    assert.equal(await val(db, `SELECT private.lista_fria_saldo_da_org('${TORQUE}')`), 100, 'nada foi reservado');
    assert.equal(await val(db, `SELECT count(*) FROM lista_fria_buscas`), 0);
  } finally { await db.close(); }
});

test('a restrição liga cada fonte ao seu alvo (nada de alvo misto)', async () => {
  const db = await setup();
  try {
    await asPostgres(db);
    const ins = (cols, vals) => db.query(`INSERT INTO lista_fria_buscas (organization_id, creditos_limite, ${cols}) VALUES ('${TORQUE}', 1, ${vals})`);
    await assert.rejects(ins('fonte, filtros', `'cnpj', NULL`), /fonte_tem_alvo/, 'cnpj sem filtros');
    await assert.rejects(ins('fonte, filtros, nicho, cidade', `'cnpj', '{"uf":"SP"}', 'Dentistas', 'SP'`), /fonte_tem_alvo/, 'cnpj com nicho');
    await assert.rejects(ins('fonte, filtros, instagram_handle', `'cnpj', '{"uf":"SP"}', 'abc'`), /fonte_tem_alvo/, 'cnpj com @');
    await assert.rejects(ins('fonte, nicho, cidade, filtros', `'maps', 'Dentistas', 'SP', '{"uf":"SP"}'`), /fonte_tem_alvo/, 'maps com filtros');
    await assert.rejects(ins('fonte, instagram_handle, filtros', `'instagram', 'abc', '{"uf":"SP"}'`), /fonte_tem_alvo/, 'instagram com filtros');
    await assert.rejects(ins('fonte, filtros', `'cnpj', '[1]'`), /filtros_objeto/, 'filtros tem de ser objeto');
    await assert.rejects(ins('fonte, filtros', `'cnpj', '${JSON.stringify({ x: 'a'.repeat(2100) })}'`), /filtros_objeto/, 'filtros com teto de tamanho');
    await assert.rejects(ins('fonte, nicho, cidade', `'tiktok', 'aaa', 'bbb'`), /fonte_check/, 'fonte desconhecida');
    await ins('fonte, nicho, cidade', `'maps', 'Dentistas', 'São Paulo - SP'`);
    await ins('fonte, instagram_handle', `'instagram', 'clinica'`);
  } finally { await db.close(); }
});

test('Maps e Instagram seguem criando busca sem filtros', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await comSaldo(db, 50, 'meta');
    await as(db, U_ADMIN);
    const m = await criarBusca(db, 'maps', maps, 5);
    const i = await criarBusca(db, 'instagram', { url: 'https://www.instagram.com/clinica/' }, 10);
    await asPostgres(db);
    assert.equal(await val(db, `SELECT filtros IS NULL FROM lista_fria_buscas WHERE id = '${m}'`), true);
    assert.equal(await val(db, `SELECT instagram_handle FROM lista_fria_buscas WHERE id = '${i}'`), 'clinica');
    await as(db, U_ADMIN);
    await assert.rejects(criarBusca(db, 'tiktok', {}, 5), /Fonte inválida/);
  } finally { await db.close(); }
});

test('o worker recebe os filtros ao reivindicar a busca', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_ADMIN);
    const id = await criarBusca(db, 'cnpj', { ...cnpj, contato: 'ambos' }, 25);
    await asWorker(db);
    const b = await one(db, `SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    assert.equal(b.id, id);
    assert.equal(b.fonte, 'cnpj');
    assert.deepEqual(b.filtros, { cnaes: ['4639'], uf: 'SP', contato: 'ambos' });
    assert.equal(b.creditos_limite, 25);
  } finally { await db.close(); }
});

test('rollback: recusa com busca de CNPJ; sem ela, devolve as duas fontes antigas', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_ADMIN);
    await criarBusca(db, 'cnpj', cnpj, 10);
    await asPostgres(db);
    await db.exec(read(ROLLBACK_POR_CREDITOS));
    await db.exec(read(ROLLBACK_VARREDURA)); // empilhadas: varredura e créditos Meta saem antes da de CNPJ
    await db.exec(read(ROLLBACK_META)); // empilhadas: a de créditos Meta sai antes da de CNPJ
    await assert.rejects(db.exec(read(ROLLBACK_CNPJ)), /Há buscas de CNPJ/);
    await db.exec('ROLLBACK'); // o script abre BEGIN; ao recusar, a transação fica aberta
    await db.query(`DELETE FROM lista_fria_buscas WHERE fonte = 'cnpj'`);
    await db.exec(read(ROLLBACK_CNPJ));
    assert.equal(await val(db, `SELECT count(*) FROM information_schema.columns WHERE table_name = 'lista_fria_buscas' AND column_name = 'filtros'`), 0);
    await as(db, U_ADMIN);
    await assert.rejects(criarBusca(db, 'cnpj', cnpj, 10), /Fonte inválida/);
    await criarBusca(db, 'maps', maps, 5);
    await criarBusca(db, 'instagram', { url: '@clinica' }, 5);
  } finally { await db.close(); }
});
