// Lista Fria · divisão dos contatos por tipo (com @, telefone, e-mail) e seleção "E" (migration 20271223000000).
//
// Cobre as duas RPCs num Postgres real (PGlite): contagens por tipo, a combinação "E", a seleção exata, o que fica
// de fora (já é lead, já importado), o isolamento por org e por permissão, e o rollback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLLBACK_DIVISAO, U_ADMIN, U_MEMBRO, U_LIBERADO, U_OUTRA, TORQUE,
  read, setup, as, asWorker, asPostgres, val, one, criarBusca, item, registrar, comSaldo,
} from './helpers/lista-fria-db.mjs';

const ig = { url: 'https://www.instagram.com/clinica/' };
const INEXISTENTE = '00000000-0000-4000-8000-0000000000ff';
const divisao = async (db, b, a = false, t = false, e = false) =>
  (await one(db, `SELECT lista_fria_resultados_divisao('${b}', ${a}, ${t}, ${e}) AS d`)).d;
const por = (db, b, a = false, t = false, e = false) =>
  val(db, `SELECT lista_fria_resultados_selecionar_por_contato('${b}', ${a}, ${t}, ${e})`);
const marcados = async (db, b) => {
  await asPostgres(db);
  return (await db.query(`SELECT ref_externa FROM lista_fria_resultados WHERE busca_id = '${b}' AND selecionado AND lead_id IS NULL AND NOT ja_e_lead ORDER BY ref_externa`)).rows.map((r) => r.ref_externa);
};

/** Uma busca de Instagram com 6 contatos: cada combinação de tipo aparece. */
async function buscaComContatos(db) {
  await comSaldo(db, 100, 'meta');
  await as(db, U_LIBERADO);
  const b = await criarBusca(db, 'instagram', ig, 50);
  await asWorker(db);
  await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
  await registrar(db, b, 'w1', [
    item('so_arroba', { instagram: 'so_arroba', email: 'a@x.com.br' }), // @ + e-mail
    item('tudo', { instagram: 'tudo', telefone: '11999990001', email: 'b@x.com.br' }), // @ + telefone + e-mail
    item('arroba_tel', { instagram: 'arroba_tel', telefone: '11999990002' }), // @ + telefone
    item('so_tel', { telefone: '11999990003' }), // telefone
    item('tel_email', { telefone: '11999990004', email: 'c@x.com.br' }), // telefone + e-mail
    item('so_email', { email: 'd@x.com.br' }), // e-mail
  ]);
  await db.query(`SELECT lista_fria_worker_encerrar('${b}', 'w1', 'concluida')`);
  return b;
}

test('a divisão conta cada tipo e a combinação "E" dos marcados', async () => {
  const db = await setup();
  try {
    const b = await buscaComContatos(db);
    await as(db, U_LIBERADO);
    const d = await divisao(db, b);
    assert.deepEqual([d.novos, d.com_instagram, d.com_telefone, d.com_email, d.combinacao], [6, 3, 4, 4, 6], 'sem nada marcado, a combinação é todos os novos');
    assert.equal((await divisao(db, b, true)).combinacao, 3, 'só @');
    assert.equal((await divisao(db, b, false, true)).combinacao, 4, 'só telefone');
    assert.equal((await divisao(db, b, true, true)).combinacao, 2, '@ E telefone: tudo + arroba_tel');
    assert.equal((await divisao(db, b, false, true, true)).combinacao, 2, 'telefone E e-mail: tudo + tel_email');
    assert.equal((await divisao(db, b, true, true, true)).combinacao, 1, 'os três: só "tudo"');
    assert.equal((await divisao(db, b, true, false, true)).combinacao, 2, '@ E e-mail: so_arroba + tudo');
  } finally { await db.close(); }
});

test('selecionar por contato marca EXATAMENTE quem tem todos os tipos e desmarca o resto', async () => {
  const db = await setup();
  try {
    const b = await buscaComContatos(db);
    await as(db, U_LIBERADO);
    assert.equal(await por(db, b, true, true), 2);
    assert.deepEqual(await marcados(db, b), ['arroba_tel', 'tudo']);
    await as(db, U_LIBERADO);
    const d = await divisao(db, b);
    assert.deepEqual([d.selecionados, d.selecionados_com_instagram, d.selecionados_com_telefone, d.selecionados_com_email], [2, 2, 2, 1]);

    await as(db, U_LIBERADO);
    assert.equal(await por(db, b, false, false, true), 4, 'trocar o critério troca a seleção (não soma)');
    assert.deepEqual(await marcados(db, b), ['so_arroba', 'so_email', 'tel_email', 'tudo']);

    await as(db, U_LIBERADO);
    assert.equal(await por(db, b), 6, 'nenhum tipo marcado = todos os novos');
    assert.equal((await marcados(db, b)).length, 6);
  } finally { await db.close(); }
});

test('quem já é lead ou já foi importado fica de fora das contagens e nunca é marcado', async () => {
  const db = await setup();
  try {
    await asPostgres(db);
    await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('${TORQUE}', 'Já cliente', '5511999990003')`);
    const b = await buscaComContatos(db); // 'so_tel' tem o telefone do lead: entra marcado como já-é-lead
    await asPostgres(db);
    assert.equal(await val(db, `SELECT ja_e_lead FROM lista_fria_resultados WHERE busca_id = '${b}' AND ref_externa = 'so_tel'`), true);
    await db.exec(`UPDATE lista_fria_resultados SET lead_id = (SELECT id FROM leads LIMIT 1) WHERE busca_id = '${b}' AND ref_externa = 'so_email'`); // simula já importado
    await as(db, U_LIBERADO);
    const d = await divisao(db, b);
    assert.deepEqual([d.novos, d.com_telefone, d.com_email], [4, 3, 3], 'so_tel (lead) e so_email (importado) não contam');
    assert.equal(await por(db, b), 4);
    const m = await marcados(db, b);
    assert.equal(m.includes('so_tel'), false);
    assert.equal(m.includes('so_email'), false);
  } finally { await db.close(); }
});

test('só quem tem permissão na Lista fria usa: ver para contar, editar para marcar; outra org não alcança', async () => {
  const db = await setup();
  try {
    const b = await buscaComContatos(db);
    await as(db, U_MEMBRO);
    await assert.rejects(divisao(db, b), /permissão para usar a Lista fria/, 'sem permissão não conta');
    await assert.rejects(por(db, b, true), /permissão/, 'sem permissão não marca');
    await as(db, U_OUTRA);
    await assert.rejects(divisao(db, b), (e) => /Acesso negado|permiss|Lista fria/.test(e.message), 'admin de outra org não vê');
    await assert.rejects(por(db, b, true), (e) => /Acesso negado|permiss|Lista fria/.test(e.message), 'nem marca');
    await as(db, U_ADMIN);
    assert.equal((await divisao(db, b)).novos, 6, 'admin da org vê');
    await assert.rejects(divisao(db, INEXISTENTE), /Busca não encontrada/);
    await assert.rejects(por(db, INEXISTENTE), /Busca não encontrada/);
  } finally { await db.close(); }
});

test('anon não executa; critérios nulos contam como "não marcado"', async () => {
  const db = await setup();
  try {
    const b = await buscaComContatos(db);
    await asPostgres(db);
    await db.exec(`RESET ROLE; SET ROLE anon`);
    await assert.rejects(db.query(`SELECT lista_fria_resultados_divisao('${b}')`), /permission denied/);
    await as(db, U_LIBERADO);
    const d = (await one(db, `SELECT lista_fria_resultados_divisao('${b}', NULL, NULL, NULL) AS d`)).d;
    assert.equal(d.combinacao, 6);
    assert.equal(await val(db, `SELECT lista_fria_resultados_selecionar_por_contato('${b}', NULL, NULL, NULL)`), 6);
  } finally { await db.close(); }
});

test('rollback remove só as duas RPCs e não mexe nos resultados', async () => {
  const db = await setup();
  try {
    const b = await buscaComContatos(db);
    await asPostgres(db);
    await db.exec(read(ROLLBACK_DIVISAO));
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname IN ('lista_fria_resultados_divisao', 'lista_fria_resultados_selecionar_por_contato')`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_resultados WHERE busca_id = '${b}'`), 6);
  } finally { await db.close(); }
});
