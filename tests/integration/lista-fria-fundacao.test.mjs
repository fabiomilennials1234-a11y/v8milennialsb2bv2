// Lista Fria · entrega 1 — lógica das RPCs num Postgres real (PGlite).
//
// Aplica a migration 20271217000000 de verdade sobre a mesma fixture mínima da
// Cobrança (helpers de identidade/permissão replicados de prod) mais o que a
// Lista Fria toca em `leads`: coluna de telefone normalizado, índice único,
// gatilho de lead criado e webhook de saída, nos corpos de ANTES da migration.
//
// Cobre a LÓGICA: flag, permissão, créditos (reserva, cobrança, devolução, uma
// vez só), worker, importação como lead de seção (sem funil, sem gatilho, sem
// webhook, sem duplicar) e a guarda da marca. A fidelidade de GRANT/RLS do banco
// real é do pgTAP (supabase/tests/lista_fria_fundacao_test.sql).
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
const U_MASTER = id(4);
const U_OUTRA = id(5);
const TM_ADMIN = id(11);
const TM_MEMBRO = id(12);
const TM_LIBERADO = id(13);
const TM_OUTRA = id(15);

const MIGRATION = '../../supabase/migrations/20271217000000_lista_fria_fundacao.sql';
const ROLLBACK = '../../supabase/migrations/rollback/20271217000000_lista_fria_fundacao.sql';

// O que a Lista Fria toca em `leads` e nos gatilhos de lead criado. Os corpos
// das funções são os de PRODUÇÃO antes da migration — os mesmos que o rollback
// restaura, por isso saem dele.
function fixtureDeLeads() {
  const rollback = read(ROLLBACK);
  const funcoesAntes = rollback.slice(
    rollback.indexOf('CREATE OR REPLACE FUNCTION public.trigger_workflow_lead_created'),
    rollback.indexOf('DROP TRIGGER IF EXISTS'),
  );
  return `
    ALTER TABLE public.leads
      ADD COLUMN name text NOT NULL,
      ADD COLUMN phone text,
      ADD COLUMN email text,
      ADD COLUMN company text,
      ADD COLUMN segment text,
      ADD COLUMN origin text,
      ADD COLUMN notes text,
      ADD COLUMN excluded_from_metrics boolean NOT NULL DEFAULT false,
      ADD COLUMN normalized_phone text,
      ADD COLUMN deleted_at timestamptz,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

    -- Igual à de prod: tira o 55 se vier com 12+ dígitos e põe o 9 em número de 10.
    CREATE FUNCTION public.normalize_brazilian_phone(p text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE AS $f$
    DECLARE d text := regexp_replace(COALESCE(p, ''), '\\D', '', 'g');
    BEGIN
      IF d = '' THEN RETURN NULL; END IF;
      IF length(d) >= 12 AND left(d, 2) = '55' THEN d := substr(d, 3); END IF;
      IF length(d) = 10 THEN d := left(d, 2) || '9' || substr(d, 3); END IF;
      RETURN d;
    END $f$;
    CREATE FUNCTION public.trg_normalize_phone() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN NEW.normalized_phone := public.normalize_brazilian_phone(NEW.phone); RETURN NEW; END $f$;
    CREATE TRIGGER leads_normalize_phone_trigger BEFORE INSERT OR UPDATE OF phone ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_phone();
    CREATE UNIQUE INDEX idx_leads_org_phone_unique ON public.leads (organization_id, normalized_phone)
      WHERE deleted_at IS NULL;

    CREATE TABLE public.lead_origins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid, name text NOT NULL, slug text NOT NULL,
      color text, is_active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE public.webhooks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL, url text, events text[] NOT NULL, is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.webhook_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      webhook_id uuid, event text, payload jsonb, next_retry_at timestamptz
    );

    CREATE TABLE public.workflow_disparos (organization_id uuid, gatilho text, lead_id uuid);
    CREATE FUNCTION public.fire_workflow_trigger(p_org uuid, p_gatilho text, p_lead uuid, p_payload jsonb)
    RETURNS void LANGUAGE sql AS $f$
      INSERT INTO public.workflow_disparos VALUES (p_org, p_gatilho, p_lead);
    $f$;

    ${funcoesAntes}

    CREATE TRIGGER trg_workflow_lead_created AFTER INSERT ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.trigger_workflow_lead_created();
    CREATE TRIGGER trg_enqueue_lead_webhooks AFTER INSERT OR UPDATE ON public.leads
      FOR EACH ROW EXECUTE FUNCTION public.enqueue_lead_webhooks();
  `;
}

async function setup() {
  const db = new PGlite();
  await db.exec(read('./fixtures/cobranca-baseline.sql'));
  // Em prod o service_role tem BYPASSRLS; sem isso a RLS esconderia as linhas do worker.
  await db.exec(`ALTER ROLE service_role BYPASSRLS`);
  await db.exec(fixtureDeLeads());
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${TORQUE}', 'TorqueCRM', 'torquecrm'),
      ('${OUTRA}', 'Outra', 'outra');
    INSERT INTO team_members (id, organization_id, user_id, name, role) VALUES
      ('${TM_ADMIN}', '${TORQUE}', '${U_ADMIN}', 'Admin', 'admin'),
      ('${TM_MEMBRO}', '${TORQUE}', '${U_MEMBRO}', 'Membro', 'member'),
      ('${TM_LIBERADO}', '${TORQUE}', '${U_LIBERADO}', 'Operadora', 'member'),
      ('${TM_OUTRA}', '${OUTRA}', '${U_OUTRA}', 'Admin Outra', 'admin');
    INSERT INTO master_users (user_id) VALUES ('${U_MASTER}');
    -- Um webhook ativo na TorqueCRM: lead frio não pode virar evento de saída.
    INSERT INTO webhooks (organization_id, url, events) VALUES ('${TORQUE}', 'https://example.invalid/h', ARRAY['lead.created']);
  `);
  await db.exec(read(MIGRATION));
  await db.exec(`
    INSERT INTO member_feature_permissions (team_member_id, feature_key, enabled) VALUES
      ('${TM_LIBERADO}', 'lista_fria.view', true),
      ('${TM_LIBERADO}', 'lista_fria.edit', true);
  `);
  return db;
}

async function as(db, uid) {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET test.role = 'authenticated'; SET ROLE authenticated;`);
}
async function asWorker(db) {
  await db.exec(`RESET ROLE; SET test.uid = ''; SET test.role = 'service_role'; SET ROLE service_role;`);
}
async function asPostgres(db) {
  await db.exec(`RESET ROLE; SET test.uid = ''; SET test.role = 'service_role';`);
}
const one = async (db, sql) => (await db.query(sql)).rows[0];
const val = async (db, sql) => Object.values(await one(db, sql))[0];
const json = (o) => JSON.stringify(o).replace(/'/g, "''");

const maps = { nicho: 'Dentistas', cidade: 'São Paulo - SP' };
const criarBusca = (db, fonte, params, creditos, org = TORQUE) =>
  val(db, `SELECT lista_fria_busca_criar('${org}', '${fonte}', '${json(params)}'::jsonb, ${creditos})`);
const item = (ref, extra = {}) => ({ ref_externa: ref, nome: `Negócio ${ref}`, ...extra });
const registrar = (db, busca, worker, itens) =>
  val(db, `SELECT lista_fria_worker_registrar('${busca}', '${worker}', '${json(itens)}'::jsonb)`);

async function comSaldo(db, qtd) {
  await as(db, U_MASTER);
  await db.query(`SELECT lista_fria_creditos_conceder('${TORQUE}', ${qtd}, 'teste')`);
}

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

    await as(db, U_LIBERADO);
    await assert.rejects(criarBusca(db, 'maps', maps, 500), /Saldo de créditos insuficiente/);
    await assert.rejects(criarBusca(db, 'maps', maps, 0), /1 a 100\.000/);
    await assert.rejects(criarBusca(db, 'maps', { nicho: 'x', cidade: 'SP' }, 10), /nicho e a cidade/);
    await assert.rejects(criarBusca(db, 'instagram', { url: 'https://www.instagram.com/p/abc123/' }, 10), /URL de uma conta/);
    await assert.rejects(criarBusca(db, 'twitter', {}, 10), /Fonte inválida/);

    const ig = await criarBusca(db, 'instagram', { url: '@Clinica.Odonto_Vida?hl=pt' }, 30);
    assert.equal(await val(db, `SELECT instagram_handle FROM lista_fria_buscas WHERE id = '${ig}'`), 'clinica.odonto_vida');
    const mp = await criarBusca(db, 'maps', maps, 20);
    assert.equal(await val(db, `SELECT lista_fria_saldo('${TORQUE}')`), 50, 'reserva de 30 + 20 sai do saldo');
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
    assert.deepEqual(a, { importados: 2, ja_eram_leads: 0, restantes: 3 });
    const c = (await one(db, `SELECT lista_fria_importar('${b}', 2) AS r`)).r;
    assert.equal(c.importados + c.ja_eram_leads, 2);
    assert.equal(c.restantes, 1);
    const d = (await one(db, `SELECT lista_fria_importar('${b}', 2) AS r`)).r;
    assert.equal(d.restantes, 0);
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
