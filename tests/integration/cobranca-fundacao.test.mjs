// Cobrança · entrega 1 — lógica das RPCs num Postgres real (PGlite).
//
// Aplica a migration de verdade sobre uma fixture mínima (helpers de
// identidade/permissão replicados de prod) e exercita o que a tela vai usar:
// flag, permissão, um caso por inadimplente, importação (dry-run e real),
// baixa FIFO até Recuperado, colunas de desfecho, compromissos e métricas.
// A fidelidade de GRANT/RLS do banco real é do pgTAP
// (supabase/tests/cobranca_fundacao_test.sql).
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
const U_MEMBRO_LIBERADO = id(3);
const U_MASTER = id(4);
const U_OUTRA = id(5);
const TM_ADMIN = id(11);
const TM_MEMBRO = id(12);
const TM_LIBERADO = id(13);
const TM_OUTRA = id(15);

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
      ('${TM_LIBERADO}', '${TORQUE}', '${U_MEMBRO_LIBERADO}', 'Cobradora', 'member'),
      ('${TM_OUTRA}', '${OUTRA}', '${U_OUTRA}', 'Admin Outra', 'admin');
    INSERT INTO master_users (user_id) VALUES ('${U_MASTER}');
  `);
  await db.exec(read('../../supabase/migrations/20271212000000_cobranca_fundacao.sql'));
  await db.exec(`
    INSERT INTO member_feature_permissions (team_member_id, feature_key, enabled) VALUES
      ('${TM_LIBERADO}', 'cobranca.view', true),
      ('${TM_LIBERADO}', 'cobranca.edit', true);
  `);
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

async function novoInadimplente(db, dados) {
  return val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL, '${JSON.stringify(dados).replace(/'/g, "''")}'::jsonb)`);
}

test('flag liga só a TorqueCRM e semeia as 9 etapas', async () => {
  const db = await setup();
  try {
    assert.equal(await val(db, `SELECT feature_flags -> 'cobranca' = 'true'::jsonb FROM organizations WHERE id = '${TORQUE}'`), true);
    assert.equal(await val(db, `SELECT feature_flags ? 'cobranca' FROM organizations WHERE id = '${OUTRA}'`), false);
    const etapas = (await db.query(`SELECT nome, papel FROM cobranca_etapas WHERE organization_id = '${TORQUE}' ORDER BY posicao`)).rows;
    assert.deepEqual(etapas.map((e) => e.nome), ['Vencido', 'Em cobrança', 'Em negociação', 'Promessa ou acordo',
      'Cobrança intensiva', 'Jurídico', 'Recuperado', 'Perdido', 'Cancelado']);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_etapas WHERE organization_id = '${OUTRA}'`), 0);
    assert.deepEqual((await db.query(`SELECT key, default_value FROM feature_permissions ORDER BY key`)).rows,
      [{ key: 'cobranca.edit', default_value: false }, { key: 'cobranca.view', default_value: false }]);
  } finally { await db.close(); }
});

test('acesso: flag, permissão própria, master e org vizinha', async () => {
  const db = await setup();
  try {
    await as(db, U_MEMBRO);
    await assert.rejects(novoInadimplente(db, { nome: 'X' }), /permissão para operar a cobrança/);
    await as(db, U_OUTRA);
    await assert.rejects(db.query(`SELECT cobranca_inadimplente_salvar('${OUTRA}', NULL, '{"nome":"Y"}')`),
      /não está liberada/);
    await assert.rejects(novoInadimplente(db, { nome: 'Z' }), /Acesso negado|permissão/);

    await as(db, U_MEMBRO_LIBERADO);
    const liberado = await novoInadimplente(db, { nome: 'Cliente da cobradora', telefone: '(48) 99999-0001' });
    assert.ok(liberado);
    await as(db, U_MASTER);
    assert.ok(await novoInadimplente(db, { nome: 'Cliente do master', documento: '11.222.333/0001-81' }));

    // Leitura pela RLS: membro sem cobranca.view não vê nada; org vizinha também não.
    await as(db, U_MEMBRO);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes`), 0);
    await as(db, U_OUTRA);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes_resumo`), 0);
    await as(db, U_ADMIN);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes_resumo`), 2);
    await as(db, U_MASTER);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes`), 2);

    // Escrita direta é fechada: só RPC.
    await as(db, U_ADMIN);
    await assert.rejects(db.query(`INSERT INTO cobranca_inadimplentes (organization_id, nome, origem) VALUES ('${TORQUE}', 'direto', 'manual')`),
      /permission denied/);
    await assert.rejects(db.query(`DELETE FROM cobranca_eventos`), /permission denied/);
    await asPostgres(db);
    assert.equal(await val(db, `SELECT has_function_privilege('anon', 'cobranca_importar(uuid, jsonb, boolean)', 'EXECUTE')`), false);
    assert.equal(await val(db, `SELECT has_table_privilege('anon', 'cobranca_casos', 'SELECT')`), false);
  } finally { await db.close(); }
});

test('cadastro manual: um caso por inadimplente, responsável e validações', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    const inad = await novoInadimplente(db, {
      nome: 'Restaurante Maré Alta', documento: '12.418.330/0001-07', telefone: '+55 48 99999-0002',
      responsavel_id: TM_LIBERADO,
      titulos: [{ numero: 'NF 4821', valor: 8210, vencimento: '2026-09-04' },
                { numero: 'NF 4907', valor: 6020.5, vencimento: '2026-09-18' }],
    });
    const r = await one(db, `SELECT * FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`);
    assert.equal(r.documento, '12418330000107');
    assert.equal(r.telefone, '5548999990002');
    assert.equal(Number(r.saldo_aberto), 14230.5);
    assert.equal(r.titulos_abertos, 2);
    assert.equal(r.etapa_nome, 'Vencido');
    assert.equal(r.responsavel_id, TM_LIBERADO);

    await assert.rejects(novoInadimplente(db, { nome: 'Duplicado', documento: '12418330000107' }), /Já existe um inadimplente/);
    await assert.rejects(novoInadimplente(db, { nome: 'Doc ruim', documento: '123' }), /CPF ou CNPJ inválido/);
    await assert.rejects(novoInadimplente(db, { nome: ' ' }), /Informe o nome/);
    await assert.rejects(novoInadimplente(db, { nome: 'Resp de fora', responsavel_id: TM_OUTRA }), /Responsável não pertence/);

    await db.query(`SELECT cobranca_titulo_incluir('${inad}', '{"numero":"NF 5012","valor":4200,"vencimento":"2026-10-02"}')`);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_casos WHERE inadimplente_id = '${inad}'`), 1);
    await assert.rejects(db.query(`SELECT cobranca_titulo_incluir('${inad}', '{"numero":"NF 5012","valor":1,"vencimento":"2026-10-02"}')`),
      /já tem um título com esse número/);

    // Sem título, sem caso.
    const semDivida = await novoInadimplente(db, { nome: 'Sem dívida ainda', telefone: '48999990003' });
    assert.equal(await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${semDivida}'`), null);
  } finally { await db.close(); }
});

test('importação: dry-run não grava, reimportação é idempotente, linhas ruins são apontadas', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    const linhas = [
      { nome: 'Padaria Estrela do Mar', documento: '08.771.245/0001-63', telefone: '48 99999-1000', numero: 'A1', valor: '3456.20', vencimento: '2026-09-13' },
      { nome: 'Padaria Estrela do Mar', documento: '08771245000163', numero: 'A2', valor: 3456.2, vencimento: '2026-10-13' },
      { nome: 'Padaria Estrela do Mar', documento: '08771245000163', numero: 'A2', valor: 3456.2, vencimento: '2026-10-13' },
      { nome: 'Mercado Bom Jesus', telefone: '48 99999-2000', valor: 11640, vencimento: '2026-10-18' },
      { nome: '', documento: '11111111111', valor: 10, vencimento: '2026-10-01' },
      { nome: 'Sem contato', valor: 10, vencimento: '2026-10-01' },
      { nome: 'Valor ruim', telefone: '48999993000', valor: 'abc', vencimento: '2026-10-01' },
    ];
    const json = JSON.stringify(linhas).replace(/'/g, "''");
    const seco = await val(db, `SELECT cobranca_importar('${TORQUE}', '${json}'::jsonb, true)`);
    assert.equal(seco.inadimplentes_novos, 2);
    assert.equal(seco.titulos_novos, 3);
    assert.equal(seco.linhas_invalidas.length, 3);
    assert.deepEqual(seco.linhas_invalidas.map((l) => l.linha), [5, 6, 7]);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes`), 0);

    const real = await val(db, `SELECT cobranca_importar('${TORQUE}', '${json}'::jsonb, false)`);
    assert.equal(real.inadimplentes_novos, 2);
    assert.equal(real.titulos_novos, 3);
    assert.equal(real.casos_abertos, 2);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_titulos`), 3);

    const de_novo = await val(db, `SELECT cobranca_importar('${TORQUE}', '${json}'::jsonb, false)`);
    assert.equal(de_novo.inadimplentes_novos, 0);
    assert.equal(de_novo.inadimplentes_existentes, 2);
    assert.equal(de_novo.titulos_novos, 0);
    assert.equal(de_novo.titulos_atualizados, 0);
    assert.equal(de_novo.casos_abertos, 0);

    const corrigida = JSON.stringify([{ ...linhas[0], valor: 3000 }]).replace(/'/g, "''");
    const r = await val(db, `SELECT cobranca_importar('${TORQUE}', '${corrigida}'::jsonb, false)`);
    assert.equal(r.titulos_atualizados, 1);
    assert.equal(await val(db, `SELECT valor::text FROM cobranca_titulos WHERE numero = 'A1'`), '3000.00');
    assert.equal(await val(db, `SELECT origem FROM cobranca_inadimplentes WHERE documento = '08771245000163'`), 'planilha');

    await assert.rejects(db.query(`SELECT cobranca_importar('${TORQUE}', '${JSON.stringify(Array(2001).fill(linhas[0]))}'::jsonb, true)`),
      /no máximo 2.000/);
  } finally { await db.close(); }
});

test('pagamento: FIFO, parcial, quitação fecha em Recuperado e cumpre o acordo', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    const inad = await novoInadimplente(db, {
      nome: 'Sorveteria Ilha Doce', documento: '19732660000105',
      titulos: [{ numero: 'B', valor: 300, vencimento: '2026-10-10' }, { numero: 'A', valor: 500, vencimento: '2026-09-30' }],
    });
    const caso = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`);
    const promessa = (await db.query(`SELECT id FROM cobranca_etapas WHERE nome = 'Promessa ou acordo'`)).rows[0].id;

    await assert.rejects(db.query(`SELECT cobranca_compromisso_registrar('${caso}', 'promessa', '[{"vencimento":"2026-10-25","valor":100},{"vencimento":"2026-11-25","valor":100}]')`),
      /Promessa tem uma data só/);
    const acordo = await val(db, `SELECT cobranca_compromisso_registrar('${caso}', 'acordo',
      '[{"vencimento":"2026-10-25","valor":400},{"vencimento":"2026-11-25","valor":400}]', 'combinado por telefone', '${promessa}')`);
    assert.equal(await val(db, `SELECT etapa_nome FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`), 'Promessa ou acordo');
    assert.equal(await val(db, `SELECT compromisso_parcelas FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`), 2);

    await assert.rejects(db.query(`SELECT cobranca_pagamento_registrar('${caso}', 900, '2026-10-20')`), /passa do saldo/);
    await assert.rejects(db.query(`SELECT cobranca_caso_mover('${caso}', (SELECT id FROM cobranca_etapas WHERE papel = 'recuperado'))`),
      /Ainda há saldo em aberto/);

    const p1 = await val(db, `SELECT cobranca_pagamento_registrar('${caso}', 600, '2026-10-20')`);
    assert.equal(Number(p1.saldo_restante), 200);
    assert.equal(p1.quitado, false);
    // FIFO: o título A (vence antes) quita; o B fica com 200.
    assert.equal(await val(db, `SELECT status FROM cobranca_titulos WHERE numero = 'A'`), 'pago');
    assert.equal(await val(db, `SELECT saldo::text FROM cobranca_titulos_saldo WHERE numero = 'B'`), '200.00');

    const p2 = await val(db, `SELECT cobranca_pagamento_registrar('${caso}', 200, '2026-10-21')`);
    assert.equal(p2.quitado, true);
    const c = await one(db, `SELECT desfecho, encerrado_em IS NOT NULL AS fechado, (SELECT nome FROM cobranca_etapas e WHERE e.id = etapa_id) AS etapa FROM cobranca_casos WHERE id = '${caso}'`);
    assert.deepEqual(c, { desfecho: 'recuperado', fechado: true, etapa: 'Recuperado' });
    assert.equal(await val(db, `SELECT status FROM cobranca_compromissos WHERE id = '${acordo}'`), 'cumprido');
    assert.equal(await val(db, `SELECT ultimo_desfecho FROM cobranca_inadimplentes_resumo WHERE id = '${inad}'`), 'recuperado');

    const tipos = (await db.query(`SELECT tipo FROM cobranca_eventos WHERE inadimplente_id = '${inad}' ORDER BY id`)).rows.map((r) => r.tipo);
    assert.deepEqual(tipos, ['inadimplente_criado', 'titulo_incluido', 'caso_aberto', 'titulo_incluido',
      'acordo_registrado', 'etapa_alterada', 'pagamento_registrado', 'pagamento_registrado', 'caso_encerrado']);
  } finally { await db.close(); }
});

test('colunas de desfecho: Perdido baixa e não reabre na reimportação; Cancelado cancela', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    const linha = JSON.stringify([{ nome: 'Pizzaria Forno Velho', documento: '27455019000186', numero: 'P1', valor: 27950, vencimento: '2026-06-25' }]);
    await db.query(`SELECT cobranca_importar('${TORQUE}', '${linha}'::jsonb, false)`);
    const caso = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE documento = '27455019000186'`);
    await db.query(`SELECT cobranca_caso_mover('${caso}', (SELECT id FROM cobranca_etapas WHERE papel = 'perdido'))`);
    assert.equal(await val(db, `SELECT status FROM cobranca_titulos WHERE numero = 'P1'`), 'baixado');
    const r = await val(db, `SELECT cobranca_importar('${TORQUE}', '${linha}'::jsonb, false)`);
    assert.equal(r.casos_abertos, 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_casos WHERE encerrado_em IS NULL`), 0);
    await assert.rejects(db.query(`SELECT cobranca_caso_mover('${caso}', (SELECT id FROM cobranca_etapas WHERE nome = 'Vencido'))`),
      /Caso encerrado não volta/);

    const outro = await novoInadimplente(db, { nome: 'Contestou', telefone: '48999994000',
      titulos: [{ valor: 100, vencimento: '2026-10-01' }] });
    const caso2 = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${outro}'`);
    await db.query(`SELECT cobranca_caso_mover('${caso2}', (SELECT id FROM cobranca_etapas WHERE papel = 'cancelado'))`);
    assert.equal(await val(db, `SELECT status FROM cobranca_titulos WHERE inadimplente_id = '${outro}'`), 'cancelado');
    assert.equal(await val(db, `SELECT desfecho FROM cobranca_casos WHERE id = '${caso2}'`), 'cancelado');
  } finally { await db.close(); }
});

test('mover, atribuir em lote, contato e métricas isoladas', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    const a = await novoInadimplente(db, { nome: 'A', telefone: '48999995000', titulos: [{ valor: 1000, vencimento: '2026-08-01' }] });
    const b = await novoInadimplente(db, { nome: 'B', telefone: '48999996000', titulos: [{ valor: 500, vencimento: '2026-10-15' }] });
    const ca = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${a}'`);
    const cb = await val(db, `SELECT caso_id FROM cobranca_inadimplentes_resumo WHERE id = '${b}'`);

    const intensiva = (await db.query(`SELECT id FROM cobranca_etapas WHERE nome = 'Cobrança intensiva'`)).rows[0].id;
    await db.query(`SELECT cobranca_caso_mover('${ca}', '${intensiva}', 0.5)`);
    assert.equal(await val(db, `SELECT etapa_nome FROM cobranca_inadimplentes_resumo WHERE id = '${a}'`), 'Cobrança intensiva');

    assert.equal(await val(db, `SELECT cobranca_casos_atribuir('${TORQUE}', ARRAY['${ca}', '${cb}']::uuid[], '${TM_LIBERADO}')`), 2);
    assert.equal(await val(db, `SELECT cobranca_casos_atribuir('${TORQUE}', ARRAY['${ca}', '${cb}']::uuid[], '${TM_LIBERADO}')`), 0);

    await db.query(`SELECT cobranca_contato_registrar('${ca}', 'telefone', 'nao_atendeu', '2ª tentativa')`);
    await assert.rejects(db.query(`SELECT cobranca_contato_registrar('${ca}', 'pombo', 'falou')`), /Canal inválido/);
    assert.equal(await val(db, `SELECT ultimo_contato_canal FROM cobranca_inadimplentes_resumo WHERE id = '${a}'`), 'telefone');

    await db.query(`SELECT cobranca_pagamento_registrar('${cb}', 200, '2026-10-20')`);
    const m = await val(db, `SELECT cobranca_metricas('${TORQUE}', '2026-10-21')`);
    assert.equal(Number(m.em_aberto), 1300);
    assert.equal(m.casos_abertos, 2);
    assert.equal(Number(m.faixas.acima_90), 0);
    assert.equal(Number(m.faixas.ate_90), 1000);
    assert.equal(Number(m.faixas.ate_30), 300);
    assert.equal(Number(m.recuperado_mes), 200);
    assert.equal(m.sem_contato_7d, 1);

    await db.query(`SELECT cobranca_nao_contatar('${a}', true, 'pediu por telefone')`);
    assert.equal(await val(db, `SELECT nao_contatar FROM cobranca_inadimplentes_resumo WHERE id = '${a}'`), true);
    await db.query(`SELECT cobranca_inadimplente_arquivar('${b}', 'lançado em duplicidade')`);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_inadimplentes_resumo`), 1);
    // Arquivar é "lançado por engano": fecha em Cancelado mesmo com pagamento parcial.
    assert.equal(await val(db, `SELECT desfecho FROM cobranca_casos WHERE id = '${cb}'`), 'cancelado');
  } finally { await db.close(); }
});

test('rollback pareado remove tudo e desliga a flag', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    await novoInadimplente(db, { nome: 'Some', telefone: '48999997000', titulos: [{ valor: 10, vencimento: '2026-10-01' }] });
    await asPostgres(db);
    // O padrão casa de verdade antes do rollback (senão o "0" abaixo provaria nada).
    assert.ok(await val(db, `SELECT count(*)::int FROM pg_class WHERE relname LIKE 'cobranca\\_%'`) >= 10);
    await db.exec(read('../../supabase/migrations/rollback/20271212000000_cobranca_fundacao.sql'));
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_class WHERE relname LIKE 'cobranca\\_%'`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'cobranca\\_%'`), 0);
    assert.equal(await val(db, `SELECT feature_flags ? 'cobranca' FROM organizations WHERE id = '${TORQUE}'`), false);
    assert.equal(await val(db, `SELECT count(*)::int FROM feature_permissions`), 0);
    // E a migration volta limpa por cima do rollback.
    await db.exec(read('../../supabase/migrations/20271212000000_cobranca_fundacao.sql'));
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_etapas`), 9);
  } finally { await db.close(); }
});
