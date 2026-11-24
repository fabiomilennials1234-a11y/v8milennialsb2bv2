// Cobrança · pagamento dos títulos escolhidos (20280126000000) num Postgres
// real (PGlite).
//
// Cobre o caso que motivou a mudança — o cliente pagou dois de três títulos com
// o mesmo vencimento — e o contrato novo da RPC: baixa exatamente os escolhidos
// num lote só, valor parcial abate FIFO só entre eles, qualquer título inválido
// recusa o lote inteiro sem gravar nada, o evento diz quais títulos foram
// abatidos, as chamadas do front publicado (p_titulo, FIFO) seguem iguais, a
// porta de permissão continua na frente e o rollback pareado. GRANT/RLS do
// banco real ficam com o pgTAP (supabase/tests/cobranca_fundacao_test.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
const U_ADMIN = id(1);
const U_MEMBRO = id(2);
const TM_ADMIN = id(11);
const TM_MEMBRO = id(12);

const MIGRATIONS = [
  '20271212000000_cobranca_fundacao',
  '20271212000010_cobranca_endurecer_acl',
  '20271213000000_cobranca_regua',
  '20271214000000_cobranca_colunas_da_regua',
  '20280118010000_cobranca_trilhas_colunas_manuais_e_prazo',
  '20280120030000_cobranca_entrada_no_vencimento',
  '20280121000000_cobranca_importar_responsavel_e_observacoes',
  '20280121010000_cobranca_ordem_das_colunas',
  '20280123003000_cobranca_promessa_destino_e_prazo',
];
const NOVA = '20280126000000_cobranca_pagamento_por_titulo';

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${TORQUE}', 'TorqueCRM', 'torquecrm');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member');
  `);
  for (const m of MIGRATIONS) await db.exec(read(`../../supabase/migrations/${m}.sql`));
  // Só leitura: vê a ficha, não registra pagamento.
  await db.exec(`
    INSERT INTO member_feature_permissions (team_member_id, feature_key, enabled) VALUES
      ('${TM_MEMBRO}', 'cobranca.view', true);
  `);
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

/** Cadastra um devedor com títulos e devolve { inad, caso, titulo(numero) → id }. */
async function devedor(db, nome, titulos) {
  await as(db, U_ADMIN);
  const inad = await val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL,
    '${JSON.stringify({ nome, telefone: '5548999990001', titulos }).replace(/'/g, "''")}'::jsonb)`);
  const caso = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`);
  const ids = Object.fromEntries(
    (await rows(db, `SELECT numero, id FROM cobranca_titulos WHERE inadimplente_id = '${inad}'`)).map((r) => [r.numero, r.id]),
  );
  return { inad, caso, titulo: (numero) => ids[numero] };
}

const situacao = async (db, inad) =>
  Object.fromEntries(
    (await rows(db, `SELECT numero, status, pago_em::text AS pago_em, saldo::text AS saldo
                       FROM cobranca_titulos_saldo WHERE inadimplente_id = '${inad}'`))
      .map((r) => [r.numero, { status: r.status, pagoEm: r.pago_em, saldo: r.saldo }]),
  );

const pagar = (db, caso, valor, titulos, pagoEm = '2026-11-23') =>
  val(db, `SELECT cobranca_pagamento_registrar('${caso}', ${valor}, '${pagoEm}',
    p_titulos => ARRAY[${titulos.map((t) => `'${t}'`).join(', ')}]::uuid[])`);

// Os três títulos do relato do cliente (24/11): mesmo vencimento, valores distintos.
const TRES_TITULOS = [
  { numero: '20311.01', valor: 318.98, vencimento: '2026-11-23' },
  { numero: '20311.02', valor: 500.81, vencimento: '2026-11-23' },
  { numero: '20311.03', valor: 337.33, vencimento: '2026-11-23' },
];

test('paga dois de três títulos do mesmo vencimento: baixa exatamente os escolhidos, num lote só', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Distribuidora Exemplo', TRES_TITULOS);
    // A recusa sai em formato brasileiro, qualquer que seja o lc_numeric (prod é en_US).
    await assert.rejects(
      db.query(`SELECT cobranca_pagamento_registrar('${d.caso}', 2000, '2026-11-23')`),
      /passa do saldo em aberto \(R\$ 1\.157,12\)/,
    );
    // Escolhe o 1º e o 3º — o FIFO, com vencimento empatado, nunca pularia o do meio.
    const r = await pagar(db, d.caso, 656.31, [d.titulo('20311.01'), d.titulo('20311.03')]);

    assert.equal(r.quitado, false);
    assert.equal(Number(r.saldo_restante), 500.81);
    assert.deepEqual(
      r.titulos.map((t) => [t.numero, Number(t.valor), t.quitado]).sort(),
      [['20311.01', 318.98, true], ['20311.03', 337.33, true]],
    );
    assert.deepEqual(await situacao(db, d.inad), {
      '20311.01': { status: 'pago', pagoEm: '2026-11-23', saldo: '0.00' },
      '20311.02': { status: 'aberto', pagoEm: null, saldo: '500.81' },
      '20311.03': { status: 'pago', pagoEm: '2026-11-23', saldo: '0.00' },
    });

    // Um registro = um lote com uma linha por título.
    assert.equal(await val(db, `SELECT count(DISTINCT lote)::int FROM cobranca_pagamentos WHERE caso_id = '${d.caso}'`), 1);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_pagamentos WHERE caso_id = '${d.caso}'`), 2);

    // O histórico diz quais títulos o pagamento abateu.
    const ev = await one(db, `SELECT dados FROM cobranca_eventos WHERE caso_id = '${d.caso}' AND tipo = 'pagamento_registrado'`);
    assert.equal(Number(ev.dados.valor), 656.31);
    assert.deepEqual(ev.dados.titulos.map((t) => t.numero).sort(), ['20311.01', '20311.03']);
    assert.equal(ev.dados.lote, r.lote);

    // O caso segue aberto com o título restante.
    const resumo = await one(db, `SELECT titulos_abertos, saldo_aberto::text AS saldo FROM cobranca_inadimplentes_resumo WHERE id = '${d.inad}'`);
    assert.deepEqual(resumo, { titulos_abertos: 1, saldo: '500.81' });
  } finally { await db.close(); }
});

test('valor menor que a soma abate FIFO só entre os escolhidos', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Padaria Lagoa', [
      { numero: 'A', valor: 100, vencimento: '2026-10-01' },
      { numero: 'B', valor: 200, vencimento: '2026-10-05' },
      { numero: 'C', valor: 300, vencimento: '2026-10-10' },
    ]);
    const r = await pagar(db, d.caso, 250, [d.titulo('C'), d.titulo('B')]);
    assert.equal(Number(r.saldo_restante), 350);
    assert.deepEqual(await situacao(db, d.inad), {
      A: { status: 'aberto', pagoEm: null, saldo: '100.00' }, // mais antigo, mas não escolhido
      B: { status: 'pago', pagoEm: '2026-11-23', saldo: '0.00' },
      C: { status: 'aberto', pagoEm: null, saldo: '250.00' },
    });
    assert.deepEqual(r.titulos.map((t) => [t.numero, Number(t.valor), t.quitado]), [['B', 200, true], ['C', 50, false]]);

    // Repetir o mesmo título no pedido não paga duas vezes.
    await pagar(db, d.caso, 250, [d.titulo('C'), d.titulo('C')]);
    assert.equal((await situacao(db, d.inad)).C.status, 'pago');
  } finally { await db.close(); }
});

test('qualquer título inválido recusa o lote inteiro e nada é gravado', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Mercado Canasvieiras', [
      { numero: 'X', valor: 100, vencimento: '2026-10-01' },
      { numero: 'Y', valor: 200, vencimento: '2026-10-05' },
    ]);
    const vizinho = await devedor(db, 'Outro devedor', [{ numero: 'Z', valor: 50, vencimento: '2026-10-01' }]);
    const recusa = (sql, re) => assert.rejects(db.query(sql), re);
    const lista = (...ids) => `ARRAY[${ids.map((t) => `'${t}'`).join(', ')}]::uuid[]`;
    const chamar = (valor, arr) => `SELECT cobranca_pagamento_registrar('${d.caso}', ${valor}, '2026-11-23', p_titulos => ${arr})`;

    // Título de outro devedor (mesma org) e id que não existe.
    await recusa(chamar(150, lista(d.titulo('X'), vizinho.titulo('Z'))), /não está mais em aberto/);
    await recusa(chamar(100, lista(d.titulo('X'), id(777))), /não está mais em aberto/);
    // Lista vazia ou com nulo.
    await recusa(chamar(100, `'{}'::uuid[]`), /Escolha ao menos um título/);
    await recusa(chamar(100, `ARRAY[NULL]::uuid[]`), /Escolha ao menos um título/);
    // Valor acima da soma dos escolhidos (o saldo total cobriria).
    await recusa(chamar(150, lista(d.titulo('X'))), /passa do saldo em aberto \(R\$ 100,00\)/);

    // Título já pago.
    await pagar(db, d.caso, 100, [d.titulo('X')]);
    await recusa(chamar(200, lista(d.titulo('X'), d.titulo('Y'))), /não está mais em aberto/);

    // Título do ERP baixa pelo ERP.
    await asPostgres(db);
    const erp = await val(db, `INSERT INTO cobranca_titulos (organization_id, inadimplente_id, origem, numero, valor, vencimento)
      VALUES ('${TORQUE}', '${d.inad}', 'erp', 'E1', 80, '2026-10-02') RETURNING id`);
    await as(db, U_ADMIN);
    await recusa(chamar(80, lista(erp)), /Título do ERP baixa pelo ERP/);

    // Nada das recusas foi gravado: só o pagamento do X.
    await asPostgres(db);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_pagamentos WHERE caso_id = '${d.caso}'`), 1);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_pagamentos WHERE caso_id = '${vizinho.caso}'`), 0);
    assert.equal((await situacao(db, d.inad)).Y.status, 'aberto');
    assert.equal((await situacao(db, vizinho.inad)).Z.status, 'aberto');
  } finally { await db.close(); }
});

test('chamadas do front publicado seguem: p_titulo e FIFO; o evento do FIFO também diz os títulos', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Farmácia Jurerê', [
      { numero: 'A', valor: 100, vencimento: '2026-10-01' },
      { numero: 'B', valor: 200, vencimento: '2026-10-05' },
      { numero: 'C', valor: 300, vencimento: '2026-10-10' },
    ]);
    const r1 = await val(db, `SELECT cobranca_pagamento_registrar(p_caso => '${d.caso}', p_valor => 300,
      p_pago_em => '2026-11-20', p_titulo => '${d.titulo('C')}')`);
    assert.deepEqual(r1.titulos.map((t) => t.numero), ['C']);

    const r2 = await val(db, `SELECT cobranca_pagamento_registrar('${d.caso}', 150, '2026-11-21')`);
    assert.deepEqual(r2.titulos.map((t) => [t.numero, Number(t.valor), t.quitado]), [['A', 100, true], ['B', 50, false]]);
    const ev = await rows(db, `SELECT dados FROM cobranca_eventos WHERE caso_id = '${d.caso}' AND tipo = 'pagamento_registrado' ORDER BY id`);
    assert.deepEqual(ev.map((e) => e.dados.titulos.map((t) => t.numero)), [['C'], ['A', 'B']]);
  } finally { await db.close(); }
});

test('escolher os títulos que zeram o saldo fecha o caso em Recuperado', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Distribuidora Exemplo', TRES_TITULOS);
    await pagar(db, d.caso, 656.31, [d.titulo('20311.01'), d.titulo('20311.03')]);
    const r = await pagar(db, d.caso, 500.81, [d.titulo('20311.02')], '2026-11-24');
    assert.equal(r.quitado, true);
    const c = await one(db, `SELECT desfecho, (SELECT papel FROM cobranca_etapas e WHERE e.id = etapa_id) AS papel FROM cobranca_casos WHERE id = '${d.caso}'`);
    assert.deepEqual(c, { desfecho: 'recuperado', papel: 'recuperado' });
  } finally { await db.close(); }
});

test('a porta de permissão vem antes: membro só com cobranca.view não registra', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Bar do Porto', [{ numero: 'A', valor: 100, vencimento: '2026-10-01' }]);
    await as(db, U_MEMBRO);
    await assert.rejects(
      db.query(`SELECT cobranca_pagamento_registrar('${d.caso}', 100, '2026-11-23', p_titulos => ARRAY['${d.titulo('A')}']::uuid[])`),
      /não tem permissão/,
    );
    await asPostgres(db);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_pagamentos`), 0);
  } finally { await db.close(); }
});

test('rollback pareado volta a assinatura de 4 argumentos e o FIFO segue', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Loja Centro', [
      { numero: 'A', valor: 100, vencimento: '2026-10-01' },
      { numero: 'B', valor: 200, vencimento: '2026-10-05' },
    ]);
    await pagar(db, d.caso, 100, [d.titulo('B')]);
    await asPostgres(db);
    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));

    const assinaturas = await rows(db, `SELECT pg_get_function_identity_arguments(p.oid) AS args FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'cobranca_pagamento_registrar'`);
    assert.deepEqual(assinaturas.map((r) => r.args), ['p_caso uuid, p_valor numeric, p_pago_em date, p_titulo uuid']);

    await as(db, U_ADMIN);
    const r = await val(db, `SELECT cobranca_pagamento_registrar('${d.caso}', 150, '2026-11-23')`);
    assert.equal(r.titulos, undefined);
    assert.deepEqual(await situacao(db, d.inad), {
      A: { status: 'pago', pagoEm: '2026-11-23', saldo: '0.00' },
      B: { status: 'aberto', pagoEm: null, saldo: '50.00' },
    });
  } finally { await db.close(); }
});
