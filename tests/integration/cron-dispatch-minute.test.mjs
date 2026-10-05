// PGlite (Postgres em memória): sem Docker, sem Supabase local, sem prod.
// Cobre M1 (rate_limits UNLOGGED + janela fixa + REVOKE), M2 (gates 59/107)
// e M3 (cron_dispatch_minute) com rollback/reaplicação.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const M1 = '20271107140000_rate_limits_unlogged_janela_fixa.sql';
const M2 = '20271107140001_cron_gate_workflow_billing.sql';
const M3 = '20271107140002_cron_dispatch_minute.sql';
const mig = (f) => read(`supabase/migrations/${f}`);
const rb = (f) => read(`supabase/migrations/rollback/${f}`);

const ANTIGOS = ['voip-reap-authorized', 'voip-sweep-stuck-calls', 'copilot-queue-sweep',
  'copilot_v2_worker', 'process-ai-actions', 'process-workflow-executions',
  'workflow-cron-triggers', 'campaign-rule-dispatch', 'pipe-rule-dispatch',
  'process-scheduled-user-messages', 'history-sync-worker', 'omie-sync-dispatch',
  'process-blast-recipients', 'send-push', 'oraculo-feedback-alerts',
  'mass-send-status-poll', 'whatsapp_media_retry', 'infra-watchdog', 'billing-provision-worker'];

const TODO_MINUTO = ['sweep_copilot_queue', 'invoke_copilot_v2_worker', 'invoke_process_ai_actions',
  'invoke_workflow_cron_triggers', 'invoke_campaign_rule_dispatch', 'invoke_pipe_rule_dispatch',
  'invoke_process_scheduled_user_messages', 'invoke_history_sync_worker', 'invoke_omie_sync_dispatch',
  'invoke_process_blast_recipients', 'invoke_send_push', 'invoke_oraculo_feedback_worker:alerts'];

/** Corpo de prod de check_rate_limit (do rollback) com outro nome, para comparar lado a lado. */
function legacyRateLimit() {
  const body = rb(M1).match(/CREATE OR REPLACE FUNCTION public\.check_rate_limit\([\s\S]*?\$function\$;/)[0];
  return body.replace('FUNCTION public.check_rate_limit(', 'FUNCTION public.check_rate_limit_legacy(');
}

async function fresh({ comCron = true } = {}) {
  const db = new PGlite();
  await db.exec(read('tests/fixtures/cron-dispatch-minute-schema.sql'));
  if (!comCron) await db.exec('DROP SCHEMA cron CASCADE');
  // Baseline = prod antes do apply: corpo antigo + furo do GRANT a authenticated.
  await db.exec(rb(M1));
  await db.exec('GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO authenticated');
  await db.exec(rb(M2));
  return db;
}

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const all = async (db, sql, params) => (await db.query(sql, params)).rows;
const priv = (db, sig) => one(db, `SELECT
  has_function_privilege('anon', $1, 'EXECUTE') anon,
  has_function_privilege('authenticated', $1, 'EXECUTE') authenticated,
  has_function_privilege('service_role', $1, 'EXECUTE') service`, [sig]);

async function httpCalls(db, call) {
  await db.exec('TRUNCATE public.fixture_http_calls');
  await db.exec(`SELECT public.${call}`);
  return all(db, 'SELECT * FROM public.fixture_http_calls');
}

test('M1 — rate_limits: REVOKE, janela fixa, 60 s inalterado, UNLOGGED, purga, idempotência', async () => {
  const db = await fresh();
  try {
    // Baseline reproduz o furo e o bug.
    assert.deepEqual(await priv(db, 'public.check_rate_limit(text,integer,integer)'),
      { anon: false, authenticated: true, service: true });
    await db.exec(legacyRateLimit());

    await db.exec(mig(M1));

    // Segurança (bloqueante): só service_role executa.
    assert.deepEqual(await priv(db, 'public.check_rate_limit(text,integer,integer)'),
      { anon: false, authenticated: false, service: true });
    assert.deepEqual(await priv(db, 'public.purge_rate_limits()'),
      { anon: false, authenticated: false, service: true });

    // Catálogo: UNLOGGED, RLS mantida, índice duplicado fora, UNIQUE fica.
    assert.equal((await one(db, "SELECT relpersistence FROM pg_class WHERE oid='public.rate_limits'::regclass")).relpersistence, 'u');
    assert.equal((await one(db, "SELECT relrowsecurity FROM pg_class WHERE oid='public.rate_limits'::regclass")).relrowsecurity, true);
    const idx = (await all(db, "SELECT indexname FROM pg_indexes WHERE tablename='rate_limits' ORDER BY 1")).map((r) => r.indexname);
    assert.deepEqual(idx, ['rate_limits_key_window_start_key', 'rate_limits_pkey']);
    const cfg = await one(db, "SELECT proconfig, prosecdef FROM pg_proc WHERE oid='public.check_rate_limit(text,integer,integer)'::regprocedure");
    assert.deepEqual(cfg, { proconfig: ['search_path=""'], prosecdef: true });

    // 60 s: mesma chave de janela e mesmo reset_at que o corpo de prod, em
    // qualquer TimeZone de sessão (inclusive offset de 45 min).
    for (const tz of ['UTC', 'America/Sao_Paulo', 'Asia/Kathmandu']) {
      await db.exec(`SET TimeZone = '${tz}'`);
      await db.exec('BEGIN');
      const novo = await one(db, "SELECT * FROM public.check_rate_limit('eq:new:' || $1, 100, 60)", [tz]);
      const velho = await one(db, "SELECT * FROM public.check_rate_limit_legacy('eq:old:' || $1, 100, 60)", [tz]);
      const ws = await all(db, "SELECT key, window_start, window_seconds FROM public.rate_limits WHERE key LIKE 'eq:%:' || $1 ORDER BY key", [tz]);
      const ancorado = await one(db, 'SELECT to_timestamp(floor(extract(epoch FROM now()) / 60) * 60) AS t');
      await db.exec('COMMIT');
      assert.equal(ws.length, 2);
      assert.equal(ws[0].window_start.getTime(), ws[1].window_start.getTime(), `window_start 60 s (${tz})`);
      assert.equal(ws[0].window_start.getTime(), ancorado.t.getTime(), `60 s alinhado ao minuto (${tz})`);
      assert.equal(novo.reset_at.getTime(), velho.reset_at.getTime(), `reset_at 60 s (${tz})`);
      assert.deepEqual([novo.allowed, novo.remaining], [velho.allowed, velho.remaining]);
    }
    await db.exec("SET TimeZone = 'UTC'");

    // Contador incrementa e o teto se aplica.
    const seq = [];
    for (let i = 0; i < 3; i++) seq.push(await one(db, "SELECT allowed, remaining FROM public.check_rate_limit('cnt', 2, 60)"));
    assert.deepEqual(seq, [{ allowed: true, remaining: 1 }, { allowed: true, remaining: 0 }, { allowed: false, remaining: 0 }]);

    // 86400: o corpo de prod (deslizante) nunca aplicava o limite...
    const v1 = await one(db, "SELECT allowed FROM public.check_rate_limit_legacy('portfolio_alert:legacy', 1, 86400)");
    // O relógio do PGlite (wasm) tem resolução grossa: sem folga, duas chamadas
    // seguidas podem ver o mesmo now() e mascarar a janela deslizante.
    await new Promise((r) => setTimeout(r, 25));
    const v2 = await one(db, "SELECT allowed FROM public.check_rate_limit_legacy('portfolio_alert:legacy', 1, 86400)");
    assert.deepEqual([v1.allowed, v2.allowed], [true, true], 'bug reproduzido: 1/dia nunca aplicado');
    assert.equal((await one(db, "SELECT count(*)::int n FROM public.rate_limits WHERE key='portfolio_alert:legacy'")).n, 2);
    // ...a janela fixa agrupa no mesmo dia UTC e aplica 1/dia.
    const d1 = await one(db, "SELECT * FROM public.check_rate_limit('portfolio_alert:x', 1, 86400)");
    const d2 = await one(db, "SELECT * FROM public.check_rate_limit('portfolio_alert:x', 1, 86400)");
    assert.equal(d1.allowed, true);
    assert.equal(d2.allowed, false, '2ª chamada no mesmo dia é recusada');
    const dia = await all(db, "SELECT window_start, request_count FROM public.rate_limits WHERE key='portfolio_alert:x'");
    assert.equal(dia.length, 1);
    assert.equal(dia[0].request_count, 2);
    assert.equal(dia[0].window_start.getTime() % 86_400_000, 0, 'janela diária começa 00:00 UTC');
    assert.equal(d1.reset_at.getTime() - dia[0].window_start.getTime(), 86_400_000);
    // 3600: hora cheia.
    await one(db, "SELECT * FROM public.check_rate_limit('h', 5, 3600)");
    assert.equal((await one(db, "SELECT window_start FROM public.rate_limits WHERE key='h'")).window_start.getTime() % 3_600_000, 0);

    // Janela inválida é recusada com 22023 (antes: NOT NULL / janela no futuro).
    for (const w of ['0', '-5', 'NULL']) {
      await assert.rejects(db.query(`SELECT * FROM public.check_rate_limit('bad', 1, ${w})`), (e) => e.code === '22023', `janela ${w}`);
    }

    // Purga respeita janela aberta (inclusive a diária) e apaga encerrada.
    await db.exec(`TRUNCATE public.rate_limits;
      INSERT INTO public.rate_limits (key, window_start, window_seconds) VALUES
        ('m-velha', date_trunc('minute', now()) - interval '2 hours', 60),
        ('m-atual', date_trunc('minute', now()), 60),
        ('m-recem', date_trunc('minute', now()) - interval '1 minute', 60),
        ('d-aberta', now() - interval '2 hours', 86400),
        ('d-velha', now() - interval '25 hours', 86400)`);
    assert.equal((await one(db, 'SELECT public.purge_rate_limits() n')).n, 2);
    assert.deepEqual((await all(db, 'SELECT key FROM public.rate_limits ORDER BY key')).map((r) => r.key),
      ['d-aberta', 'm-atual', 'm-recem']);

    // Reaplicação idempotente; rollback volta a LOGGED + índice; reaplica de novo.
    await db.exec(mig(M1));
    assert.equal((await one(db, "SELECT relpersistence FROM pg_class WHERE oid='public.rate_limits'::regclass")).relpersistence, 'u');
    await db.exec(rb(M1));
    assert.equal((await one(db, "SELECT relpersistence FROM pg_class WHERE oid='public.rate_limits'::regclass")).relpersistence, 'p');
    assert.equal((await one(db, "SELECT count(*)::int n FROM pg_indexes WHERE indexname='idx_rate_limits_key_window'")).n, 1);
    assert.deepEqual(await priv(db, 'public.check_rate_limit(text,integer,integer)'),
      { anon: false, authenticated: false, service: true }, 'rollback NÃO reabre o furo');
    assert.equal((await one(db, "SELECT to_regprocedure('public.purge_rate_limits()') IS NULL AS gone")).gone, true);
    await db.exec(mig(M1));
    assert.equal((await one(db, "SELECT relpersistence FROM pg_class WHERE oid='public.rate_limits'::regclass")).relpersistence, 'u');
  } finally { await db.close(); }
});

test('M2 — gate 59 por ramo (positivo e negativo), sem mutação, payload intacto', async () => {
  const db = await fresh();
  const call = 'invoke_process_workflow_executions()';
  const expectCalls = async (n, msg) => assert.equal((await httpCalls(db, call)).length, n, msg);
  const reset = () => db.exec('TRUNCATE public.workflow_executions, public.workflow_button_questions, public.workflow_button_ingress');
  try {
    await expectCalls(1, 'baseline de prod dispara com tudo vazio');
    await db.exec(mig(M2));
    await expectCalls(0, 'gate: tudo vazio não dispara');
    assert.deepEqual(await priv(db, `public.${call}`), { anon: false, authenticated: false, service: true });

    // (i) claim_workflow_executions
    for (const [row, n] of [
      ["('running', NULL, now())", 1],
      ["('running', now() - interval '1 second', now())", 1],
      ["('running', now() + interval '1 hour', now())", 0],
      ["('processing', NULL, now() - interval '11 minutes')", 1],
      ["('processing', NULL, now() - interval '5 minutes')", 0],
      ["('waiting_response', now() - interval '1 second', now())", 1],
      ["('waiting_response', NULL, now())", 0],
      ["('waiting_response', now() + interval '1 hour', now())", 0],
      ["('completed', NULL, now() - interval '1 day')", 0],
      ["('paused', NULL, now() - interval '1 day')", 0],
    ]) {
      await reset();
      await db.exec(`INSERT INTO public.workflow_executions (status, next_run_at, updated_at) VALUES ${row}`);
      const before = await all(db, 'SELECT * FROM public.workflow_executions');
      await expectCalls(n, `(i) ${row}`);
      assert.deepEqual(await all(db, 'SELECT * FROM public.workflow_executions'), before, 'probe não reivindica');
    }
    const [http] = (await (async () => { await reset(); await db.exec("INSERT INTO public.workflow_executions (status) VALUES ('running')"); return httpCalls(db, call); })());
    assert.equal(http.url, 'https://fixture.invalid/functions/v1/process-workflow-executions');
    assert.equal(http.headers['x-cron-secret'], 'fixture-secret');
    assert.deepEqual(http.body, {});

    const exec = async (status, node = 'n1') => (await one(db,
      'INSERT INTO public.workflow_executions (status, current_node_id) VALUES ($1, $2) RETURNING id', [status, node])).id;
    const question = async (execId, cols, vals) => (await one(db,
      `INSERT INTO public.workflow_button_questions (execution_id, ${cols}) VALUES ($1, ${vals}) RETURNING id`, [execId])).id;

    // (ii) fila de perguntas
    await reset(); await question(await exec('paused'), 'state', "'queued'"); await expectCalls(1, '(ii) queued + paused no nó');
    await reset(); await question(await exec('paused', 'outro'), 'state', "'queued'"); await expectCalls(0, '(ii) nó diferente');
    await reset(); await question(await exec('completed'), 'state', "'queued'"); await expectCalls(0, '(ii) execução terminada');

    // (iii) checagem de envio incerto
    const iii = "state, send_check_count, send_started_at, next_send_check_at";
    await reset(); await question(await exec('paused'), iii, "'sending', 0, now() - interval '3 minutes', NULL"); await expectCalls(1, '(iii) sending vencido');
    await reset(); await question(await exec('paused'), iii, "'uncertain', 3, now() - interval '30 minutes', now() - interval '1 second'"); await expectCalls(1, '(iii) uncertain check vencido');
    await reset(); await question(await exec('paused'), iii, "'sending', 0, now() - interval '1 minute', NULL"); await expectCalls(0, '(iii) < 2 min');
    await reset(); await question(await exec('paused'), iii, "'uncertain', 12, now() - interval '1 hour', NULL"); await expectCalls(0, '(iii) 12 checks esgotados');
    await reset(); await question(await exec('paused'), iii, "'uncertain', 1, now() - interval '1 hour', now() + interval '5 minutes'"); await expectCalls(0, '(iii) check futuro');

    // (iv) reconciliação de respostas
    await reset(); await question(await exec('paused'), 'state, deadline_at', "'waiting', now() - interval '1 second'"); await expectCalls(1, '(iv) prazo vencido');
    await reset(); await question(await exec('paused'), 'state, deadline_at', "'waiting', now() + interval '1 hour'"); await expectCalls(0, '(iv) prazo futuro sem ingress NÃO dispara');
    await reset();
    let q = await question(await exec('paused'), 'state, deadline_at', "'waiting', now() + interval '1 hour'");
    await db.query("INSERT INTO public.workflow_button_ingress (question_id, received_at) VALUES ($1, now())", [q]);
    await expectCalls(1, '(iv) ingress antes do prazo');
    await reset();
    q = await question(await exec('paused'), 'state, deadline_at', "'waiting', now() + interval '1 hour'");
    await db.query("INSERT INTO public.workflow_button_ingress (question_id, received_at) VALUES ($1, now() + interval '2 hours')", [q]);
    await expectCalls(0, '(iv) ingress depois do prazo');
    await reset(); await question(await exec('completed'), 'state, deadline_at', "'waiting', now() - interval '1 second'"); await expectCalls(0, '(iv) execução não pausada');
    await reset();

    // Rollback volta a disparar com tudo vazio; reaplicar fecha de novo.
    await db.exec(rb(M2)); await expectCalls(1, 'rollback');
    await db.exec(mig(M2)); await expectCalls(0, 'reaplicação');
  } finally { await db.close(); }
});

test('M2 — gate 107 (pagamento): anti-join fiel ao billing-provision-worker', async () => {
  const db = await fresh();
  const call = 'invoke_billing_provision_worker()';
  const expectCalls = async (n, msg) => assert.equal((await httpCalls(db, call)).length, n, msg);
  const reset = () => db.exec('TRUNCATE public.org_subscriptions, public.subscription_provisionings, public.payment_links, public.payment_link_charges');
  try {
    await expectCalls(1, 'baseline de prod dispara com tudo vazio');
    await db.exec(mig(M2));
    await expectCalls(0, 'tudo vazio');
    assert.deepEqual(await priv(db, `public.${call}`), { anon: false, authenticated: false, service: true });

    await db.exec("INSERT INTO public.org_subscriptions VALUES ('pay_1', NULL)");
    const [http] = await httpCalls(db, call);
    assert.equal(http.url, 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/billing-provision-worker');
    assert.equal(http.timeout_milliseconds, 30000);
    assert.equal(http.headers['x-cron-secret'], 'fixture-secret');
    await db.exec("INSERT INTO public.subscription_provisionings VALUES ('pay_1', 'provisioned')");
    await expectCalls(0, 'assinatura já provisionada');
    await db.exec("UPDATE public.subscription_provisionings SET status = 'blocked'");
    await expectCalls(0, "provisionamento 'blocked' conta como feito (igual ao Set do worker)");
    await reset(); await db.exec("INSERT INTO public.org_subscriptions VALUES ('pay_2', now())");
    await expectCalls(0, 'assinatura cancelada');
    await reset(); await db.exec('INSERT INTO public.org_subscriptions VALUES (NULL, NULL)');
    await expectCalls(0, 'sem cobrança');

    await reset();
    const link = (await one(db, "INSERT INTO public.payment_links (target_kind, paid_at) VALUES ('new_org', now()) RETURNING id")).id;
    await db.query("INSERT INTO public.payment_link_charges VALUES ($1, 'ch_1')", [link]);
    await expectCalls(1, 'link new_org pago e não provisionado');
    await db.exec("INSERT INTO public.subscription_provisionings VALUES ('ch_1', 'provisioned')");
    await expectCalls(0, 'link new_org provisionado');
    await db.exec("DELETE FROM public.subscription_provisionings; UPDATE public.payment_links SET paid_at = NULL");
    await expectCalls(0, 'link não pago');
    await db.exec("UPDATE public.payment_links SET paid_at = now(), target_kind = 'existing_org'");
    await expectCalls(0, 'link de org existente (sinal é org_subscriptions)');
    await reset();
  } finally { await db.close(); }
});

test('M3 — dispatcher: cadência, isolamento de falha, voip, lock_timeout, alerta sustentado, agenda e rollback', async () => {
  const db = await fresh();
  const PAR = '2026-10-05T12:00:00Z';
  const IMPAR = '2026-10-05T12:01:00Z';
  async function run(at) {
    await db.exec('TRUNCATE public.fixture_dispatch_calls, public.fixture_http_calls');
    await db.query('SELECT public.cron_dispatch_minute($1::timestamptz)', [at]);
    return all(db, 'SELECT nome, lock_timeout FROM public.fixture_dispatch_calls ORDER BY ordem');
  }
  try {
    await db.exec(mig(M1));
    await db.exec(mig(M2));
    await db.exec("INSERT INTO public.system_alerts (severity, category, title, metadata) VALUES " +
      "('error','cron_job_stale','x','{\"job_name\":\"send-push\"}'), " +
      "('critical','cron_job_failure','x','{\"job_name\":\"copilot-queue-sweep\"}'), " +
      "('error','cron_job_stale','x','{\"job_name\":\"cron-health-monitor\"}')");
    await db.exec(mig(M3));

    // Catálogo e grants.
    assert.deepEqual(await priv(db, 'public.cron_dispatch_minute(timestamptz)'), { anon: false, authenticated: false, service: true });
    assert.deepEqual(await priv(db, 'public.cron_dispatch_registrar_saude(text[],jsonb)'), { anon: false, authenticated: false, service: false });
    const p = await one(db, "SELECT prosecdef, proconfig FROM pg_proc WHERE oid='public.cron_dispatch_minute(timestamptz)'::regprocedure");
    assert.equal(p.prosecdef, true);
    assert.deepEqual([...p.proconfig].sort(), ['lock_timeout=2s', 'search_path=""']);
    assert.equal((await one(db, "SELECT relpersistence, relrowsecurity FROM pg_class WHERE oid='public.cron_dispatch_falhas'::regclass")).relpersistence, 'u');
    const acesso = async (role, priv) => (await one(db, "SELECT has_table_privilege($1, 'public.cron_dispatch_falhas', $2) ok", [role, priv])).ok;
    for (const role of ['anon', 'authenticated']) assert.equal(await acesso(role, 'SELECT'), false, role);
    // default ACL emulado dá ALL a service_role; a migration deixa só leitura.
    assert.equal(await acesso('service_role', 'SELECT'), true);
    for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(await acesso('service_role', priv), false, priv);

    // Agenda: 1 job novo ativo; 19 antigos inativos (não apagados); vizinho intocado.
    const disp = await all(db, "SELECT schedule, command, active FROM cron.job WHERE jobname='cron-dispatch-minute'");
    assert.deepEqual(disp, [{ schedule: '* * * * *', command: 'SELECT public.cron_dispatch_minute()', active: true }]);
    assert.deepEqual(await one(db, 'SELECT count(*)::int n, bool_or(active) a FROM cron.job WHERE jobname = ANY($1)', [ANTIGOS]), { n: 19, a: false });
    assert.equal((await one(db, "SELECT active FROM cron.job WHERE jobname='cron-health-monitor'")).active, true);
    // Alertas com nome antigo resolvidos; o do vizinho, não.
    const alerts = await all(db, "SELECT metadata->>'job_name' j, resolved_at IS NOT NULL r, metadata->>'resolved_reason' why FROM public.system_alerts ORDER BY 1");
    assert.deepEqual(alerts, [
      { j: 'copilot-queue-sweep', r: true, why: 'consolidated_into_cron_dispatch_minute' },
      { j: 'cron-health-monitor', r: false, why: null },
      { j: 'send-push', r: true, why: 'consolidated_into_cron_dispatch_minute' },
    ]);

    // Cadência: par = todo minuto + */2; ímpar = todo minuto + 1-59/2.
    let calls = await run(PAR);
    assert.deepEqual(calls.map((c) => c.nome), [...TODO_MINUTO, 'invoke_mass_send_status', 'invoke_whatsapp_media_retry']);
    assert.ok(calls.every((c) => c.lock_timeout === '2s'), 'lock_timeout 2s vale nas subtarefas');
    calls = await run(IMPAR);
    assert.deepEqual(calls.map((c) => c.nome), [...TODO_MINUTO, 'invoke_infra_watchdog']);
    // Paridade é do minuto UTC, não do TimeZone da sessão (Kathmandu = +05:45).
    await db.exec("SET TimeZone = 'Asia/Kathmandu'");
    assert.ok((await run(PAR)).some((c) => c.nome === 'invoke_mass_send_status'));
    await db.exec("SET TimeZone = 'UTC'");

    // Gates reais da M2 dentro do dispatcher; billing só em minuto ímpar.
    await db.exec("INSERT INTO public.org_subscriptions VALUES ('pay_9', NULL); INSERT INTO public.workflow_executions (status) VALUES ('running')");
    await run(PAR);
    let urls = (await all(db, 'SELECT url FROM public.fixture_http_calls')).map((r) => r.url);
    assert.deepEqual(urls, ['https://fixture.invalid/functions/v1/process-workflow-executions']);
    await run(IMPAR);
    urls = (await all(db, 'SELECT url FROM public.fixture_http_calls ORDER BY url')).map((r) => r.url);
    assert.deepEqual(urls, ['https://fixture.invalid/functions/v1/process-workflow-executions',
      'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/billing-provision-worker']);
    await db.exec('TRUNCATE public.org_subscriptions, public.workflow_executions');
    await run(IMPAR);
    assert.equal((await one(db, 'SELECT count(*)::int n FROM public.fixture_http_calls')).n, 0, 'filas vazias: zero HTTP');

    // UPDATEs de voip (139 e 96) iguais aos comandos dos jobs.
    await db.exec(`INSERT INTO public.voip_calls (tag, status, authorized_at, ringing_at, connected_at) VALUES
      ('auth-velha', 'authorized', now() - interval '13 seconds', NULL, NULL),
      ('auth-nova',  'authorized', now(), NULL, NULL),
      ('ring-velha', 'ringing', now() - interval '10 minutes', now() - interval '3 minutes', NULL),
      ('ring-nova',  'ringing', now() - interval '1 minute', now() - interval '30 seconds', NULL),
      ('conn-velha', 'connected', now() - interval '4 hours', now() - interval '4 hours', now() - interval '3 hours'),
      ('conn-nova',  'connected', now() - interval '1 hour', now() - interval '1 hour', now() - interval '50 minutes')`);
    await run(PAR);
    assert.deepEqual(await all(db, 'SELECT tag, status, end_reason, ended_at IS NOT NULL ended FROM public.voip_calls ORDER BY tag'), [
      { tag: 'auth-nova', status: 'authorized', end_reason: null, ended: false },
      { tag: 'auth-velha', status: 'expired', end_reason: 'reservation_expired', ended: true },
      { tag: 'conn-nova', status: 'connected', end_reason: null, ended: false },
      { tag: 'conn-velha', status: 'ended', end_reason: 'no_terminal_event', ended: true },
      { tag: 'ring-nova', status: 'ringing', end_reason: null, ended: false },
      { tag: 'ring-velha', status: 'ended', end_reason: 'no_terminal_event', ended: true },
    ]);

    // Subtarefa que levanta não derruba as outras nem desfaz HTTP já enfileirado.
    await db.exec("INSERT INTO public.fixture_raise VALUES ('sweep_copilot_queue'), ('invoke_omie_sync_dispatch')");
    await db.exec("INSERT INTO public.workflow_executions (status) VALUES ('running')");
    calls = await run(PAR);
    assert.deepEqual(calls.map((c) => c.nome).filter((n) => !['sweep_copilot_queue', 'invoke_omie_sync_dispatch'].includes(n)),
      TODO_MINUTO.filter((n) => !['sweep_copilot_queue', 'invoke_omie_sync_dispatch'].includes(n))
        .concat(['invoke_mass_send_status', 'invoke_whatsapp_media_retry']));
    assert.equal((await one(db, 'SELECT count(*)::int n FROM public.fixture_http_calls')).n, 1, 'HTTP do 59 sobreviveu à falha das vizinhas');
    assert.deepEqual(await all(db, 'SELECT subtarefa, falhas_seguidas FROM public.cron_dispatch_falhas ORDER BY 1'),
      [{ subtarefa: 'copilot-queue-sweep', falhas_seguidas: 1 }, { subtarefa: 'omie-sync-dispatch', falhas_seguidas: 1 }]);
    const openDispatchAlerts = async () => all(db, "SELECT metadata->>'job_name' j, severity FROM public.system_alerts WHERE resolved_at IS NULL AND metadata->>'job_name' LIKE 'cron-dispatch-minute/%' ORDER BY 1");
    await run(IMPAR);
    assert.deepEqual(await openDispatchAlerts(), [], '2 falhas seguidas ainda não alertam');
    await run(PAR);
    assert.deepEqual(await openDispatchAlerts(), [
      { j: 'cron-dispatch-minute/copilot-queue-sweep', severity: 'critical' },
      { j: 'cron-dispatch-minute/omie-sync-dispatch', severity: 'critical' },
    ], '3 falhas seguidas → alerta');
    await run(IMPAR);
    assert.equal((await openDispatchAlerts()).length, 2, 'um alerta aberto por subtarefa, sem duplicar');
    // Recuperação de uma: zera e resolve só ela.
    await db.exec("DELETE FROM public.fixture_raise WHERE nome = 'sweep_copilot_queue'");
    await run(PAR);
    assert.deepEqual(await openDispatchAlerts(), [{ j: 'cron-dispatch-minute/omie-sync-dispatch', severity: 'critical' }]);
    assert.equal((await one(db, "SELECT metadata->>'resolved_reason' r FROM public.system_alerts WHERE metadata->>'job_name'='cron-dispatch-minute/copilot-queue-sweep'")).r, 'auto_recovered');
    await db.exec('TRUNCATE public.fixture_raise');
    await run(PAR);
    assert.deepEqual(await openDispatchAlerts(), []);
    assert.equal((await one(db, 'SELECT count(*)::int n FROM public.cron_dispatch_falhas')).n, 0);

    // Subtarefa de minuto ímpar: minuto par (não roda) não zera a sequência.
    await db.exec("INSERT INTO public.fixture_raise VALUES ('invoke_infra_watchdog')");
    for (const at of [IMPAR, PAR, IMPAR, PAR]) await run(at);
    assert.equal((await one(db, "SELECT falhas_seguidas n FROM public.cron_dispatch_falhas WHERE subtarefa='infra-watchdog'")).n, 2);
    await run(IMPAR);
    assert.deepEqual(await openDispatchAlerts(), [{ j: 'cron-dispatch-minute/infra-watchdog', severity: 'critical' }]);
    await db.exec('TRUNCATE public.fixture_raise');
    await run(IMPAR);
    assert.deepEqual(await openDispatchAlerts(), []);

    // Purga de rate_limits só no minuto 7.
    await db.exec("INSERT INTO public.rate_limits (key, window_start, window_seconds) VALUES ('velha', now() - interval '3 hours', 60)");
    await run('2026-10-05T12:06:00Z');
    assert.equal((await one(db, "SELECT count(*)::int n FROM public.rate_limits WHERE key='velha'")).n, 1);
    await run('2026-10-05T12:07:00Z');
    assert.equal((await one(db, "SELECT count(*)::int n FROM public.rate_limits WHERE key='velha'")).n, 0);

    // Reaplicação idempotente.
    await db.exec(mig(M3));
    assert.equal((await one(db, "SELECT count(*)::int n FROM cron.job WHERE jobname='cron-dispatch-minute'")).n, 1);
    assert.deepEqual(await one(db, 'SELECT count(*)::int n, bool_or(active) a FROM cron.job WHERE jobname = ANY($1)', [ANTIGOS]), { n: 19, a: false });

    // Rollback: dispatcher fora, 19 de volta, objetos removidos. Reaplica limpo.
    await db.exec(rb(M3));
    assert.equal((await one(db, "SELECT count(*)::int n FROM cron.job WHERE jobname='cron-dispatch-minute'")).n, 0);
    assert.deepEqual(await one(db, 'SELECT count(*)::int n, bool_and(active) a FROM cron.job WHERE jobname = ANY($1)', [ANTIGOS]), { n: 19, a: true });
    assert.deepEqual(await one(db, "SELECT to_regprocedure('public.cron_dispatch_minute(timestamptz)') IS NULL f, to_regclass('public.cron_dispatch_falhas') IS NULL t"), { f: true, t: true });
    await db.exec(mig(M3));
    assert.equal((await one(db, "SELECT active FROM cron.job WHERE jobname='cron-dispatch-minute'")).active, true);
  } finally { await db.close(); }
});

test('M3 — sem pg_cron: cria o dispatcher e não agenda nada', async () => {
  const db = await fresh({ comCron: false });
  try {
    await db.exec(mig(M1));
    await db.exec(mig(M2));
    await db.exec(mig(M3));
    assert.equal((await one(db, "SELECT to_regprocedure('public.cron_dispatch_minute(timestamptz)') IS NOT NULL ok")).ok, true);
    await db.exec(rb(M3));
    await db.exec(rb(M2));
    await db.exec(rb(M1));
  } finally { await db.close(); }
});
