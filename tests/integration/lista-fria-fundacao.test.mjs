// Lista Fria · entrega 1 — lógica das RPCs num Postgres real (PGlite).
//
// Aplica a migration 20271217000000 de verdade sobre a fixture mínima da Cobrança
// (ver helpers/lista-fria-db.mjs) mais o que a Lista Fria toca em `leads`.
//
// Cobre a LÓGICA: flag, permissão, créditos (reserva, cobrança, devolução, uma
// vez só), worker, importação como lead de seção (sem funil, sem gatilho, sem
// webhook, sem duplicar) e a guarda da marca. A fidelidade de GRANT/RLS do banco
// real é do pgTAP (supabase/tests/lista_fria_fundacao_test.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLLBACK, ROLLBACK_CNPJ, ROLLBACK_META, ROLLBACK_VARREDURA, ROLLBACK_POR_CREDITOS, TORQUE, OUTRA, U_ADMIN, U_MEMBRO, U_LIBERADO, U_MASTER, U_OUTRA,
  read, setup, as, asWorker, asPostgres, one, val, maps, criarBusca, item, registrar, comSaldo,
} from './helpers/lista-fria-db.mjs';

test('flag liga só a TorqueCRM; permissões nascem desligadas; a origem entra no registro', async () => {
  const db = await setup();
  try {
    assert.equal(await val(db, `SELECT feature_flags -> 'lista_fria' = 'true'::jsonb FROM organizations WHERE id = '${TORQUE}'`), true);
    assert.equal(await val(db, `SELECT feature_flags ? 'lista_fria' FROM organizations WHERE id = '${OUTRA}'`), false);
    assert.deepEqual(
      (await db.query(`SELECT key, default_value FROM feature_permissions ORDER BY key`)).rows,
      [{ key: 'lista_fria.edit', default_value: false }, { key: 'lista_fria.view', default_value: false }],
    );
    assert.deepEqual(
      (await db.query(`SELECT organization_id, slug FROM lead_origins`)).rows,
      [{ organization_id: TORQUE, slug: 'lista_fria' }],
    );
  } finally { await db.close(); }
});

test('acesso: membro sem permissão, org sem a flag e master', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_MEMBRO);
    await assert.rejects(db.query(`SELECT lista_fria_saldo('${TORQUE}')`), /permissão para usar a Lista fria/);
    await assert.rejects(criarBusca(db, 'maps', maps, 10), /permissão para usar a Lista fria/);

    await as(db, U_OUTRA);
    await assert.rejects(criarBusca(db, 'maps', maps, 10, OUTRA), /não está liberada/);

    await as(db, U_LIBERADO);
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 100);
    await as(db, U_ADMIN);
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 100);
  } finally { await db.close(); }
});

test('créditos: só master concede; a busca reserva; saldo insuficiente recusa; handle sai normalizado', async () => {
  const db = await setup();
  try {
    await as(db, U_ADMIN);
    await assert.rejects(db.query(`SELECT lista_fria_creditos_conceder('${TORQUE}', 10)`), /Só o time Torque/);
    await comSaldo(db, 100);
    await comSaldo(db, 60, 'meta'); // Instagram gasta do saldo Meta (a reserva é o pedido, ADR-0047)

    await as(db, U_LIBERADO);
    await assert.rejects(criarBusca(db, 'maps', maps, 500), /Saldo de créditos insuficiente/);
    await assert.rejects(criarBusca(db, 'maps', maps, 0), /1 a 100\.000/);
    await assert.rejects(criarBusca(db, 'maps', { nicho: 'x', cidade: 'SP' }, 10), /nicho e a cidade/);
    await assert.rejects(criarBusca(db, 'instagram', { url: 'https://www.instagram.com/p/abc123/' }, 10), /URL de uma conta/);
    await assert.rejects(criarBusca(db, 'twitter', {}, 10), /Fonte inválida/);

    const ig = await criarBusca(db, 'instagram', { url: '@Clinica.Odonto_Vida?hl=pt' }, 30);
    assert.equal(await val(db, `SELECT instagram_handle FROM lista_fria_buscas WHERE id = '${ig}'`), 'clinica.odonto_vida');
    const mp = await criarBusca(db, 'maps', maps, 20);
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 80, 'só a reserva de Maps (20) sai do saldo normal');
    assert.equal(await val(db, `SELECT (lista_fria_saldos('${TORQUE}') ->> 'meta')::int`), 30, 'a reserva do Instagram (30) saiu do saldo Meta');
    assert.equal(await val(db, `SELECT status FROM lista_fria_buscas WHERE id = '${mp}'`), 'na_fila');

    // No máximo 3 abertas por org.
    await criarBusca(db, 'maps', { nicho: 'Padarias', cidade: 'Recife - PE' }, 5);
    await assert.rejects(criarBusca(db, 'maps', { nicho: 'Bares', cidade: 'Recife - PE' }, 5), /3 buscas em andamento/);
  } finally { await db.close(); }
});

test('worker: cobra só contato novo e válido, já-lead não consome, para no limite, devolve a sobra uma vez', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await asPostgres(db);
    await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('${TORQUE}', 'Lead Antigo', '5511999990001')`);

    await as(db, U_LIBERADO);
    const b1 = await criarBusca(db, 'maps', maps, 3);
    const b2 = await criarBusca(db, 'maps', { nicho: 'Padarias', cidade: 'Recife - PE' }, 2);
    await asPostgres(db);
    // As duas nasceram na mesma transação: fixa a ordem da fila.
    await db.exec(`UPDATE lista_fria_buscas SET created_at = created_at - interval '1 minute' WHERE id = '${b1}'`);

    await asWorker(db);
    assert.equal((await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`)).rows[0].id, b1, 'a mais antiga primeiro');
    assert.equal((await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w2')`)).rows[0].id, b2, 'o segundo worker não pega a mesma');
    assert.equal((await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w3')`)).rows.length, 0, 'fila vazia');

    const r = await registrar(db, b1, 'w1', [
      item('p1', { telefone: '(11) 3814-2207', email: 'um@x.com.br' }),
      item('p2', { telefone: '11999990001' }),               // já é lead (mesmo número, formato diferente)
      item('p3'),                                             // sem contato
      item('p4', { email: 'DOIS@X.COM.BR' }),
      item('p5', { telefone: '1120959999' }),                // 10 dígitos, ganha o 55
      item('p6', { telefone: '11988887777' }),               // passou do limite
    ]);
    assert.equal(r.aceitos, 3);
    assert.equal(r.ja_eram_leads, 1);
    assert.equal(r.limite_atingido, true);
    assert.equal(await val(db, `SELECT creditos_usados FROM lista_fria_buscas WHERE id = '${b1}'`), 3);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_resultados WHERE busca_id = '${b1}' AND ref_externa = 'p6'`), 0);
    assert.equal(await val(db, `SELECT telefone FROM lista_fria_resultados WHERE ref_externa = 'p5'`), '551120959999');
    assert.equal(await val(db, `SELECT email FROM lista_fria_resultados WHERE ref_externa = 'p4'`), 'dois@x.com.br');
    assert.equal(await val(db, `SELECT ja_e_lead FROM lista_fria_resultados WHERE ref_externa = 'p2'`), true);

    // Worker errado não grava, e o mesmo item de novo não duplica nem cobra.
    assert.equal((await registrar(db, b1, 'w9', [item('p7', { email: 'a@b.co' })])).ativa, false);
    assert.equal((await registrar(db, b1, 'w1', [item('p1', { telefone: '1138142207' })])).aceitos, 0);

    assert.equal(await val(db, `SELECT lista_fria_worker_progresso('${b1}', 'w1', 'ia', 150, 9, 5, 2, 4)`), 'executando');
    assert.equal(await val(db, `SELECT progresso FROM lista_fria_buscas WHERE id = '${b1}'`), 99, 'progresso nunca passa de 99 antes de encerrar');

    await db.query(`SELECT lista_fria_worker_encerrar('${b1}', 'w1', 'concluida')`);
    await db.query(`SELECT lista_fria_worker_encerrar('${b1}', 'w1', 'concluida')`);
    // b2 (limite 2) não usou nada: devolve 2, uma vez só.
    await db.query(`SELECT lista_fria_worker_encerrar('${b2}', 'w2', 'concluida')`);
    await db.query(`SELECT lista_fria_worker_encerrar('${b2}', 'w2', 'concluida')`);
    await asPostgres(db);
    // 100 - 3 (b1 usou tudo) - 2 + 2 (b2 devolvida) = 97
    assert.equal(await val(db, `SELECT private.lista_fria_saldo_da_org('${TORQUE}')`), 97);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_creditos WHERE motivo = 'devolucao'`), 1, 'b1 não tinha sobra');
    assert.equal(await val(db, `SELECT status FROM lista_fria_buscas WHERE id = '${b1}'`), 'concluida');
    assert.equal(await val(db, `SELECT progresso FROM lista_fria_buscas WHERE id = '${b1}'`), 100);
  } finally { await db.close(); }
});

test('parar a busca em andamento fica com o que achou; cancelar a da fila devolve tudo', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 50);
    await as(db, U_LIBERADO);
    const rodando = await criarBusca(db, 'maps', maps, 10);
    const fila = await criarBusca(db, 'maps', { nicho: 'Padarias', cidade: 'Recife - PE' }, 7);
    await asWorker(db);
    await db.query(`UPDATE lista_fria_buscas SET created_at = created_at - interval '1 minute' WHERE id = '${rodando}'`);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await registrar(db, rodando, 'w1', [item('a', { email: 'a@a.co' }), item('b', { email: 'b@b.co' })]);

    await as(db, U_LIBERADO);
    await db.query(`SELECT lista_fria_busca_cancelar('${rodando}')`);
    await db.query(`SELECT lista_fria_busca_cancelar('${fila}')`);
    assert.equal(await val(db, `SELECT status FROM lista_fria_buscas WHERE id = '${rodando}'`), 'parada');
    assert.equal(await val(db, `SELECT status FROM lista_fria_buscas WHERE id = '${fila}'`), 'cancelada');
    // 50 - 2 usados - 0 = 48: a parada devolve 8 (10 - 2) e a cancelada, os 7.
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 48);
    await assert.rejects(db.query(`SELECT lista_fria_busca_cancelar('${fila}')`), /já terminou/);

    // O worker que ainda estiver rodando descobre pelo status e para de gastar.
    await asWorker(db);
    assert.equal(await val(db, `SELECT lista_fria_worker_progresso('${rodando}', 'w1', 'ia', 10, 1, 1, 1, 0)`), 'parada');
    assert.equal((await registrar(db, rodando, 'w1', [item('c', { email: 'c@c.co' })])).ativa, false);
  } finally { await db.close(); }
});

test('importação: vira lead da seção, sem gatilho, sem webhook, sem funil, sem duplicar', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await asPostgres(db);
    await db.exec(`INSERT INTO leads (organization_id, name, phone, email) VALUES
      ('${TORQUE}', 'Lead Antigo', '5511999990001', NULL),
      ('${TORQUE}', 'Lead por e-mail', NULL, 'jaexiste@x.com.br')`);

    // Os dois leads comuns de cima já geraram entrega de webhook: o que importa é o que vem DEPOIS.
    const entregasAntes = await val(db, `SELECT count(*)::int FROM webhook_deliveries`);
    assert.equal(entregasAntes, 2);

    await as(db, U_LIBERADO);
    const b = await criarBusca(db, 'maps', maps, 10);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await registrar(db, b, 'w1', [
      item('p1', { nome: 'Clínica Um', telefone: '(11) 3814-2207', email: 'um@x.com.br', categoria: 'Dentista', site: 'https://um.com.br' }),
      item('p2', { nome: 'Clínica Dois', email: 'dois@x.com.br' }),
      item('p3', { nome: 'Clínica Três', telefone: '1120959999' }),
      item('p4', { telefone: '11999990001' }),            // já é lead, entra marcado
      item('p5', { email: 'JaExiste@x.com.br' }),         // já é lead por e-mail
    ]);
    await db.query(`SELECT lista_fria_worker_encerrar('${b}', 'w1', 'concluida')`);

    await as(db, U_LIBERADO);
    // Antes de terminar não importava; agora desmarca a Três na revisão.
    assert.equal(await val(db, `SELECT lista_fria_resultados_selecionar('${b}', ARRAY(SELECT id FROM lista_fria_resultados WHERE ref_externa = 'p3'), false)`), 1);
    const r = await one(db, `SELECT lista_fria_importar('${b}', 200) AS r`);
    assert.deepEqual(r.r, { importados: 2, ja_eram_leads: 0, restantes: 0 });

    await asPostgres(db);
    const leads = (await db.query(`SELECT name, phone, email, segment, origin, excluded_from_metrics, lista_fria_busca_id, notes FROM leads WHERE lista_fria_busca_id IS NOT NULL ORDER BY name`)).rows;
    assert.equal(leads.length, 2);
    assert.deepEqual(leads.map((l) => l.name), ['Clínica Dois', 'Clínica Um']);
    assert.ok(leads.every((l) => l.origin === 'lista_fria' && l.excluded_from_metrics === true && l.lista_fria_busca_id === b));
    assert.match(leads.find((l) => l.name === 'Clínica Um').notes, /Lista fria · Maps · Dentistas, São Paulo - SP/);
    assert.equal(leads.find((l) => l.name === 'Clínica Um').segment, 'Dentista');

    // Nada de gatilho de lead criado nem de webhook para os leads da seção.
    assert.equal(await val(db, `SELECT count(*)::int FROM workflow_disparos WHERE lead_id IN (SELECT id FROM leads WHERE lista_fria_busca_id IS NOT NULL)`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM webhook_deliveries`), entregasAntes, 'lead da seção não gerou webhook');
    // Mas o lead comum continua disparando os dois (a guarda é só da seção).
    await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('${TORQUE}', 'Lead Comum', '5548999990000')`);
    assert.equal(await val(db, `SELECT count(*)::int FROM workflow_disparos WHERE gatilho = 'lead_created'`), 3, 'dois leads de setup + o comum');
    assert.equal(await val(db, `SELECT count(*)::int FROM webhook_deliveries WHERE event = 'lead.created'`), entregasAntes + 1);

    // Importar de novo não duplica nem cria nada.
    await as(db, U_LIBERADO);
    assert.deepEqual((await one(db, `SELECT lista_fria_importar('${b}') AS r`)).r, { importados: 0, ja_eram_leads: 0, restantes: 0 });
    await asPostgres(db);
    assert.equal(await val(db, `SELECT importados FROM lista_fria_buscas WHERE id = '${b}'`), 2);
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_class WHERE relname = 'pipeline_entries'`), 0, 'a Lista Fria nem conhece funil');
  } finally { await db.close(); }
});

test('importação em lotes: a RPC diz quantos faltam; corrida com lead novo vira já-é-lead', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 100);
    await as(db, U_LIBERADO);
    const b = await criarBusca(db, 'maps', maps, 10);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await registrar(db, b, 'w1', [1, 2, 3, 4, 5].map((n) => item(`p${n}`, { telefone: `1138140${n}00` })));

    await as(db, U_LIBERADO);
    await assert.rejects(db.query(`SELECT lista_fria_importar('${b}')`), /ainda não terminou/);
    await asWorker(db);
    await db.query(`SELECT lista_fria_worker_encerrar('${b}', 'w1', 'concluida')`);

    // Entre a busca e a importação, o telefone p3 virou lead (chegou pelo WhatsApp).
    await asPostgres(db);
    await db.exec(`INSERT INTO leads (organization_id, name, phone) VALUES ('${TORQUE}', 'Chegou no zap', '5511938140300')`);

    await as(db, U_LIBERADO);
    const a = (await one(db, `SELECT lista_fria_importar('${b}', 2) AS r`)).r;
    // Os 5 resultados nascem na mesma transação: quem cai em qual lote depende do desempate
    // por UUID. O que não depende da ordem: cada lote consome 2, e o total fecha.
    assert.equal(a.importados + a.ja_eram_leads, 2);
    assert.equal(a.restantes, 3);
    const c = (await one(db, `SELECT lista_fria_importar('${b}', 2) AS r`)).r;
    assert.equal(c.importados + c.ja_eram_leads, 2);
    assert.equal(c.restantes, 1);
    const d = (await one(db, `SELECT lista_fria_importar('${b}', 2) AS r`)).r;
    assert.equal(d.restantes, 0);
    assert.equal(a.importados + c.importados + d.importados, 4, 'quatro viram lead');
    assert.equal(a.ja_eram_leads + c.ja_eram_leads + d.ja_eram_leads, 1, 'e o que chegou pelo WhatsApp conta como já-é-lead, em qualquer lote');
    await asPostgres(db);
    assert.equal(await val(db, `SELECT count(*)::int FROM leads WHERE lista_fria_busca_id = '${b}'`), 4);
    assert.equal(await val(db, `SELECT ja_e_lead FROM lista_fria_resultados WHERE ref_externa = 'p3'`), true);
    assert.notEqual(await val(db, `SELECT importada_em FROM lista_fria_buscas WHERE id = '${b}'`), null);
  } finally { await db.close(); }
});

test('a marca em leads só muda pela RPC (não pelo UPDATE do usuário)', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 20);
    await as(db, U_LIBERADO);
    const b = await criarBusca(db, 'maps', maps, 5);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await registrar(db, b, 'w1', [item('p1', { telefone: '1138140100' })]);
    await db.query(`SELECT lista_fria_worker_encerrar('${b}', 'w1', 'concluida')`);
    await as(db, U_LIBERADO);
    await db.query(`SELECT lista_fria_importar('${b}')`);

    // Um usuário comum não tira o lead da seção, nem empurra outro para ela, nem cria lead já marcado.
    await asPostgres(db);
    await db.exec(`GRANT SELECT, UPDATE, INSERT ON public.leads TO authenticated`);
    await as(db, U_ADMIN);
    await assert.rejects(db.query(`UPDATE leads SET lista_fria_busca_id = NULL WHERE lista_fria_busca_id IS NOT NULL`), /só muda pelas ações da própria Lista fria/);
    await asPostgres(db);
    await db.exec(`INSERT INTO leads (organization_id, name) VALUES ('${TORQUE}', 'Comum')`);
    await as(db, U_ADMIN);
    await assert.rejects(db.query(`UPDATE leads SET lista_fria_busca_id = '${b}' WHERE name = 'Comum'`), /só muda pelas ações da própria Lista fria/);
    await assert.rejects(db.query(`INSERT INTO leads (organization_id, name, lista_fria_busca_id) VALUES ('${TORQUE}', 'Forjado', '${b}')`), /só muda pelas ações da própria Lista fria/);
    // Editar outra coisa no lead da seção continua livre.
    await db.query(`UPDATE leads SET notes = 'ligar amanhã' WHERE lista_fria_busca_id IS NOT NULL`);
  } finally { await db.close(); }
});

test('worker morto: busca sem sinal há 10 min falha e devolve a sobra', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 20);
    await as(db, U_LIBERADO);
    const b = await criarBusca(db, 'maps', maps, 8);
    await asWorker(db);
    await db.query(`SELECT * FROM lista_fria_worker_reivindicar('w1')`);
    await registrar(db, b, 'w1', [item('p1', { email: 'a@a.co' })]);
    assert.equal(await val(db, `SELECT lista_fria_worker_recuperar_travadas()`), 0, 'ainda tem sinal de vida');
    await db.query(`UPDATE lista_fria_buscas SET heartbeat_at = now() - interval '11 minutes' WHERE id = '${b}'`);
    assert.equal(await val(db, `SELECT lista_fria_worker_recuperar_travadas()`), 1);
    assert.equal(await val(db, `SELECT status FROM lista_fria_buscas WHERE id = '${b}'`), 'falhou');
    assert.equal(await val(db, `SELECT erro FROM lista_fria_buscas WHERE id = '${b}'`), 'worker_sem_sinal');
    await as(db, U_LIBERADO);
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 19, '20 - 1 usado');
  } finally { await db.close(); }
});

test('RLS: leitura só com flag + lista_fria.view; escrita direta é negada', async () => {
  const db = await setup();
  try {
    await comSaldo(db, 20);
    await as(db, U_LIBERADO);
    await criarBusca(db, 'maps', maps, 5);

    await as(db, U_LIBERADO);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_buscas`), 1);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_creditos`), 2);
    await as(db, U_MEMBRO);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_buscas`), 0);
    await as(db, U_OUTRA);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_buscas`), 0);
    await as(db, U_MASTER);
    assert.equal(await val(db, `SELECT count(*)::int FROM lista_fria_buscas`), 1);

    await as(db, U_ADMIN);
    await assert.rejects(db.query(`INSERT INTO lista_fria_creditos (organization_id, delta, motivo) VALUES ('${TORQUE}', 999, 'concessao')`), /permission denied/);
    await assert.rejects(db.query(`UPDATE lista_fria_buscas SET creditos_limite = 99999`), /permission denied/);
    await assert.rejects(db.query(`SELECT lista_fria_worker_reivindicar('x')`), /permission denied/);
  } finally { await db.close(); }
});

test('o rollback desfaz tudo e devolve os gatilhos ao corpo anterior', async () => {
  const db = await setup();
  try {
    // Quatro migrations empilhadas: desfaz na ordem inversa (varredura, meta, CNPJ, fundação).
    await db.exec(read(ROLLBACK_POR_CREDITOS));
    await db.exec(read(ROLLBACK_VARREDURA));
    await db.exec(read(ROLLBACK_META));
    await db.exec(read(ROLLBACK_CNPJ));
    await db.exec(read(ROLLBACK));
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_tables WHERE tablename LIKE 'lista_fria_%'`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM information_schema.columns WHERE table_name = 'leads' AND column_name = 'lista_fria_busca_id'`), 0);
    assert.equal(await val(db, `SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'lista_fria_%'`), 0);
    assert.equal(await val(db, `SELECT feature_flags ? 'lista_fria' FROM organizations WHERE id = '${TORQUE}'`), false);
    assert.equal(await val(db, `SELECT count(*)::int FROM feature_permissions WHERE key LIKE 'lista_fria.%'`), 0);
    assert.equal(await val(db, `SELECT prosrc LIKE '%lista_fria%' FROM pg_proc WHERE proname = 'trigger_workflow_lead_created'`), false);
    assert.equal(await val(db, `SELECT prosrc LIKE '%lista_fria%' FROM pg_proc WHERE proname = 'enqueue_lead_webhooks'`), false);
  } finally { await db.close(); }
});
