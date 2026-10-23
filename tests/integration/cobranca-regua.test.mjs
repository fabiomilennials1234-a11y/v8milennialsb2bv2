// Cobrança · entrega 2 — a régua num Postgres real (PGlite).
//
// Aplica fundação + endurecimento + régua sobre a fixture mínima e exercita o
// que o cron e a edge fazem, com relógio fixo: planejar (maior passo, mudança
// de etapa, espera após resposta, lembrete, quebra de compromisso), reservar
// (janela, teto, ritmo, revalidação, lease vencido), concluir (backoff,
// eventos), o isolamento do número da cobrança no chat e as RPCs da tela.
// GRANT/RLS do banco real ficam com o pgTAP.
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
const U_LIBERADO = id(3);
const TM_ADMIN = id(11);
const TM_MEMBRO = id(12);
const TM_LIBERADO = id(13);
const INST_COBRANCA = id(501);
const INST_COMERCIAL = id(502);
const INST_OFICIAL = id(503);
const INST_COPILOT = id(504);

// Quarta, 21/10/2026, 14h em São Paulo — dentro da janela padrão.
const AGORA = '2026-10-21T14:00:00-03:00';
const dia = (offset) => {
  const d = new Date(Date.UTC(2026, 9, 21 + offset));
  return d.toISOString().slice(0, 10);
};

async function setup({ ativa = true } = {}) {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${TORQUE}', 'TorqueCRM', 'torquecrm'),
      ('${OUTRA}', 'Outra', 'outra');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member'),
      ('${TM_LIBERADO}', '${TORQUE}', '${U_LIBERADO}', 'Cobradora', 'member');
    INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status, copilot_agent_id) VALUES
      ('${INST_COBRANCA}', '${TORQUE}', 'cobrança', 'uazapi', 'connected', NULL),
      ('${INST_COMERCIAL}', '${TORQUE}', 'comercial', 'uazapi', 'connected', NULL),
      ('${INST_OFICIAL}', '${TORQUE}', 'oficial', 'notificame', 'connected', NULL),
      ('${INST_COPILOT}', '${TORQUE}', 'sdr', 'uazapi', 'connected', '${id(777)}');
  `);
  for (const m of ['20271212000000_cobranca_fundacao', '20271212000010_cobranca_endurecer_acl', '20271213000000_cobranca_regua']) {
    await db.exec(read(`../../supabase/migrations/${m}.sql`));
  }
  await db.exec(`
    INSERT INTO member_feature_permissions (team_member_id, feature_key, enabled) VALUES
      ('${TM_LIBERADO}', 'cobranca.view', true),
      ('${TM_LIBERADO}', 'cobranca.edit', true);
  `);
  await as(db, U_ADMIN);
  await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COBRANCA}')`);
  if (ativa) await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', true)`);
  await asPostgres(db);
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

/** Cadastra pela RPC (como a tela) e devolve { inad, caso }. */
async function devedor(db, { nome, telefone = '5548999990001', vencimento, valor = 100 }) {
  await as(db, U_ADMIN);
  const inad = await val(db, `SELECT cobranca_inadimplente_salvar('${TORQUE}', NULL,
    '${JSON.stringify({ nome, telefone, titulos: [{ valor, vencimento }] }).replace(/'/g, "''")}'::jsonb)`);
  await asPostgres(db);
  const caso = await val(db, `SELECT id FROM cobranca_casos WHERE inadimplente_id = '${inad}' AND encerrado_em IS NULL`);
  return { inad, caso };
}
const planejar = (db, agora = AGORA) => one(db, `SELECT cobranca_regua_planejar('${agora}') AS r`).then((x) => x.r);
const reservar = (db, agora = AGORA, lote = 10) => rows(db, `SELECT * FROM cobranca_regua_reservar(${lote}, '${agora}')`);
const envios = (db, caso) => rows(db, `SELECT gatilho, dias, status, motivo FROM cobranca_regua_envios
  WHERE caso_id = '${caso}' ORDER BY dias`);
const etapaDo = (db, caso) => val(db, `SELECT e.nome FROM cobranca_casos c JOIN cobranca_etapas e ON e.id = c.etapa_id WHERE c.id = '${caso}'`);

test('semente: régua nasce desligada, com os passos do board e a janela comercial', async () => {
  const db = await setup({ ativa: false });
  try {
    const cfg = await one(db, `SELECT ativa, teto_diario, janela FROM cobranca_regua WHERE organization_id = '${TORQUE}'`);
    assert.equal(cfg.ativa, false);
    assert.equal(cfg.teto_diario, 30);
    assert.deepEqual(Object.keys(cfg.janela).sort(), ['1', '2', '3', '4', '5', '6']);
    const passos = await rows(db, `SELECT p.gatilho, p.dias, p.mensagem IS NOT NULL AS msg, e.nome AS move
      FROM cobranca_regua_passos p LEFT JOIN cobranca_etapas e ON e.id = p.mover_para_etapa_id
      WHERE p.organization_id = '${TORQUE}' ORDER BY p.gatilho, p.dias`);
    assert.deepEqual(passos.map((p) => `${p.gatilho}:${p.dias}:${p.msg}:${p.move ?? '-'}`), [
      'atraso:1:true:-', 'atraso:3:true:-', 'atraso:7:true:Em cobrança', 'atraso:15:true:-',
      'atraso:30:true:Cobrança intensiva', 'atraso:60:false:Jurídico', 'lembrete_compromisso:1:true:-',
    ]);
    // Org sem a flag não ganha régua.
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_regua WHERE organization_id = '${OUTRA}'`), 0);
  } finally { await db.close(); }
});

test('janela: fuso da org, dia sem faixa e fim de expediente', async () => {
  const db = await setup({ ativa: false });
  try {
    const j = `(SELECT janela FROM cobranca_regua WHERE organization_id = '${TORQUE}')`;
    const prox = (ts) => val(db, `SELECT to_char(private.cobranca_proxima_janela(${j}, 'America/Sao_Paulo', '${ts}')
      AT TIME ZONE 'America/Sao_Paulo', 'Dy DD HH24:MI')`);
    assert.equal(await prox('2026-10-21T14:00:00-03:00'), 'Wed 21 14:00'); // dentro
    assert.equal(await prox('2026-10-21T19:30:00-03:00'), 'Thu 22 09:00'); // depois do fim
    assert.equal(await prox('2026-10-22T07:00:00-03:00'), 'Thu 22 09:00'); // antes do início
    assert.equal(await prox('2026-10-24T12:30:00-03:00'), 'Mon 26 09:00'); // sábado fecha 12h, domingo não tem
    assert.equal(await val(db, `SELECT private.cobranca_na_janela(${j}, 'America/Sao_Paulo', '2026-10-25T10:00:00-03:00')`), false);
    assert.equal(await val(db, `SELECT private.cobranca_janela_valida('{"1":{"inicio":"18:00","fim":"09:00"}}')`), false);
    assert.equal(await val(db, `SELECT private.cobranca_janela_valida('{"8":{"inicio":"09:00","fim":"18:00"}}')`), false);
    assert.equal(await val(db, `SELECT private.cobranca_proxima_janela('{}'::jsonb, 'America/Sao_Paulo', now())`), null);
  } finally { await db.close(); }
});

test('planejar: só o maior passo vencido, move etapa, idempotente, e quem não pode receber nasce pulado', async () => {
  const db = await setup();
  try {
    const velho = await devedor(db, { nome: 'Antigo Ltda', telefone: '5548999990001', vencimento: dia(-40) });
    const novo = await devedor(db, { nome: 'Recente', telefone: '5548999990002', vencimento: dia(-2) });
    const semTel = await devedor(db, { nome: 'Sem Telefone', telefone: null, vencimento: dia(-8) });
    const emDia = await devedor(db, { nome: 'Vence Amanhã', telefone: '5548999990004', vencimento: dia(1) });

    const r1 = await planejar(db);
    assert.equal(r1.envios_criados, 3);
    assert.deepEqual(await envios(db, velho.caso), [{ gatilho: 'atraso', dias: 30, status: 'pendente', motivo: null }]);
    assert.equal(await etapaDo(db, velho.caso), 'Cobrança intensiva');
    assert.deepEqual(await envios(db, novo.caso), [{ gatilho: 'atraso', dias: 1, status: 'pendente', motivo: null }]);
    assert.deepEqual(await envios(db, semTel.caso), [{ gatilho: 'atraso', dias: 7, status: 'pulado', motivo: 'sem_telefone' }]);
    assert.equal(await etapaDo(db, semTel.caso), 'Em cobrança', 'mudança de etapa vale mesmo sem mensagem');
    assert.deepEqual(await envios(db, emDia.caso), []);

    const r2 = await planejar(db);
    assert.equal(r2.envios_criados, 0, 'replanejar não duplica');
    const ev = await val(db, `SELECT count(*)::int FROM cobranca_eventos WHERE caso_id = '${velho.caso}' AND tipo = 'etapa_alterada'`);
    assert.equal(ev, 1);
  } finally { await db.close(); }
});

test('planejar: régua desligada, sem número, não contatar, compromisso e resposta recente seguram o envio', async () => {
  const db = await setup();
  try {
    const nao = await devedor(db, { nome: 'Pediu Para Sair', telefone: '5548999990011', vencimento: dia(-3) });
    await db.exec(`UPDATE cobranca_inadimplentes SET nao_contatar = true WHERE id = '${nao.inad}'`);
    const resp = await devedor(db, { nome: 'Respondeu', telefone: '5548999990012', vencimento: dia(-3) });
    await db.exec(`INSERT INTO cobranca_eventos (organization_id, inadimplente_id, caso_id, tipo, created_at)
      VALUES ('${TORQUE}', '${resp.inad}', '${resp.caso}', 'mensagem_recebida', '2026-10-20T10:00:00-03:00')`);
    const comp = await devedor(db, { nome: 'Prometeu', telefone: '5548999990013', vencimento: dia(-10) });
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_compromisso_registrar('${comp.caso}', 'promessa',
      '[{"vencimento":"${dia(1)}","valor":100}]'::jsonb, NULL, NULL)`);
    await asPostgres(db);

    await planejar(db);
    assert.deepEqual(await envios(db, nao.caso), [{ gatilho: 'atraso', dias: 3, status: 'pulado', motivo: 'nao_contatar' }]);
    assert.deepEqual(await envios(db, resp.caso), [], 'respondeu há menos de 3 dias: espera');
    assert.deepEqual(await envios(db, comp.caso), [{ gatilho: 'lembrete_compromisso', dias: 1, status: 'pendente', motivo: null }],
      'com promessa: régua de atraso parada, lembrete da véspera sai');

    // Três dias depois da resposta, a régua volta.
    await planejar(db, '2026-10-23T14:00:00-03:00');
    assert.equal((await envios(db, resp.caso))[0]?.dias, 3);

    // Desligada: nada novo.
    const outro = await devedor(db, { nome: 'Depois', telefone: '5548999990014', vencimento: dia(-1) });
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', false)`);
    await asPostgres(db);
    await planejar(db);
    assert.deepEqual(await envios(db, outro.caso), []);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_regua_envios WHERE status = 'pendente'`), 0,
      'desligar esvazia a fila');
  } finally { await db.close(); }
});

test('reservar: janela, uma por org com ritmo, teto do dia e revalidação na hora do envio', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Ana Souza', telefone: '5548999990021', vencimento: dia(-3), valor: 250.5 });
    const b = await devedor(db, { nome: 'Bruno', telefone: '5548999990022', vencimento: dia(-1) });
    await planejar(db);

    assert.deepEqual(await reservar(db, '2026-10-21T20:00:00-03:00'), [], 'fora da janela não sai');

    const r1 = await reservar(db);
    assert.equal(r1.length, 1, 'uma por org por chamada');
    assert.equal(r1[0].instancia_id, INST_COBRANCA);
    assert.equal(r1[0].variaveis.primeiro_nome, 'Ana');
    assert.equal(Number(r1[0].variaveis.valor), 250.5);
    assert.equal(r1[0].variaveis.dias_atraso, 3);
    assert.equal(r1[0].variaveis.empresa, 'TorqueCRM');
    assert.match(r1[0].mensagem, /\{primeiro_nome\}/);

    assert.deepEqual(await reservar(db), [], 'ritmo: a próxima espera o intervalo');
    // O caso B foi pago entre o planejamento e o envio.
    await db.exec(`UPDATE cobranca_titulos SET status = 'pago', pago_em = '${dia(0)}' WHERE inadimplente_id = '${b.inad}'`);
    await db.exec(`UPDATE cobranca_regua SET proximo_envio_apos = NULL`);
    assert.deepEqual(await reservar(db), []);
    assert.deepEqual(await envios(db, b.caso), [{ gatilho: 'atraso', dias: 1, status: 'cancelado', motivo: 'divida_mudou' }]);

    // Teto: com 1 enviado hoje e teto 1, nada mais sai.
    await db.exec(`SELECT cobranca_regua_concluir('${r1[0].envio_id}', 'enviado', 'oi', 'MSG1', NULL, '${AGORA}')`);
    await db.exec(`UPDATE cobranca_regua SET teto_diario = 1, proximo_envio_apos = NULL`);
    const c = await devedor(db, { nome: 'Carla', telefone: '5548999990023', vencimento: dia(-1) });
    await planejar(db);
    assert.deepEqual(await reservar(db), []);
    assert.deepEqual(await envios(db, c.caso), [{ gatilho: 'atraso', dias: 1, status: 'pendente', motivo: null }]);
    assert.equal(a.caso.length, 36);
  } finally { await db.close(); }
});

test('concluir: enviado vira evento sem contar como contato; falha tenta 3 vezes com espera crescente', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Dora', telefone: '5548999990031', vencimento: dia(-3) });
    const b = await devedor(db, { nome: 'Eva', telefone: '5548999990032', vencimento: dia(-1) });
    await planejar(db);
    const [ra] = await reservar(db);
    await db.exec(`SELECT cobranca_regua_concluir('${ra.envio_id}', 'enviado', 'Olá Dora', 'MSG-A', NULL, '${AGORA}')`);
    const ev = await one(db, `SELECT dados FROM cobranca_eventos WHERE tipo = 'mensagem_enviada' AND inadimplente_id = '${a.inad}'`);
    assert.equal(ev.dados.origem, 'regua');
    assert.equal(ev.dados.texto, 'Olá Dora');
    assert.equal(await val(db, `SELECT ultimo_contato_em FROM cobranca_inadimplentes_resumo WHERE id = '${a.inad}'`), null,
      'mensagem de robô não é "último contato"');

    await db.exec(`UPDATE cobranca_regua SET proximo_envio_apos = NULL`);
    const [rb] = await reservar(db);
    assert.equal(await val(db, `SELECT cobranca_regua_concluir('${rb.envio_id}', 'retentar', NULL, NULL, 'timeout', '${AGORA}')`), 'pendente');
    const agendado = await val(db, `SELECT to_char(agendado_para AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') FROM cobranca_regua_envios WHERE id = '${rb.envio_id}'`);
    assert.equal(agendado, '14:05');
    for (const [hora, esperado] of [['14:06', 'pendente'], ['14:20', 'falhou']]) {
      await db.exec(`UPDATE cobranca_regua SET proximo_envio_apos = NULL`);
      const [r] = await reservar(db, `2026-10-21T${hora}:00-03:00`);
      assert.equal(r.envio_id, rb.envio_id);
      assert.equal(await val(db, `SELECT cobranca_regua_concluir('${r.envio_id}', 'retentar', NULL, NULL, 'timeout', '2026-10-21T${hora}:00-03:00')`), esperado);
    }
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_eventos WHERE inadimplente_id = '${b.inad}' AND tipo = 'envio_falhou'`), 1);
  } finally { await db.close(); }
});

test('reservar: envio preso em "enviando" com lease vencido falha como incerto e NÃO volta para a fila', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Fábio', telefone: '5548999990041', vencimento: dia(-1) });
    await planejar(db);
    await reservar(db);
    await reservar(db, '2026-10-21T14:10:00-03:00');
    assert.deepEqual(await envios(db, a.caso), [{ gatilho: 'atraso', dias: 1, status: 'falhou', motivo: 'resultado_incerto' }]);
  } finally { await db.close(); }
});

test('compromisso quebrado: parcela vencida e não paga encerra o acordo e devolve o caso à régua', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Gil', telefone: '5548999990051', vencimento: dia(-20), valor: 300 });
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_compromisso_registrar('${a.caso}', 'acordo',
      '[{"vencimento":"${dia(-3)}","valor":100},{"vencimento":"${dia(27)}","valor":200}]'::jsonb, NULL, NULL)`);
    await asPostgres(db);
    await db.exec(`UPDATE cobranca_compromissos SET created_at = '2026-10-01T10:00:00-03:00'`);
    const r = await planejar(db);
    assert.equal(r.compromissos_quebrados, 1);
    assert.equal(await val(db, `SELECT status FROM cobranca_compromissos WHERE caso_id = '${a.caso}'`), 'quebrado');
    assert.equal(await etapaDo(db, a.caso), 'Em cobrança');
    assert.deepEqual(await envios(db, a.caso), [{ gatilho: 'atraso', dias: 15, status: 'pendente', motivo: null }]);
  } finally { await db.close(); }
});

test('número da cobrança: mensagem não liga a lead comercial, resposta vira evento e SAIR marca não contatar', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Helena', telefone: '5548999990061', vencimento: dia(-1) });
    await db.exec(`INSERT INTO leads (organization_id, phone_digits) VALUES ('${TORQUE}', '5548999990061')`);
    await planejar(db);

    await db.exec(`INSERT INTO whatsapp_messages (organization_id, instance_id, message_id, phone_number, direction, content)
      VALUES ('${TORQUE}', '${INST_COMERCIAL}', 'C1', '5548999990061', 'incoming', 'oi comercial'),
             ('${TORQUE}', '${INST_COBRANCA}', 'K1', '5548999990061', 'incoming', 'Vou pagar sexta')`);
    assert.notEqual(await val(db, `SELECT lead_id FROM whatsapp_messages WHERE message_id = 'C1'`), null);
    assert.equal(await val(db, `SELECT lead_id FROM whatsapp_messages WHERE message_id = 'K1'`), null);
    await db.exec(`UPDATE whatsapp_messages SET lead_id = (SELECT id FROM leads LIMIT 1) WHERE message_id = 'K1'`);
    assert.equal(await val(db, `SELECT lead_id FROM whatsapp_messages WHERE message_id = 'K1'`), null, 'nem por UPDATE');

    const recebida = await one(db, `SELECT dados FROM cobranca_eventos WHERE inadimplente_id = '${a.inad}' AND tipo = 'mensagem_recebida'`);
    assert.equal(recebida.dados.texto, 'Vou pagar sexta');
    assert.equal(await val(db, `SELECT ultimo_contato_canal FROM cobranca_inadimplentes_resumo WHERE id = '${a.inad}'`), 'whatsapp');

    // Mensagem humana pelo chat: evento de origem chat.
    await db.exec(`INSERT INTO whatsapp_messages (organization_id, instance_id, message_id, phone_number, direction, content, sent_source)
      VALUES ('${TORQUE}', '${INST_COBRANCA}', 'K2', '5548999990061', 'outgoing', 'Combinado!', 'manual')`);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_eventos WHERE inadimplente_id = '${a.inad}'
      AND tipo = 'mensagem_enviada' AND dados ->> 'origem' = 'chat'`), 1);

    // Nono dígito ausente no WhatsApp ainda acha o devedor; "Sair!" vira não contatar e limpa a fila.
    await db.exec(`INSERT INTO whatsapp_messages (organization_id, instance_id, message_id, phone_number, direction, content)
      VALUES ('${TORQUE}', '${INST_COBRANCA}', 'K3', '554899990061', 'incoming', ' Sair! ')`);
    assert.equal(await val(db, `SELECT nao_contatar FROM cobranca_inadimplentes WHERE id = '${a.inad}'`), true);
    assert.deepEqual(await envios(db, a.caso), [{ gatilho: 'atraso', dias: 1, status: 'cancelado', motivo: 'nao_contatar' }]);

    // Número de fora da cobrança: nenhum evento.
    const antes = await val(db, `SELECT count(*)::int FROM cobranca_eventos`);
    await db.exec(`INSERT INTO whatsapp_messages (organization_id, instance_id, message_id, phone_number, direction, content)
      VALUES ('${TORQUE}', '${INST_COMERCIAL}', 'C2', '5548999990061', 'incoming', 'SAIR')`);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_eventos`), antes);
  } finally { await db.close(); }
});

test('número da cobrança: o eco do envio da régua não vira "mensagem humana"', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Igor', telefone: '5548999990071', vencimento: dia(-1) });
    await planejar(db);
    const [r] = await reservar(db);
    // O eco chega antes de a edge concluir, ainda como 'manual'.
    await db.exec(`INSERT INTO whatsapp_messages (organization_id, instance_id, message_id, phone_number, direction, content, sent_source)
      VALUES ('${TORQUE}', '${INST_COBRANCA}', 'E1', '5548999990071', 'outgoing', 'texto da régua', 'manual')`);
    await db.exec(`SELECT cobranca_regua_concluir('${r.envio_id}', 'enviado', 'texto da régua', 'E1', NULL)`);
    const origens = await rows(db, `SELECT dados ->> 'origem' AS o FROM cobranca_eventos
      WHERE inadimplente_id = '${a.inad}' AND tipo = 'mensagem_enviada'`);
    assert.deepEqual(origens.map((x) => x.o), ['regua']);
  } finally { await db.close(); }
});

test('tela: permissão, número só por admin e só chip sem copilot, validação de passos e prévia', async () => {
  const db = await setup({ ativa: false });
  try {
    await as(db, U_MEMBRO);
    assert.equal((await erro(db, `SELECT cobranca_regua_salvar('${TORQUE}', '{"teto_diario":10}')`)).detail, 'sem_permissao_cobranca');
    await as(db, U_LIBERADO);
    assert.equal((await erro(db, `SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COMERCIAL}')`)).detail, 'so_admin');
    assert.equal((await erro(db, `SELECT cobranca_regua_reservar(1, now())`)).code, '42501', 'worker não é da tela');

    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_OFICIAL}')`)).detail, 'provider_nao_suportado');
    assert.equal((await erro(db, `SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COPILOT}')`)).detail, 'numero_com_copilot');
    await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_COMERCIAL}')`);
    await asPostgres(db);
    assert.deepEqual((await rows(db, `SELECT id FROM whatsapp_instances WHERE reserved_for = 'collections'`)).map((r) => r.id),
      [INST_COMERCIAL], 'trocar o número solta o anterior');

    await as(db, U_LIBERADO);
    assert.equal((await erro(db, `SELECT cobranca_regua_salvar('${TORQUE}', '{"janela":{"1":{"inicio":"18:00","fim":"08:00"}}}')`)).detail, 'janela_invalida');
    assert.equal((await erro(db, `SELECT cobranca_regua_salvar('${TORQUE}', '{"intervalo_min_segundos":600,"intervalo_max_segundos":60}')`)).detail, 'valores_fora_do_permitido');
    await db.query(`SELECT cobranca_regua_salvar('${TORQUE}', '{"teto_diario":12,"como_pagar":"PIX: cobranca@torque.com"}')`);
    assert.equal((await erro(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"gatilho":"atraso","dias":7,"mensagem":"x"}')`)).detail, 'passo_duplicado');
    assert.equal((await erro(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"gatilho":"atraso","dias":0,"mensagem":"x"}')`)).detail, 'dias_invalidos');
    assert.equal((await erro(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"gatilho":"atraso","dias":45}')`)).detail, 'passo_vazio');
    const novo = await val(db, `SELECT cobranca_regua_passo_salvar('${TORQUE}', NULL, '{"gatilho":"atraso","dias":45,"mensagem":"Oi {primeiro_nome}"}')`);
    assert.equal(novo.length, 36);

    await asPostgres(db);
    await devedor(db, { nome: 'Joana Prates', telefone: '5548999990081', vencimento: dia(-46) });
    await as(db, U_LIBERADO);
    const previa = await val(db, `SELECT cobranca_regua_previa('${TORQUE}', '${AGORA}')`);
    assert.equal(previa.ativa, false);
    assert.equal(previa.numero_pronto, true);
    assert.equal(previa.na_janela, true);
    assert.equal(previa.candidatos.length, 1);
    assert.equal(previa.candidatos[0].dias, 45);
    assert.equal(previa.candidatos[0].variaveis.como_pagar, 'PIX: cobranca@torque.com');
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_regua_envios`), 0, 'prévia não grava');

    await db.query(`SELECT cobranca_regua_ativar('${TORQUE}', true)`);
    await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', NULL)`).catch(() => {});
    await as(db, U_ADMIN);
    await db.query(`SELECT cobranca_regua_definir_numero('${TORQUE}', NULL)`);
    assert.equal(await val(db, `SELECT ativa FROM cobranca_regua WHERE organization_id = '${TORQUE}'`), false, 'sem número, régua desliga');
    assert.equal((await erro(db, `SELECT cobranca_regua_ativar('${TORQUE}', true)`)).detail, 'sem_numero');
  } finally { await db.close(); }
});

test('número da cobrança sem vínculo comercial: sem dono e sem copilot, nos dois sentidos', async () => {
  const db = await setup({ ativa: false });
  try {
    const INST_DONO = id(505);
    const INST_AGENTE = id(506);
    await db.exec(`INSERT INTO whatsapp_instances (id, organization_id, instance_name, provider, status, owner_team_member_id) VALUES
      ('${INST_DONO}', '${TORQUE}', 'do vendedor', 'uazapi', 'connected', '${TM_MEMBRO}'),
      ('${INST_AGENTE}', '${TORQUE}', 'do agente', 'uazapi', 'connected', NULL);
      INSERT INTO copilot_agents (organization_id, name, whatsapp_instance_id) VALUES ('${TORQUE}', 'SDR', '${INST_AGENTE}');`);
    await as(db, U_ADMIN);
    assert.equal((await erro(db, `SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_DONO}')`)).detail, 'numero_com_dono');
    assert.equal((await erro(db, `SELECT cobranca_regua_definir_numero('${TORQUE}', '${INST_AGENTE}')`)).detail, 'numero_com_copilot');
    await asPostgres(db);
    // O número já reservado não ganha dono nem agente depois.
    assert.equal((await erro(db, `UPDATE whatsapp_instances SET owner_team_member_id = '${TM_MEMBRO}' WHERE id = '${INST_COBRANCA}'`)).detail,
      'numero_da_cobranca_vinculado');
    assert.equal((await erro(db, `UPDATE copilot_agents SET whatsapp_instance_id = '${INST_COBRANCA}'`)).detail,
      'numero_da_cobranca_vinculado');
    // Número comum segue livre para dono e agente.
    await db.exec(`UPDATE whatsapp_instances SET owner_team_member_id = '${TM_MEMBRO}' WHERE id = '${INST_COMERCIAL}'`);
  } finally { await db.close(); }
});

test('webhook: a RPC de resolução de instância devolve o setor do número (zero ida extra)', async () => {
  const db = await setup({ ativa: false });
  try {
    await db.exec(`INSERT INTO whatsapp_instance_secrets (instance_id, uazapi_instance_id, uazapi_token) VALUES
      ('${INST_COBRANCA}', 'rCOB', 'tok-cob'), ('${INST_COMERCIAL}', 'rCOM', 'tok-com')`);
    await db.exec(`SET test.role = 'service_role'`);
    assert.equal((await one(db, `SELECT * FROM resolve_uazapi_instance('rCOB', NULL)`)).reserved_for, 'collections');
    assert.equal((await one(db, `SELECT * FROM resolve_uazapi_instance(NULL, 'tok-com')`)).reserved_for, null);
    await db.exec(`SET test.role = ''`);
  } finally { await db.close(); }
});

test('rollback pareado remove a régua e devolve o contrato da entrega 1', async () => {
  const db = await setup();
  try {
    const a = await devedor(db, { nome: 'Kátia', telefone: '5548999990091', vencimento: dia(-1) });
    await planejar(db);
    await db.exec(`INSERT INTO whatsapp_messages (organization_id, instance_id, message_id, phone_number, direction, content)
      VALUES ('${TORQUE}', '${INST_COBRANCA}', 'R1', '5548999990091', 'incoming', 'oi')`);
    assert.ok(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'cobranca\\_regua\\_%'`) > 5);
    await db.exec(read('../../supabase/migrations/rollback/20271213000000_cobranca_regua.sql'));
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'cobranca\\_regua\\_%'`), 0);
    assert.equal(await val(db, `SELECT to_regclass('public.cobranca_regua_envios') IS NULL`), true);
    assert.equal(await val(db, `SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'whatsapp_instances' AND column_name = 'reserved_for'`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_eventos WHERE inadimplente_id = '${a.inad}' AND tipo = 'mensagem_recebida'`), 0);
    // E volta limpa por cima.
    await db.exec(read('../../supabase/migrations/20271213000000_cobranca_regua.sql'));
    assert.equal(await val(db, `SELECT count(*)::int FROM cobranca_regua_passos WHERE organization_id = '${TORQUE}'`), 7);
  } finally { await db.close(); }
});
