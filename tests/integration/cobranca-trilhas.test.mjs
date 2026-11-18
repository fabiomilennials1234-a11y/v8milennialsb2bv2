// Cobrança · trilhas por tipo de caso, colunas manuais e prazo de retorno
// (20280118000000) num Postgres real (PGlite).
//
// Cobre: a trilha 'multiplos' escolhida pelo número de títulos (e a queda para
// título único quando a trilha ainda não tem coluna naquele atraso), a coluna
// manual (criar, enviar só no "Mover e enviar", remover), as variáveis
// {prazo_data}/{prazo_horario} em dias úteis, o limite de 2.000 caracteres e o
// rollback pareado. GRANT/RLS do banco real ficam com o pgTAP.
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
const INST_COBRANCA = id(501);

// Quarta, 21/10/2026, 14h em São Paulo — dentro da janela padrão (seg–sex 8h–18h).
const AGORA = '2026-10-21T14:00:00-03:00';
const dia = (offset) => new Date(Date.UTC(2026, 9, 21 + offset)).toISOString().slice(0, 10);

const ANTES = [
  '20271212000000_cobranca_fundacao',
  '20271212000010_cobranca_endurecer_acl',
  '20271213000000_cobranca_regua',
  '20271214000000_cobranca_colunas_da_regua',
];
const NOVA = '20280118000000_cobranca_trilhas_colunas_manuais_e_prazo';

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES ('${TORQUE}', 'TorqueCRM', 'torquecrm');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member');
    INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status) VALUES
      ('${INST_COBRANCA}', '${TORQUE}', 'cobrança', 'uazapi', 'connected');
  `);
  for (const m of ANTES) await db.exec(read(`../../supabase/migrations/${m}.sql`));
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

async function devedor(db, { nome, telefone = '5548999990001', titulos }) {
  await as(db, U_ADMIN);
  const inad = await val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL,
    '${JSON.stringify({ nome, telefone, titulos }).replace(/'/g, "''")}'::jsonb)`);
  await asPostgres(db);
  const caso = await val(db, `SELECT id FROM cobranca_casos WHERE inadimplente_id = '${inad}' AND encerrado_em IS NULL`);
  return { inad, caso };
}
const planejar = (db, agora = AGORA) => one(db, `SELECT cobranca_regua_planejar('${agora}') AS r`).then((x) => x.r);
const colunaDo = (db, caso) => val(db, `SELECT e.nome FROM cobranca_casos c JOIN cobranca_etapas e ON e.id = c.etapa_id WHERE c.id = '${caso}'`);
const coluna = (db, nome) => val(db, `SELECT id FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND nome = '${nome}'`);
const nomes = (db) => rows(db, `SELECT nome FROM cobranca_etapas WHERE organization_id = '${TORQUE}' ORDER BY posicao`)
  .then((r) => r.map((x) => x.nome));

async function salvarColuna(db, dados, etapa = null, uid = U_ADMIN) {
  await as(db, uid);
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

test('colunas: trilha 2+ títulos fica depois das de título único; manual não tem dias; só vale com dias', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { nome: '2 títulos vencidos', entrada_dias: 2, trilha: 'multiplos', mensagem: 'Olá {nome}' });
    const q = await nomes(db);
    assert.ok(q.indexOf('30 dias de atraso') < q.indexOf('2 títulos vencidos'), 'multiplos depois de toda a trilha única');
    assert.ok(q.indexOf('2 títulos vencidos') < q.indexOf('Em negociação'));

    const trilha = await one(db, `SELECT trilha, entrada_dias FROM cobranca_etapas WHERE nome = '2 títulos vencidos'`);
    assert.deepEqual(trilha, { trilha: 'multiplos', entrada_dias: 2 });

    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"nome":"X","manual":true,"entrada_dias":5}'::jsonb)`)).message,
      'Coluna manual não tem dias de atraso.');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', '${await coluna(db, 'Em negociação')}', '{"trilha":"multiplos"}'::jsonb)`)).message,
      '2 ou mais títulos só vale em coluna com dias de atraso.');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":9,"trilha":"outra"}'::jsonb)`)).message,
      'Tipo de caso inválido.');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"manual":true}'::jsonb)`)).message,
      'Coluna manual precisa de um nome.');
    await asPostgres(db);
    // Membro sem permissão de edição não cria coluna.
    await as(db, U_MEMBRO);
    await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"nome":"Y","manual":true}'::jsonb)`);
    await asPostgres(db);
  } finally {
    await db.close();
  }
});

test('entrada automática: 2+ títulos entram na coluna da trilha; sem coluna da trilha naquele atraso, caem na de título único', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { nome: '2 títulos vencidos', entrada_dias: 2, trilha: 'multiplos', mensagem: 'Primeiro contato {nome}' });

    const unico = await devedor(db, { nome: 'Unico', telefone: '5548999990001', titulos: [{ valor: 100, vencimento: dia(-3) }] });
    const dois = await devedor(db, {
      nome: 'Dois', telefone: '5548999990002',
      titulos: [{ valor: 100, vencimento: dia(-3) }, { valor: 50, vencimento: dia(-1) }],
    });
    const cedo = await devedor(db, {
      nome: 'Cedo', telefone: '5548999990003',
      titulos: [{ valor: 100, vencimento: dia(-1) }, { valor: 50, vencimento: dia(-1) }],
    });
    await planejar(db);

    assert.equal(await colunaDo(db, unico.caso), '3 dias de atraso', 'um título: coluna de título único');
    assert.equal(await colunaDo(db, dois.caso), '2 títulos vencidos', 'dois títulos: coluna da trilha, mesmo com a de 3 dias elegível');
    assert.equal(await colunaDo(db, cedo.caso), '1 dia de atraso', 'multiplos ainda não tem coluna com 1 dia: cai na de título único');

    // A mensagem enfileirada é a da coluna da trilha.
    const msg = await val(db, `SELECT e.mensagem FROM cobranca_regua_envios en JOIN cobranca_etapas e ON e.id = en.etapa_id
      WHERE en.caso_id = '${dois.caso}'`);
    assert.equal(msg, 'Primeiro contato {nome}');

    // Depois de 3 dias (com 1 dia já dado), o caso de 2 títulos continua na trilha: nada volta nem repete.
    await planejar(db);
    assert.equal(await val(db, `SELECT count(*) FROM cobranca_regua_envios WHERE caso_id = '${dois.caso}'`), 1);
  } finally {
    await db.close();
  }
});

test('prazo de retorno: N dias úteis pela janela de envio, no horário em que ela fecha', async () => {
  const db = await setup();
  try {
    const { caso } = await devedor(db, { nome: 'Prazo', titulos: [{ valor: 100, vencimento: dia(-3) }] });
    const prazo = (agora) => one(db, `SELECT private.cobranca_regua_variaveis('${caso}', 'entrada_manual', '${agora.slice(0, 10)}', '${agora}'::timestamptz) AS v`)
      .then((x) => ({ data: x.v.prazo_data, horario: x.v.prazo_horario }));

    // Quarta + 2 dias úteis = sexta, 18:00.
    assert.deepEqual(await prazo(AGORA), { data: '2026-10-23', horario: '18:00' });
    // Sexta + 2 dias úteis pula o fim de semana: terça.
    assert.deepEqual(await prazo('2026-10-23T10:00:00-03:00'), { data: '2026-10-27', horario: '18:00' });

    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_regua_salvar('${TORQUE}',
      '{"prazo_dias_uteis":4,"janela":{"1":{"inicio":"08:00","fim":"17:30"},"2":{"inicio":"08:00","fim":"17:30"},"3":{"inicio":"08:00","fim":"17:30"},"4":{"inicio":"08:00","fim":"17:30"},"5":{"inicio":"08:00","fim":"12:00"}}}'::jsonb)`);
    await asPostgres(db);
    // Quarta + 4 úteis = terça; o horário é o fim da janela de terça.
    assert.deepEqual(await prazo(AGORA), { data: '2026-10-27', horario: '17:30' });

    await as(db, U_ADMIN);
    assert.match((await erro(db, `SELECT cobranca_regua_salvar('${TORQUE}', '{"prazo_dias_uteis":11}'::jsonb)`)).message,
      /prazo de retorno de 1 a 10 dias úteis/);
    await asPostgres(db);
  } finally {
    await db.close();
  }
});

test('coluna manual: só envia no "Mover e enviar", com o prazo preenchido; remove vazia, não a fixa', async () => {
  const db = await setup();
  try {
    const longa = `Notificação para {nome}. ${'Texto. '.repeat(250)}Retorne até {prazo_data}, às {prazo_horario}.`;
    assert.ok(longa.length > 1000 && longa.length <= 2000, `mensagem de teste com ${longa.length} caracteres`);
    const manual = await salvarColuna(db, { nome: 'Notificação formal', manual: true, mensagem: longa });
    const linha = await one(db, `SELECT pausa_regua, personalizada, entrada_dias, trilha FROM cobranca_etapas WHERE id = '${manual}'`);
    assert.deepEqual(linha, { pausa_regua: true, personalizada: true, entrada_dias: null, trilha: 'unico' });

    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '${JSON.stringify({ nome: 'Estourou', manual: true, mensagem: 'x'.repeat(2001) })}'::jsonb)`)).message,
      'A mensagem passa de 2.000 caracteres.');
    await asPostgres(db);

    // A régua nunca move para ela nem envia por conta própria.
    const { caso } = await devedor(db, { nome: 'Manual', titulos: [{ valor: 100, vencimento: dia(-40) }] });
    await planejar(db);
    assert.notEqual(await colunaDo(db, caso), 'Notificação formal');
    assert.equal(await val(db, `SELECT count(*) FROM cobranca_regua_envios WHERE caso_id = '${caso}' AND etapa_id = '${manual}'`), 0);

    const r = await mover(db, caso, 'Notificação formal', true);
    assert.equal(r.envio, 'na_fila');
    await db.exec(`UPDATE cobranca_regua_envios SET agendado_para = '${AGORA}' WHERE gatilho = 'entrada_manual' AND status = 'pendente'`);
    const [env] = await rows(db, `SELECT * FROM cobranca_regua_reservar(10, '${AGORA}')`);
    assert.match(env.mensagem, /^Notificação para \{nome\}/);
    assert.equal(env.variaveis.prazo_data, '2026-10-23');
    assert.equal(env.variaveis.prazo_horario, '18:00');

    // Remover: manual criada por você, vazia, sai; fixa (Em negociação) não.
    await as(db, U_ADMIN);
    await erro(db, `SELECT cobranca_coluna_remover('${manual}')`); // tem o caso
    assert.equal((await erro(db, `SELECT cobranca_coluna_remover('${await coluna(db, 'Em negociação')}')`)).detail, 'coluna_fixa');
    await asPostgres(db);
    await mover(db, caso, 'Em negociação');
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_coluna_remover('${manual}')`);
    await asPostgres(db);
    assert.equal(await val(db, `SELECT count(*) FROM cobranca_etapas WHERE id = '${manual}'`), 0);
  } finally {
    await db.close();
  }
});

test('rollback pareado: some trilha/manual/prazo e a régua volta a funcionar como antes', async () => {
  const db = await setup();
  try {
    await salvarColuna(db, { nome: '2 títulos vencidos', entrada_dias: 2, trilha: 'multiplos', mensagem: 'Oi' });
    const manual = await salvarColuna(db, { nome: 'Cartório', manual: true, mensagem: 'x'.repeat(1500) });
    const { caso } = await devedor(db, { nome: 'Rb', titulos: [{ valor: 100, vencimento: dia(-5) }] });
    await mover(db, caso, 'Cartório');

    await db.exec(read(`../../supabase/migrations/rollback/${NOVA}.sql`));

    assert.equal(await val(db, `SELECT count(*) FROM cobranca_etapas WHERE id = '${manual}' OR nome = '2 títulos vencidos'`), 0);
    assert.equal(await colunaDo(db, caso), 'Vencido', 'caso que estava na coluna removida volta para a entrada');
    assert.equal(await val(db, `SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'cobranca_etapas' AND column_name IN ('trilha', 'personalizada')`), 0);
    assert.equal(await val(db, `SELECT count(*) FROM information_schema.columns
      WHERE table_name = 'cobranca_regua' AND column_name = 'prazo_dias_uteis'`), 0);
    await planejar(db); // as funções antigas rodam
    assert.equal(await colunaDo(db, caso), '3 dias de atraso');
  } finally {
    await db.close();
  }
});
