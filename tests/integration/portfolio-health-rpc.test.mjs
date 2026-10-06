/**
 * portfolio_health_inputs / portfolio_health_apply num Postgres de verdade
 * (PGlite), sobre o esqueleto de prod em fixtures/portfolio-health-baseline.sql.
 *
 * Prova:
 *   - isolamento por org nas duas RPCs (inputs não vaza, apply fail-closed);
 *   - pedido pending ignorado, só-outgoing → last_incoming_at nulo;
 *   - keyset em 2 páginas sem perda nem duplicata;
 *   - idempotência: 2º apply não escreve nada;
 *   - resolve/insere alerta por tipo;
 *   - grants: só service_role executa (com o default ACL de prod);
 *   - equivalência: os selects antigos da edge function (index.ts:101-130) e
 *     o inputs novo alimentam computeClientHealth com o mesmo resultado;
 *   - cron: altera por jobname, job ausente e pg_cron ausente passam.
 *
 * Node 24 importa o .ts do _shared direto (type stripping) — o score testado
 * aqui é o mesmo arquivo que a edge function usa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  applyRowFrom,
  computeClientHealth,
  healthInputFromRow,
  orgAvgTicketFrom,
} from '../../supabase/functions/_shared/portfolio-health.ts';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const MIGRATION = read('../../supabase/migrations/20271107120000_portfolio_health_set_based.sql');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const NOW = new Date('2026-10-05T15:00:00.000Z');
const ago = (d) => new Date(NOW.getTime() - d * 86400000).toISOString();

const ORG_A = id(100);
const ORG_B = id(200);
// Clientes da org A em ordem de id — o keyset pagina por id.
const A1 = id(11), A2 = id(12), A3 = id(13), A_INATIVO = id(14);
const B1 = id(21);
const LEAD = (c) => id(Number(c.slice(-12)) + 500);

async function seed(db) {
  await db.exec(`
    INSERT INTO organizations (id, name, slug, default_reorder_cycle_days) VALUES
      ('${ORG_A}', 'A', 'a', NULL), ('${ORG_B}', 'B', 'b', 20);
    INSERT INTO organization_features (organization_id, feature_key, enabled) VALUES
      ('${ORG_A}', 'portfolio_alerts_whatsapp', true);
    INSERT INTO copilot_agents (organization_id, name, is_active, retention_enabled, retention_config) VALUES
      ('${ORG_B}', 'retencao B', true, true, '{"max_frequency_days": 7}');
    INSERT INTO upsell_clients (id, organization_id, lead_id, name, closer_id, last_order_at, is_active) VALUES
      ('${A1}', '${ORG_A}', '${LEAD(A1)}', 'Cliente A1', '${id(900)}', NULL, true),
      ('${A2}', '${ORG_A}', '${LEAD(A2)}', 'Cliente A2', NULL, NULL, true),
      ('${A3}', '${ORG_A}', '${LEAD(A3)}', 'Cliente A3', NULL, '${ago(50)}', true),
      ('${A_INATIVO}', '${ORG_A}', '${LEAD(A_INATIVO)}', 'Inativo', NULL, NULL, false),
      ('${B1}', '${ORG_B}', '${LEAD(B1)}', 'Cliente B1', NULL, NULL, true);
    -- ids fixos: o empate de sold_at em ago(90) sai por id (Filtro 301 antes de Café 302).
    INSERT INTO upsell_orders (id, organization_id, client_id, product_name, sale_value, sold_at, approval_status) VALUES
      ('${id(300)}', '${ORG_A}', '${A1}', 'Café', 300, '${ago(120)}', 'approved'),
      ('${id(302)}', '${ORG_A}', '${A1}', 'Café', 250, '${ago(90)}', 'approved'),
      ('${id(301)}', '${ORG_A}', '${A1}', 'Filtro', 40.5, '${ago(90)}', 'approved'),
      ('${id(303)}', '${ORG_A}', '${A1}', 'Café', 200, '${ago(60)}', 'approved'),
      ('${id(304)}', '${ORG_A}', '${A1}', 'Café', 150, '${ago(10)}', 'approved'),
      ('${id(305)}', '${ORG_A}', '${A1}', 'Café', 9999, '${ago(1)}', 'pending'),
      ('${id(306)}', '${ORG_A}', '${A2}', 'Café', 80, '${ago(200)}', 'approved'),
      ('${id(307)}', '${ORG_B}', '${B1}', 'Café', 777, '${ago(5)}', 'approved');
    INSERT INTO conversation_context_summary (organization_id, lead_id, engagement_score) VALUES
      ('${ORG_A}', '${LEAD(A1)}', 30);
    INSERT INTO whatsapp_messages (organization_id, lead_id, direction, "timestamp") VALUES
      ('${ORG_A}', '${LEAD(A1)}', 'incoming', '${ago(20)}'),
      ('${ORG_A}', '${LEAD(A1)}', 'incoming', '${ago(12)}'),
      ('${ORG_A}', '${LEAD(A1)}', 'outgoing', '${ago(1)}'),
      ('${ORG_A}', '${LEAD(A2)}', 'outgoing', '${ago(2)}');
  `);
}

const asService = async (db, sql, params) => {
  await db.exec('SET ROLE service_role');
  try { return await db.query(sql, params); } finally { await db.exec('RESET ROLE'); }
};
const inputs = async (db, org, after = null, limit = 500) =>
  (await asService(db, 'SELECT portfolio_health_inputs($1, $2, $3) AS r', [org, after, limit])).rows[0].r;
const apply = async (db, org, results) =>
  (await asService(db, 'SELECT portfolio_health_apply($1, $2, $3) AS r', [org, NOW.toISOString(), JSON.stringify(results)])).rows[0].r;
const count = async (db, sql) => (await db.query(sql)).rows[0].n;

function computePage(page, org) {
  const ctx = {
    orgAvgTicket: orgAvgTicketFrom(org.approved_sum, org.approved_count),
    defaultCycleDays: org.default_reorder_cycle_days ?? undefined,
  };
  return page.clients.map((c) => applyRowFrom(c.id, computeClientHealth(healthInputFromRow(c), ctx, NOW)));
}

async function freshDb() {
  const db = new PGlite();
  await db.exec(read('./fixtures/portfolio-health-baseline.sql'));
  await seed(db);
  await db.exec(MIGRATION);
  return db;
}

test('inputs: só a org pedida, pending fora, só-outgoing sem incoming, inativo fora', async () => {
  const db = await freshDb();
  try {
    const r = await inputs(db, ORG_A);
    assert.deepEqual(r.clients.map((c) => c.id), [A1, A2, A3]);
    assert.deepEqual(r.org, {
      default_reorder_cycle_days: null,
      approved_sum: 1020.5,
      approved_count: 6,
      whatsapp_alerts_enabled: true,
      retention_config: null,
    });
    const a1 = r.clients[0];
    assert.equal(a1.orders.length, 5, 'pending não entra');
    assert.ok(a1.orders.every((o) => o.sale_value !== 9999));
    assert.equal(a1.ctx_engagement, 30);
    assert.deepEqual(Object.keys(a1).sort(), [
      'closer_id', 'ctx_engagement', 'id', 'last_incoming_at', 'last_order_at', 'lead_id', 'name', 'orders',
    ], 'só o que o score consome — alertas abertos o apply relê');
    assert.equal(new Date(a1.last_incoming_at).toISOString(), ago(12));
    // Empate de sold_at sai por id — ordem determinística (antes: ordem do heap).
    assert.deepEqual(a1.orders.map((o) => o.id), [id(300), id(301), id(302), id(303), id(304)]);
    const a2 = r.clients[1];
    assert.equal(a2.last_incoming_at, null, 'só outgoing → nulo');
    assert.equal(a2.ctx_engagement, null);

    const b = await inputs(db, ORG_B);
    assert.deepEqual(b.clients.map((c) => c.id), [B1]);
    assert.deepEqual(b.org.retention_config, { max_frequency_days: 7 });
    assert.equal(b.org.whatsapp_alerts_enabled, false);

    // Mensagem de OUTRA org com o lead de A1 não contamina A1.
    await db.exec(`INSERT INTO whatsapp_messages (organization_id, lead_id, direction, "timestamp")
      VALUES ('${ORG_B}', '${LEAD(A1)}', 'incoming', '${ago(0)}')`);
    const again = await inputs(db, ORG_A);
    assert.equal(new Date(again.clients[0].last_incoming_at).toISOString(), ago(12));

    // Org sem nada: objeto org com defaults (nunca nulo na 1ª página), lista vazia.
    assert.deepEqual(await inputs(db, id(999)), {
      org: {
        default_reorder_cycle_days: null,
        approved_sum: 0,
        approved_count: 0,
        whatsapp_alerts_enabled: false,
        retention_config: null,
      },
      clients: [],
    });

    await assert.rejects(inputs(db, null), /p_org_id obrigatório/);
  } finally { await db.close(); }
});

test('keyset: 2 páginas sem perda nem duplicata; org só na 1ª', async () => {
  const db = await freshDb();
  try {
    const p1 = await inputs(db, ORG_A, null, 2);
    assert.equal(p1.clients.length, 2);
    assert.ok(p1.org);
    const p2 = await inputs(db, ORG_A, p1.clients.at(-1).id, 2);
    assert.equal(p2.org, null);
    assert.equal(p2.clients.length, 1);
    const all = [...p1.clients, ...p2.clients].map((c) => c.id);
    assert.deepEqual(all, [A1, A2, A3]);
    const p3 = await inputs(db, ORG_A, p2.clients.at(-1).id, 2);
    assert.deepEqual(p3.clients, []);
  } finally { await db.close(); }
});

test('apply: fail-closed em cliente de outra org, nulo ou repetido — sem escrita', async () => {
  const db = await freshDb();
  try {
    const page = await inputs(db, ORG_A);
    const rows = computePage(page, page.org);
    const bRow = { ...rows[0], client_id: B1 };
    await assert.rejects(apply(db, ORG_A, [...rows, bRow]), /fora da organização/);
    await assert.rejects(apply(db, ORG_A, [rows[0], rows[0]]), /fora da organização, nulo ou repetido/);
    await assert.rejects(apply(db, ORG_A, [{ ...rows[0], client_id: null }]), /fora da organização/);
    await assert.rejects(apply(db, ORG_A, { not: 'array' }), /precisa ser um array/);
    // Cliente de A, mas aplicado como org B.
    await assert.rejects(apply(db, ORG_B, [rows[0]]), /fora da organização/);

    assert.equal(await count(db, 'SELECT count(*)::int n FROM client_health_snapshots'), 0);
    assert.equal(await count(db, 'SELECT count(*)::int n FROM client_alerts'), 0);
    assert.equal(await count(db, 'SELECT count(*)::int n FROM upsell_clients WHERE health_updated_at IS NOT NULL'), 0);
  } finally { await db.close(); }
});

test('apply: grava, é idempotente e resolve/insere alerta por tipo', async () => {
  const db = await freshDb();
  try {
    const page = await inputs(db, ORG_A);
    const rows = computePage(page, page.org);
    const a1 = rows.find((r) => r.client_id === A1);
    const a1Types = a1.signals.map((s) => s.alert_type);
    assert.ok(a1Types.length > 0, 'cenário precisa de sinal em A1');

    // Pré-estado: A1 tem um alerta aberto de um tipo que NÃO dispara mais (2×,
    // duplicata histórica) e um do tipo que dispara (não pode duplicar).
    const stale = ['ticket_declining', 'nps_low'].find((t) => !a1Types.includes(t));
    await db.exec(`INSERT INTO client_alerts (organization_id, client_id, alert_type, severity, title) VALUES
      ('${ORG_A}', '${A1}', '${stale}', 'warning', 'velho 1'),
      ('${ORG_A}', '${A1}', '${stale}', 'warning', 'velho 2'),
      ('${ORG_A}', '${A1}', '${a1Types[0]}', 'warning', 'já aberto'),
      ('${ORG_B}', '${B1}', '${stale}', 'warning', 'outra org')`);

    const first = await apply(db, ORG_A, rows);
    assert.equal(first.updated, 3);
    assert.equal(first.snapshots, 3);
    assert.equal(first.resolved, 2, 'as duas duplicatas do tipo velho');
    const expectedNew = rows.flatMap((r) => r.signals
      .map((s, i) => ({ client_id: r.client_id, alert_type: s.alert_type, signal_index: i }))
      .filter((s) => !(s.client_id === A1 && s.alert_type === a1Types[0])));
    assert.deepEqual(
      first.inserted.map(({ client_id, alert_type, signal_index }) => ({ client_id, alert_type, signal_index })),
      expectedNew,
    );
    for (const ins of first.inserted) {
      const row = (await db.query('SELECT organization_id, metadata, severity FROM client_alerts WHERE id = $1', [ins.id])).rows[0];
      assert.equal(row.organization_id, ORG_A);
      assert.deepEqual(ins.metadata, row.metadata);
      assert.equal(ins.severity, row.severity);
    }
    assert.equal(await count(db, `SELECT count(*)::int n FROM client_alerts WHERE client_id='${A1}' AND alert_type='${a1Types[0]}' AND is_resolved=false`), 1);
    assert.equal(await count(db, `SELECT count(*)::int n FROM client_alerts WHERE organization_id='${ORG_B}' AND is_resolved=false`), 1, 'outra org intocada');

    const persisted = (await db.query(`SELECT health_score, segment, order_count, lifetime_value::float8 AS lv, avg_ticket::float8 AS at,
      health_updated_at FROM upsell_clients WHERE id='${A1}'`)).rows[0];
    assert.equal(persisted.health_score, a1.health_score);
    assert.equal(persisted.segment, a1.segment);
    assert.equal(persisted.order_count, 5);
    assert.equal(persisted.lv, a1.lifetime_value);
    assert.equal(persisted.at, a1.avg_ticket);
    assert.equal(new Date(persisted.health_updated_at).toISOString(), NOW.toISOString());

    const snap = (await db.query(`SELECT snapshot_date::text d, organization_id FROM client_health_snapshots WHERE client_id='${A1}'`)).rows;
    assert.deepEqual(snap, [{ d: '2026-10-05', organization_id: ORG_A }]);

    const updatedAt = (await db.query(`SELECT id, updated_at FROM upsell_clients ORDER BY id`)).rows;
    const alertsBefore = await count(db, 'SELECT count(*)::int n FROM client_alerts');

    // Recomputa do banco (agora com last_order_at gravado) e reaplica.
    const page2 = await inputs(db, ORG_A);
    const rows2 = computePage(page2, page2.org);
    assert.deepEqual(rows2, rows, 'gravar não muda a entrada do próximo cálculo');
    const second = await apply(db, ORG_A, rows2);
    assert.deepEqual(second, { updated: 0, snapshots: 0, resolved: 0, inserted: [] });
    assert.deepEqual((await db.query(`SELECT id, updated_at FROM upsell_clients ORDER BY id`)).rows, updatedAt);
    assert.equal(await count(db, 'SELECT count(*)::int n FROM client_alerts'), alertsBefore);

    // Um campo muda → só aquela linha é atualizada; snapshot do dia acompanha.
    const changed = rows2.map((r) => (r.client_id === A2 ? { ...r, health_score: r.health_score - 1 } : r));
    const third = await apply(db, ORG_A, changed);
    assert.equal(third.updated, 1);
    assert.equal(third.snapshots, 1);
  } finally { await db.close(); }
});

test('grants: só service_role executa, mesmo com o default ACL de prod', async () => {
  const db = await freshDb();
  try {
    const sigs = ['portfolio_health_inputs(uuid,uuid,integer)', 'portfolio_health_apply(uuid,timestamp with time zone,jsonb)'];
    for (const fn of sigs) {
      for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true], ['public', false]]) {
        const allowed = role === 'public'
          ? (await db.query(`SELECT bool_or(a.grantee = 0) AS allowed FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = '${fn}'::regprocedure AND a.privilege_type = 'EXECUTE'`)).rows[0].allowed ?? false
          : (await db.query(`SELECT has_function_privilege('${role}', '${fn}', 'EXECUTE') AS allowed`)).rows[0].allowed;
        assert.equal(allowed, expected, `${role} em ${fn}`);
      }
    }
    // Controle positivo: sem o REVOKE, o default ACL teria dado EXECUTE.
    await db.exec(`CREATE FUNCTION public.controle_default_acl() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', 'controle_default_acl()', 'EXECUTE') AS a`)).rows[0].a, true);

    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.query(`SELECT portfolio_health_inputs('${ORG_A}')`), /permission denied/);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('equivalência: selects antigos da edge function × portfolio_health_inputs', async () => {
  const db = await freshDb();
  try {
    const page = await inputs(db, ORG_A);
    const orgCycle = page.org.default_reorder_cycle_days ?? undefined;

    // Caminho antigo, como o PostgREST entregava (numeric → number, timestamptz → string).
    // O select antigo ordenava só por sold_at: em empate a ordem era a do heap,
    // indefinida. O desempate por id (o do inputs) é a única ordem comparável —
    // é o risco aceito "empate de sold_at" do plano.
    const legacyValues = (await db.query(`SELECT sale_value FROM upsell_orders
      WHERE organization_id = $1 AND approval_status = 'approved'`, [ORG_A])).rows.map((r) => Number(r.sale_value));
    const legacyOrgAvg = legacyValues.length ? legacyValues.reduce((s, v) => s + v, 0) / legacyValues.length : 0;
    assert.ok(Math.abs(legacyOrgAvg - orgAvgTicketFrom(page.org.approved_sum, page.org.approved_count)) < 1e-9);

    const clients = (await db.query(`SELECT id, lead_id, last_order_at FROM upsell_clients
      WHERE organization_id = $1 AND is_active = true`, [ORG_A])).rows;
    assert.equal(clients.length, page.clients.length);

    for (const c of clients) {
      const orders = (await db.query(`SELECT id, sale_value, sold_at, product_name FROM upsell_orders
        WHERE client_id = $1 AND approval_status = 'approved' ORDER BY sold_at ASC, id`, [c.id])).rows
        .map((o) => ({ id: o.id, sale_value: Number(o.sale_value), sold_at: o.sold_at.toISOString(), product_name: o.product_name }));
      const ctx = (await db.query(`SELECT engagement_score FROM conversation_context_summary WHERE lead_id = $1`, [c.lead_id])).rows[0];
      const last = (await db.query(`SELECT "timestamp" FROM whatsapp_messages WHERE lead_id = $1 AND direction = 'incoming'
        ORDER BY "timestamp" DESC LIMIT 1`, [c.lead_id])).rows[0];
      const legacy = computeClientHealth({
        leadId: c.lead_id,
        lastOrderAtStored: c.last_order_at ? c.last_order_at.toISOString() : null,
        orders,
        ctxEngagement: ctx?.engagement_score ?? null,
        lastIncomingAt: last ? last.timestamp.toISOString() : null,
      }, { orgAvgTicket: legacyOrgAvg, defaultCycleDays: orgCycle }, NOW);

      const row = page.clients.find((p) => p.id === c.id);
      const novo = computeClientHealth(healthInputFromRow(row), {
        orgAvgTicket: orgAvgTicketFrom(page.org.approved_sum, page.org.approved_count),
        defaultCycleDays: orgCycle,
      }, NOW);
      assert.deepEqual(novo, legacy, `cliente ${c.id}`);

    }
  } finally { await db.close(); }
});

test('migration: reaplicável; cron por jobname, ausente passa', async () => {
  const db = await freshDb();
  try {
    // pg_cron ausente já foi exercitado no freshDb (NOTICE, sem erro). Agora com cron.
    await db.exec(`
      CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid bigint PRIMARY KEY, jobname text, schedule text);
      CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL) RETURNS void
        LANGUAGE sql AS $$ UPDATE cron.job SET schedule = alter_job.schedule WHERE jobid = alter_job.job_id $$;
      INSERT INTO cron.job VALUES (65, 'calculate-portfolio-health', '21-59/30 * * * *'), (66, 'outro', '*/5 * * * *');
    `);
    await db.exec(MIGRATION);
    const jobs = (await db.query('SELECT jobname, schedule FROM cron.job ORDER BY jobid')).rows;
    assert.deepEqual(jobs, [
      { jobname: 'calculate-portfolio-health', schedule: '21 6,11-23/2 * * *' },
      { jobname: 'outro', schedule: '*/5 * * * *' },
    ]);
    await db.exec(`DELETE FROM cron.job WHERE jobid = 65`);
    await db.exec(MIGRATION); // job ausente: sem erro
    // Reaplicar não reabre grant.
    assert.equal((await db.query(`SELECT has_function_privilege('authenticated', 'portfolio_health_apply(uuid,timestamptz,jsonb)', 'EXECUTE') AS a`)).rows[0].a, false);
  } finally { await db.close(); }
});
