// Cobrança · a mensagem da régua lista os títulos em aberto (20280127000000)
// num Postgres real (PGlite), com o renderizador REAL da edge no fim da linha.
//
// Cobre o contrato entre o banco e a edge: `lista_titulos` traz só os títulos
// com saldo, do vencimento mais antigo para o mais novo, com o SALDO de cada
// um (pagamento parcial abate), soma o {valor} e conta o {titulos}; corta em 20
// e a edge fecha com "E mais N títulos em aberto."; e o rollback pareado volta
// o corpo exato que está em prod.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { renderizarMensagem } from '../../supabase/functions/_shared/cobranca-regua-mensagem.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TORQUE = 'b2ad1ffb-e136-4356-846b-9f210f902573';
const U_ADMIN = id(1);
const TM_ADMIN = id(11);
const AGORA = '2026-11-25T12:00:00Z';
/** md5 do prosrc de private.cobranca_regua_variaveis em prod antes desta migration (25/11). */
const MD5_ANTERIOR = '9e5265b10e61d661bf2b7c4bf06fccdf';

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
  '20280126000000_cobranca_pagamento_por_titulo',
];
const NOVA = '20280127000000_cobranca_mensagem_por_titulo';

async function setup({ aplicarNova = true } = {}) {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${TORQUE}', 'TorqueCRM', 'torquecrm');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin');
  `);
  for (const m of MIGRATIONS) await db.exec(read(`../../supabase/migrations/${m}.sql`));
  if (aplicarNova) await db.exec(read(`../../supabase/migrations/${NOVA}.sql`));
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

/** Cadastra um devedor com títulos e devolve { caso, titulo(numero) → id }. */
async function devedor(db, nome, titulos) {
  await as(db, U_ADMIN);
  const inad = await val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL,
    '${JSON.stringify({ nome, telefone: '5548999990001', titulos }).replace(/'/g, "''")}'::jsonb)`);
  const caso = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`);
  const ids = Object.fromEntries(
    (await rows(db, `SELECT numero, id FROM cobranca_titulos WHERE inadimplente_id = '${inad}'`)).map((r) => [r.numero, r.id]),
  );
  return { caso, titulo: (numero) => ids[numero] };
}

async function variaveis(db, caso) {
  await asPostgres(db);
  return val(db, `SELECT private.cobranca_regua_variaveis('${caso}', 'atraso', '${AGORA.slice(0, 10)}', '${AGORA}'::timestamptz)`);
}

// O formato que o cliente pediu (25/11): "Dados dos Documentos" com cada título.
const MODELO = [
  'Prezado cliente {nome}, seguem dados de seus títulos.',
  '',
  'Dados dos Documentos:',
  '',
  'Vencimento: {titulo_vencimento}',
  '• Valor de: {titulo_valor}',
  '',
  'Agradecemos a parceria!',
].join('\n');

test('lista os títulos com saldo, do mais antigo, com o saldo de cada um — e a edge monta o texto', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Cambauto Mecânica', [
      { numero: 'NF 2', valor: 300, vencimento: '2026-10-11' },
      { numero: 'NF 1', valor: 69.97, vencimento: '2026-10-11' },
      { numero: 'NF 3', valor: 150, vencimento: '2026-11-01' },
      { numero: 'NF 9', valor: 80, vencimento: '2026-09-30' },
    ]);
    // Pagou o NF 9 inteiro e parte do NF 2: o pago some, o parcial mostra o saldo.
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_pagamento_registrar('${d.caso}', 80, '2026-11-20', p_titulos => ARRAY['${d.titulo('NF 9')}']::uuid[])`);
    await db.query(`SELECT cobranca_pagamento_registrar('${d.caso}', 66.85, '2026-11-20', p_titulos => ARRAY['${d.titulo('NF 2')}']::uuid[])`);

    const v = await variaveis(db, d.caso);
    assert.deepEqual(
      v.lista_titulos.map((t) => [t.numero, t.vencimento, Number(t.valor)]),
      [['NF 1', '2026-10-11', 69.97], ['NF 2', '2026-10-11', 233.15], ['NF 3', '2026-11-01', 150]],
    );
    // Mesmos títulos que somam o {valor} e contam o {titulos}.
    assert.equal(v.titulos, 3);
    assert.equal(Number(v.valor), 453.12);
    assert.equal(v.vencimento, '2026-10-11');

    assert.equal(
      renderizarMensagem(MODELO, v),
      [
        'Prezado cliente Cambauto Mecânica, seguem dados de seus títulos.',
        '',
        'Dados dos Documentos:',
        '',
        'Vencimento: 11/10/2026',
        '• Valor de: R$ 69,97',
        '',
        'Vencimento: 11/10/2026',
        '• Valor de: R$ 233,15',
        '',
        'Vencimento: 01/11/2026',
        '• Valor de: R$ 150,00',
        '',
        'Agradecemos a parceria!',
      ].join('\n'),
    );
  } finally { await db.close(); }
});

test('mais de 20 títulos: a lista corta em 20 e o texto diz quantos ficaram de fora', async () => {
  const db = await setup();
  try {
    const titulos = Array.from({ length: 25 }, (_, i) => ({
      numero: `T${String(i + 1).padStart(2, '0')}`,
      valor: 10 + i,
      vencimento: `2026-10-${String(i + 1).padStart(2, '0')}`,
    }));
    const d = await devedor(db, 'Atacado Grande', titulos);
    const v = await variaveis(db, d.caso);
    assert.equal(v.lista_titulos.length, 20);
    assert.equal(v.lista_titulos[0].numero, 'T01');
    assert.equal(v.lista_titulos[19].numero, 'T20');
    assert.equal(v.titulos, 25);

    const texto = renderizarMensagem('Em aberto:\n• {titulo_vencimento} · {titulo_valor}', v);
    const linhas = texto.split('\n');
    assert.equal(linhas.length, 22);
    assert.equal(linhas[1], '• 01/10/2026 · R$ 10,00');
    assert.equal(linhas[21], 'E mais 5 títulos em aberto.');
  } finally { await db.close(); }
});

test('sem título em aberto: lista vazia e o bloco some do texto', async () => {
  const db = await setup();
  try {
    const d = await devedor(db, 'Quitado Ltda', [{ numero: 'Q1', valor: 50, vencimento: '2026-10-01' }]);
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_pagamento_registrar('${d.caso}', 50, '2026-11-20')`);
    const v = await variaveis(db, d.caso);
    assert.deepEqual(v.lista_titulos, []);
    assert.equal(renderizarMensagem('Olá!\nVencimento: {titulo_vencimento}\nObrigado.', v), 'Olá!\nObrigado.');
  } finally { await db.close(); }
});

test('rollback pareado volta o corpo de prod; a migration reaplica', async () => {
  const db = await setup({ aplicarNova: false });
  try {
    const md5 = `SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.cobranca_regua_variaveis(uuid,text,date,timestamptz)'::regprocedure`;
    assert.equal(await val(db, md5), MD5_ANTERIOR);
    const acl = `SELECT proacl::text FROM pg_proc WHERE oid = 'private.cobranca_regua_variaveis(uuid,text,date,timestamptz)'::regprocedure`;
    const aclAntes = await val(db, acl);

    await db.exec(read(`../../supabase/migrations/${NOVA}.sql`));
    assert.notEqual(await val(db, md5), MD5_ANTERIOR);
    assert.equal(await val(db, acl), aclAntes, 'CREATE OR REPLACE mantém a ACL');
    const d = await devedor(db, 'Ida e Volta', [{ numero: 'R1', valor: 10, vencimento: '2026-10-01' }]);
    assert.equal((await variaveis(db, d.caso)).lista_titulos.length, 1);

    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));
    assert.equal(await val(db, md5), MD5_ANTERIOR);
    assert.equal((await variaveis(db, d.caso)).lista_titulos, undefined);

    await db.exec(read(`../../supabase/migrations/${NOVA}.sql`));
    assert.equal((await variaveis(db, d.caso)).lista_titulos.length, 1);
  } finally { await db.close(); }
});
