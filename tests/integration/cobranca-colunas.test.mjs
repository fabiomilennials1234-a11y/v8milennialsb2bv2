// Cobrança · a régua vira as colunas do Fluxo (20271214000000) num Postgres
// real (PGlite).
//
// Cobre: a migração do quadro antigo (passos → colunas, casos e envios juntos),
// a semente nova, a entrada automática por dias (uma vez, só para a frente),
// o "Mover e enviar" à mão, a revalidação no worker, a quebra de compromisso,
// as RPCs da tela e o rollback pareado. GRANT/RLS do banco real ficam com o pgTAP.
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
const TM_ADMIN = id(11);
const TM_MEMBRO = id(12);
const INST_COBRANCA = id(501);

// Quarta, 21/10/2026, 14h em São Paulo — dentro da janela padrão.
const AGORA = '2026-10-21T14:00:00-03:00';
const dia = (offset) => new Date(Date.UTC(2026, 9, 21 + offset)).toISOString().slice(0, 10);

const ANTES = ['20271212000000_cobranca_fundacao', '20271212000010_cobranca_endurecer_acl', '20271213000000_cobranca_regua'];
const COLUNAS = '20271214000000_cobranca_colunas_da_regua';

async function base() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${TORQUE}', 'TorqueCRM', 'torquecrm'),
      ('${OUTRA}', 'Outra', 'outra');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member');
    INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status) VALUES
      ('${INST_COBRANCA}', '${TORQUE}', 'cobrança', 'uazapi', 'connected');
  `);
  for (const m of ANTES) await db.exec(read(`../../supabase/migrations/${m}.sql`));
  return db;
}

async function ligarRegua(db, { ativa = true } = {}) {
  await as(db, U_ADMIN);
  await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COBRANCA}')`);
  if (ativa) await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', true)`);
  await asPostgres(db);
}

/** Banco já no layout novo, com a régua ligada. */
async function setup({ ativa = true } = {}) {
  const db = await base();
  await db.exec(read(`../../supabase/migrations/${COLUNAS}.sql`));
  await ligarRegua(db, { ativa });
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
const reservar = (db, agora = AGORA) => rows(db, `SELECT * FROM cobranca_regua_reservar(10, '${agora}')`);
const envios = (db, caso) => rows(db, `SELECT en.gatilho, en.dias, en.status, en.motivo, e.nome AS coluna
  FROM cobranca_regua_envios en LEFT JOIN cobranca_etapas e ON e.id = en.etapa_id
  WHERE en.caso_id = '${caso}' ORDER BY en.created_at, en.dias`);
const colunaDo = (db, caso) => val(db, `SELECT e.nome FROM cobranca_casos c JOIN cobranca_etapas e ON e.id = c.etapa_id WHERE c.id = '${caso}'`);
const coluna = (db, nome) => val(db, `SELECT id FROM cobranca_etapas WHERE organization_id = '${TORQUE}' AND nome = '${nome}'`);
const quadro = (db, org = TORQUE) => rows(db, `SELECT nome, posicao, papel, pausa_regua, entrada_dias, mensagem IS NOT NULL AS msg
  FROM cobranca_etapas WHERE organization_id = '${org}' ORDER BY posicao`);
/** Move como a tela (usuário admin) e devolve o jsonb da RPC. */
async function mover(db, caso, nome, enviar = false) {
  await as(db, U_ADMIN);
  const r = await val(db, `SELECT cobranca_caso_mover('${caso}', '${await coluna(db, nome)}', NULL, ${enviar})`);
  await asPostgres(db);
  return r;
}
const livre = (db) => db.exec(`UPDATE cobranca_regua SET proximo_envio_apos = NULL`);
// O movimento à mão agenda para o relógio real (now()); o resto do teste roda
// no relógio fixo. Traz a fila manual para AGORA antes de chamar o worker.
const noRelogio = (db) => db.exec(`UPDATE cobranca_regua_envios SET agendado_para = '${AGORA}'
  WHERE gatilho = 'entrada_manual' AND status = 'pendente'`);

const LAYOUT = [
  'Vencido', '1 dia de atraso', '3 dias de atraso', '7 dias de atraso', '15 dias de atraso', '30 dias de atraso',
  'Em negociação', 'Promessa ou acordo', 'Jurídico', 'Recuperado', 'Perdido', 'Cancelado',
];

test('migração: o quadro antigo vira colunas de dias e os casos e envios vão junto', async () => {
  const db = await base();
  try {
    await ligarRegua(db);
    // Como em prod: um caso que já recebeu o D+7 (em "Em cobrança") e outro com o D+1 na fila.
    const sete = await devedor(db, { nome: 'Sete Dias', telefone: '5548999990001', vencimento: dia(-14) });
    const um = await devedor(db, { nome: 'Um Dia', telefone: '5548999990002', vencimento: dia(-1) });
    await planejar(db);
    const [r] = await reservar(db);
    await db.exec(`SELECT cobranca_regua_concluir('${r.envio_id}', 'enviado', 'oi', 'M1', NULL, '${AGORA}')`);
    assert.equal(await colunaDo(db, sete.caso), 'Em cobrança');
    assert.equal(await colunaDo(db, um.caso), 'Vencido');

    await db.exec(read(`../../supabase/migrations/${COLUNAS}.sql`));

    const q = await quadro(db);
    assert.deepEqual(q.map((c) => c.nome), LAYOUT);
    assert.deepEqual(q.map((c) => c.posicao), q.map((_, i) => i + 1), 'posições contíguas');
    assert.deepEqual(q.map((c) => c.entrada_dias), [null, 1, 3, 7, 15, 30, null, null, 60, null, null, null]);
    assert.deepEqual(q.map((c) => c.msg), [false, true, true, true, true, true, false, false, false, false, false, false]);
    assert.equal(q.find((c) => c.nome === 'Jurídico').pausa_regua, true);

    assert.equal(await colunaDo(db, sete.caso), '7 dias de atraso', '"Em cobrança" virou a coluna de 7 dias');
    assert.deepEqual((await envios(db, sete.caso)).map((e) => `${e.dias}:${e.status}:${e.coluna}`), ['7:enviado:7 dias de atraso']);
    assert.equal(await colunaDo(db, um.caso), '1 dia de atraso', 'envio na fila puxa o card para a coluna dele');
    assert.deepEqual((await envios(db, um.caso)).map((e) => `${e.dias}:${e.status}:${e.coluna}`), ['1:pendente:1 dia de atraso']);

    assert.deepEqual((await rows(db, `SELECT gatilho, dias FROM cobranca_regua_passos WHERE organization_id = '${TORQUE}'`))
      .map((p) => `${p.gatilho}:${p.dias}`), ['lembrete_compromisso:1'], 'atraso mora nas colunas; lembrete fica');
    assert.equal(await val(db, `SELECT etapa_apos_quebra_id FROM cobranca_regua WHERE organization_id = '${TORQUE}'`), null);

    // A régua nova não repete o que já saiu e a fila segue válida.
    assert.equal((await planejar(db)).envios_criados, 0);
    await livre(db);
    const [r2] = await reservar(db);
    assert.match(r2.mensagem, /Se já pagou/);

    // Mesmo quadro que uma org nova ganha.
    await db.exec(`SELECT private.cobranca_semear_etapas('${OUTRA}')`);
    const novo = await quadro(db, OUTRA);
    assert.deepEqual(novo.map((c) => [c.nome, c.entrada_dias, c.msg, c.pausa_regua]), q.map((c) => [c.nome, c.entrada_dias, c.msg, c.pausa_regua]));
  } finally { await db.close(); }
});

test('migração: org com o quadro antigo que nunca abriu a régua ganha as colunas padrão', async () => {
  const db = await base();
  try {
    await db.exec(`SELECT private.cobranca_semear_etapas('${OUTRA}')`);
    await db.exec(read(`../../supabase/migrations/${COLUNAS}.sql`));
    assert.deepEqual((await quadro(db, OUTRA)).map((c) => c.nome), LAYOUT);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_regua_passos WHERE organization_id = '${OUTRA}'`), 0);
  } finally { await db.close(); }
});

test('entrada automática: maior coluna vencida, só para a frente, uma vez por dívida', async () => {
  const db = await setup();
  try {
    const velho = await devedor(db, { nome: 'Antigo', telefone: '5548999990011', vencimento: dia(-40) });
    const novo = await devedor(db, { nome: 'Recente', telefone: '5548999990012', vencimento: dia(-2) });
    const semTel = await devedor(db, { nome: 'Sem Telefone', telefone: null, vencimento: dia(-8) });
    const juri = await devedor(db, { nome: 'Sessenta', telefone: '5548999990014', vencimento: dia(-65) });
    const emDia = await devedor(db, { nome: 'Em Dia', telefone: '5548999990015', vencimento: dia(1) });

    assert.equal((await planejar(db)).etapas_movidas, 4);
    assert.equal(await colunaDo(db, velho.caso), '30 dias de atraso');
    assert.deepEqual((await envios(db, velho.caso)).map((e) => `${e.gatilho}:${e.dias}:${e.status}`), ['atraso:30:pendente']);
    assert.equal(await colunaDo(db, novo.caso), '1 dia de atraso');
    assert.equal(await colunaDo(db, semTel.caso), '7 dias de atraso', 'sem telefone entra mesmo assim');
    assert.deepEqual((await envios(db, semTel.caso)).map((e) => `${e.status}:${e.motivo}`), ['pulado:sem_telefone']);
    assert.equal(await colunaDo(db, juri.caso), 'Jurídico');
    assert.deepEqual((await envios(db, juri.caso)).map((e) => `${e.status}:${e.motivo}`), ['pulado:so_etapa']);
    assert.equal(await colunaDo(db, emDia.caso), 'Vencido');
    assert.equal((await planejar(db)).envios_criados, 0, 'replanejar não duplica');

    // A equipe volta o card: a régua não empurra de novo para a mesma coluna...
    await mover(db, semTel.caso, '3 dias de atraso');
    await planejar(db);
    assert.equal(await colunaDo(db, semTel.caso), '3 dias de atraso');
    // ...só para a próxima, quando chegar a hora.
    await planejar(db, '2026-10-28T14:00:00-03:00');
    assert.equal(await colunaDo(db, semTel.caso), '15 dias de atraso');

    // Coluna com a entrada desligada é pulada; a régua usa a anterior ligada.
    await db.exec(`UPDATE cobranca_etapas SET automacao_ativa = false WHERE nome = '1 dia de atraso'`);
    const outro = await devedor(db, { nome: 'Dois Dias', telefone: '5548999990016', vencimento: dia(-2) });
    await planejar(db);
    assert.equal(await colunaDo(db, outro.caso), 'Vencido');
  } finally { await db.close(); }
});

test('mover à mão: "Mover e enviar" entra na fila da régua, uma por coluna por dia', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Ana Souza', telefone: '5548999990021', vencimento: dia(-3), valor: 250.5 });

    assert.deepEqual(await mover(db, a.caso, '7 dias de atraso', true), { caso_id: a.caso, envio: 'na_fila' });
    assert.equal(await colunaDo(db, a.caso), '7 dias de atraso');
    const e = await one(db, `SELECT gatilho, dias, status, criado_por,
      referencia = (now() AT TIME ZONE 'America/Sao_Paulo')::date AS hoje FROM cobranca_regua_envios WHERE caso_id = '${a.caso}'`);
    assert.deepEqual(e, { gatilho: 'entrada_manual', dias: 7, status: 'pendente', criado_por: U_ADMIN, hoje: true });

    assert.deepEqual(await mover(db, a.caso, '7 dias de atraso', true), { caso_id: a.caso, envio: 'ja_enviado_hoje' });

    // Prévia do diálogo: o texto da coluna, as variáveis do caso e o que impede o envio.
    await as(db, U_ADMIN);
    const pv = await val(db, `SELECT cobranca_caso_previa_envio('${a.caso}', '${await coluna(db, '15 dias de atraso')}', '${AGORA}')`);
    assert.match(pv.mensagem, /ainda não identificamos/);
    assert.equal(pv.variaveis.primeiro_nome, 'Ana');
    assert.equal(Number(pv.variaveis.valor), 250.5);
    assert.equal(pv.bloqueio, null);
    assert.equal(pv.na_janela, true);
    assert.equal(pv.teto_atingido, false);
    assert.equal((await val(db, `SELECT cobranca_caso_previa_envio('${a.caso}', '${await coluna(db, '7 dias de atraso')}')`)).bloqueio,
      'ja_enviado_hoje');
    assert.deepEqual(await val(db, `SELECT cobranca_caso_previa_envio('${a.caso}', '${await coluna(db, 'Em negociação')}')`), { mensagem: null });
    const vencido = await coluna(db, 'Vencido');
    await as(db, U_MEMBRO);
    assert.equal((await erro(db, `SELECT cobranca_caso_previa_envio('${a.caso}', '${vencido}')`)).detail, 'sem_permissao_cobranca');
    await asPostgres(db);
    assert.deepEqual(await mover(db, a.caso, 'Em negociação', true), { caso_id: a.caso, envio: null }, 'coluna sem mensagem não envia');
    assert.deepEqual(await mover(db, a.caso, '15 dias de atraso'), { caso_id: a.caso, envio: null }, '"Só mover"');

    // Duas colunas sem dias com mensagem, no mesmo dia: as duas saem.
    await db.exec(`UPDATE cobranca_etapas SET mensagem = 'Negociando, {primeiro_nome}' WHERE nome = 'Em negociação';
                   UPDATE cobranca_etapas SET mensagem = 'Combinado, {primeiro_nome}' WHERE nome = 'Promessa ou acordo'`);
    assert.equal((await mover(db, a.caso, 'Em negociação', true)).envio, 'na_fila');
    assert.equal((await mover(db, a.caso, 'Promessa ou acordo', true)).envio, 'na_fila');

    // Worker: movimento à mão sai primeiro, com o texto da coluna; os que
    // ficaram para trás (o card saiu da coluna) são cancelados.
    await noRelogio(db);
    const [r] = await reservar(db);
    assert.equal(r.mensagem, 'Combinado, {primeiro_nome}');
    assert.equal(r.variaveis.primeiro_nome, 'Ana');
    assert.deepEqual((await envios(db, a.caso)).map((x) => `${x.coluna}:${x.status}:${x.motivo ?? '-'}`), [
      '7 dias de atraso:cancelado:saiu_da_coluna',
      'Em negociação:cancelado:saiu_da_coluna',
      'Promessa ou acordo:enviando:-',
    ]);
    await db.exec(`SELECT cobranca_regua_concluir('${r.envio_id}', 'enviado', 'Combinado, Ana', 'M1', NULL, '${AGORA}')`);
    const ev = await one(db, `SELECT dados FROM cobranca_eventos WHERE caso_id = '${a.caso}' AND tipo = 'mensagem_enviada'`);
    assert.equal(ev.dados.gatilho, 'entrada_manual');
    assert.equal(ev.dados.autor, U_ADMIN);
    assert.equal(ev.dados.etapa_id, await coluna(db, 'Promessa ou acordo'));
  } finally { await db.close(); }
});

test('mover à mão: não contatar, sem telefone e régua desligada respondem sem enfileirar', async () => {
  const db = await setup();
  try {
    const nao = await devedor(db, { nome: 'Pediu Para Sair', telefone: '5548999990031', vencimento: dia(-3) });
    await db.exec(`UPDATE cobranca_inadimplentes SET nao_contatar = true WHERE id = '${nao.inad}'`);
    assert.equal((await mover(db, nao.caso, '3 dias de atraso', true)).envio, 'nao_contatar');
    assert.deepEqual((await envios(db, nao.caso)).map((e) => `${e.gatilho}:${e.status}`), ['entrada_manual:pulado']);

    const sem = await devedor(db, { nome: 'Sem Fone', telefone: null, vencimento: dia(-3) });
    assert.equal((await mover(db, sem.caso, '3 dias de atraso', true)).envio, 'sem_telefone');

    // Mandou à mão a de 7 dias e depois voltou o card: a régua não repete a de 7.
    const a = await devedor(db, { nome: 'Bia', telefone: '5548999990033', vencimento: dia(-8) });
    await mover(db, a.caso, '7 dias de atraso', true);
    await noRelogio(db);
    const [r] = await reservar(db);
    await db.exec(`SELECT cobranca_regua_concluir('${r.envio_id}', 'enviado', 'x', 'M', NULL, '${AGORA}')`);
    await mover(db, a.caso, '3 dias de atraso');
    await planejar(db, '2026-10-26T14:00:00-03:00');
    assert.equal(await colunaDo(db, a.caso), '3 dias de atraso');

    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', false)`);
    await asPostgres(db);
    const b = await devedor(db, { nome: 'Caio', telefone: '5548999990034', vencimento: dia(-3) });
    assert.deepEqual(await mover(db, b.caso, '3 dias de atraso', true), { caso_id: b.caso, envio: 'regua_desligada' });
    assert.equal(await colunaDo(db, b.caso), '3 dias de atraso', 'o card move mesmo assim');
    assert.deepEqual(await envios(db, b.caso), []);
  } finally { await db.close(); }
});

test('worker: coluna desligada ou sem mensagem depois do planejamento cancela o envio', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Dora', telefone: '5548999990041', vencimento: dia(-3) });
    const b = await devedor(db, { nome: 'Eva', telefone: '5548999990042', vencimento: dia(-1) });
    await planejar(db);
    await db.exec(`UPDATE cobranca_etapas SET automacao_ativa = false WHERE nome = '3 dias de atraso';
                   UPDATE cobranca_etapas SET mensagem = NULL WHERE nome = '1 dia de atraso'`);
    assert.deepEqual(await reservar(db), []);
    assert.deepEqual((await envios(db, a.caso)).map((e) => e.motivo), ['automacao_desligada']);
    assert.deepEqual((await envios(db, b.caso)).map((e) => e.motivo), ['sem_mensagem']);
  } finally { await db.close(); }
});

test('compromisso quebrado: volta para a coluna do atraso e recebe a mensagem dela se ainda não recebeu', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Gil', telefone: '5548999990051', vencimento: dia(-20), valor: 300 });
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_compromisso_registrar('${a.caso}', 'acordo',
      '[{"vencimento":"${dia(-3)}","valor":100},{"vencimento":"${dia(27)}","valor":200}]'::jsonb, NULL,
      '${await coluna(db, 'Promessa ou acordo')}')`);
    await asPostgres(db);
    await db.exec(`UPDATE cobranca_compromissos SET created_at = '2026-10-01T10:00:00-03:00'`);
    assert.equal(await colunaDo(db, a.caso), 'Promessa ou acordo');

    const r = await planejar(db);
    assert.equal(r.compromissos_quebrados, 1);
    assert.equal(await colunaDo(db, a.caso), '15 dias de atraso');
    assert.deepEqual((await envios(db, a.caso)).map((e) => `${e.gatilho}:${e.dias}:${e.status}:${e.coluna}`),
      ['atraso:15:pendente:15 dias de atraso']);
    assert.equal((await planejar(db)).envios_criados, 0);
  } finally { await db.close(); }
});

test('tela: colunas e lembretes pela RPC, com permissão e validação', async () => {
  const db = await setup({ ativa: false });
  try {
    await as(db, U_MEMBRO);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":45}')`)).detail, 'sem_permissao_cobranca');

    await as(db, U_ADMIN);
    const nova = await val(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":45,"mensagem":"Oi {primeiro_nome}"}')`);
    await asPostgres(db);
    const nomes = (await quadro(db)).map((c) => c.nome);
    assert.deepEqual(nomes.slice(5, 8), ['30 dias de atraso', '45 dias de atraso', 'Em negociação']);
    assert.deepEqual((await quadro(db)).map((c) => c.posicao), nomes.map((_, i) => i + 1));

    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":45}')`)).detail, 'coluna_duplicada');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{}')`)).detail, 'dias_obrigatorios');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', NULL, '{"entrada_dias":0}')`)).detail, 'dias_invalidos');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', '${await coluna(db, 'Perdido')}', '{"mensagem":"x"}')`)).detail, 'desfecho_sem_automacao');
    assert.equal((await erro(db, `SELECT cobranca_coluna_salvar('${TORQUE}', '${nova}', '{"entrada_dias":null}')`)).detail, 'dias_obrigatorios');

    // Editar: dias novos reordenam; mensagem vazia vira "só move".
    await db.query(`SELECT cobranca_coluna_salvar('${TORQUE}', '${nova}', '{"entrada_dias":10,"nome":"Dez dias","mensagem":"  ","automacao_ativa":false}')`);
    const editada = await one(db, `SELECT nome, entrada_dias, mensagem, automacao_ativa, posicao FROM cobranca_etapas WHERE id = '${nova}'`);
    assert.deepEqual(editada, { nome: 'Dez dias', entrada_dias: 10, mensagem: null, automacao_ativa: false, posicao: 5 });

    // Remover: só coluna de dias e só vazia.
    assert.equal((await erro(db, `SELECT cobranca_coluna_remover('${await coluna(db, 'Vencido')}')`)).detail, 'coluna_fixa');
    assert.equal((await erro(db, `SELECT cobranca_coluna_remover('${await coluna(db, 'Jurídico')}')`)).detail, 'coluna_fixa');
    await asPostgres(db);
    const c = await devedor(db, { nome: 'No Caminho', vencimento: dia(-3) });
    await mover(db, c.caso, 'Dez dias');
    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_coluna_remover('${nova}')`)).detail, 'coluna_com_casos');
    await asPostgres(db);
    await mover(db, c.caso, '7 dias de atraso');
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_coluna_remover('${nova}')`);
    await asPostgres(db);
    assert.deepEqual((await quadro(db)).map((x) => x.nome), LAYOUT);

    // Passos agora são só lembretes.
    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"gatilho":"atraso","dias":7,"mensagem":"x"}')`)).detail, 'use_colunas');
    const lembrete = await val(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"gatilho":"lembrete_compromisso","dias":0,"mensagem":"Hoje vence"}')`);
    assert.equal(lembrete.length, 36);
    assert.equal((await erro(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"dias":0,"mensagem":"de novo"}')`)).detail, 'passo_duplicado');

    // Prévia: a mensagem da entrada vem da coluna.
    await asPostgres(db);
    await devedor(db, { nome: 'Joana Prates', telefone: '5548999990061', vencimento: dia(-31) });
    await as(db, U_ADMIN);
    const previa = await val(db, `SELECT cobranca_regua_previa('${TORQUE}', '${AGORA}')`);
    assert.equal(previa.candidatos.length, 1);
    assert.equal(previa.candidatos[0].dias, 30);
    assert.equal(previa.candidatos[0].etapa_nome, '30 dias de atraso');
    assert.match(previa.candidatos[0].mensagem, /débito de \{valor\}/);
  } finally { await db.close(); }
});

test('rollback pareado volta a régua por passos sem perder o quadro', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Kátia', telefone: '5548999990091', vencimento: dia(-3) });
    await planejar(db);
    await db.exec(`UPDATE cobranca_etapas SET mensagem = 'Oi' WHERE nome = 'Em negociação'`);
    assert.equal((await mover(db, a.caso, 'Em negociação', true)).envio, 'na_fila');
    await db.exec(read(`../../supabase/migrations/rollback/${COLUNAS}.sql`));

    assert.equal(await val(db, `SELECT count(*)::int FROM information_schema.columns
      WHERE table_name = 'cobranca_etapas' AND column_name IN ('entrada_dias', 'mensagem', 'automacao_ativa')`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'cobranca\\_coluna%'`), 0);
    assert.deepEqual((await rows(db, `SELECT p.dias, e.nome FROM cobranca_regua_passos p
      LEFT JOIN cobranca_etapas e ON e.id = p.mover_para_etapa_id WHERE p.gatilho = 'atraso' ORDER BY p.dias`))
      .map((p) => `${p.dias}:${p.nome}`),
      ['1:1 dia de atraso', '3:3 dias de atraso', '7:7 dias de atraso', '15:15 dias de atraso', '30:30 dias de atraso', '60:Jurídico']);
    assert.deepEqual((await rows(db, `SELECT gatilho, dias FROM cobranca_regua_envios WHERE caso_id = '${a.caso}'`))
      .map((e) => `${e.gatilho}:${e.dias}`), ['atraso:3'], 'some só o envio à mão');

    // O contrato antigo funciona por cima: planejar e mover devolvem o que devolviam.
    const b = await devedor(db, { nome: 'Lia', telefone: '5548999990092', vencimento: dia(-8) });
    await planejar(db);
    assert.equal(await colunaDo(db, b.caso), '7 dias de atraso');
    await as(db, U_ADMIN);
    assert.equal(await val(db, `SELECT cobranca_caso_mover('${b.caso}', '${await coluna(db, 'Vencido')}')`), b.caso);
    await asPostgres(db);

    // E volta limpa por cima.
    await db.exec(read(`../../supabase/migrations/${COLUNAS}.sql`));
    assert.deepEqual((await quadro(db)).map((c) => c.nome), LAYOUT);
  } finally { await db.close(); }
});
