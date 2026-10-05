// Fase 1 (OOM 2026-10-05): índices de runtime_logs, REVOKE TRUNCATE, retenção
// de system_alerts e consolidação da purga de agent_decision_logs (73 → 106).
//
// PGlite, sem Docker/Supabase local. O esqueleto reproduz as colunas, índices,
// grants e jobs de PROD medidos em 2026-10-05 (MCP só leitura) — o suficiente
// para cada migration rodar como em prod e para o EXPLAIN antes/depois.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const mig = (nome) => read(`../../supabase/migrations/${nome}`);

const M1 = '20271107130001_runtime_logs_idx_erro_parcial.sql';
const M2 = '20271107130002_runtime_logs_drop_idx_status_created.sql';
const M3 = '20271107130003_runtime_logs_drop_idx_org_created.sql';
const M4 = '20271107130004_revoke_truncate_runtime_logs_audit_log.sql';
const M5 = '20271107130005_system_alerts_retencao.sql';
const M6 = '20271107130006_purge_copilot_absorve_job_73.sql';
const M7 = '20271107130007_operations_overview_pondera_amostragem.sql';

const ESQUELETO = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;

  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL,
    command text NOT NULL, active boolean NOT NULL DEFAULT true);
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
  LANGUAGE sql AS $$
    INSERT INTO cron.job(jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
    RETURNING jobid $$;
  CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
    database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$
    UPDATE cron.job SET schedule = coalesce(alter_job.schedule, job.schedule),
      command = coalesce(alter_job.command, job.command),
      active = coalesce(alter_job.active, job.active)
    WHERE jobid = job_id $$;

  CREATE TABLE public.runtime_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, module text NOT NULL,
    action text NOT NULL, status text NOT NULL, payload_snapshot jsonb, error_message text,
    entity_type text, entity_id uuid, triggered_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
    duration_ms integer, prompt_tokens integer, completion_tokens integer, llm_model text,
    reasoning text, session_id uuid, request_id uuid, actor_type text, gestor_id uuid);
  CREATE INDEX idx_runtime_logs_entity ON public.runtime_logs USING btree (entity_type, entity_id);
  CREATE INDEX idx_runtime_logs_gestor ON public.runtime_logs USING btree (gestor_id, created_at DESC) WHERE (gestor_id IS NOT NULL);
  CREATE INDEX idx_runtime_logs_module_action_time ON public.runtime_logs USING btree (module, action, created_at DESC);
  CREATE INDEX idx_runtime_logs_module_created ON public.runtime_logs USING btree (module, created_at DESC);
  CREATE INDEX idx_runtime_logs_org_created ON public.runtime_logs USING btree (organization_id, created_at DESC);
  CREATE INDEX idx_runtime_logs_perf ON public.runtime_logs USING btree (created_at DESC) WHERE (duration_ms IS NOT NULL);
  CREATE INDEX idx_runtime_logs_reasoning_recent ON public.runtime_logs USING btree (created_at DESC) WHERE (reasoning IS NOT NULL);
  CREATE INDEX idx_runtime_logs_request ON public.runtime_logs USING btree (request_id) WHERE (request_id IS NOT NULL);
  CREATE INDEX idx_runtime_logs_session_created ON public.runtime_logs USING btree (session_id, created_at) WHERE (session_id IS NOT NULL);
  CREATE INDEX idx_runtime_logs_status_created ON public.runtime_logs USING btree (status, created_at DESC);

  CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
    table_name text, row_id uuid, occurred_at timestamptz NOT NULL DEFAULT now());

  CREATE TABLE public.system_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, severity text NOT NULL,
    category text NOT NULL, source_type text, source_id uuid, title text NOT NULL, message text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, resolved_at timestamptz, resolved_by uuid,
    created_at timestamptz NOT NULL DEFAULT now());

  CREATE TABLE public.agent_decision_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    capabilities_snapshot jsonb, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.media_purge_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purged_at timestamptz);

  -- ACL de prod (relacl 2026-10-05): authenticated com arwdDxtm.
  GRANT ALL ON public.runtime_logs, public.audit_log, public.system_alerts, public.agent_decision_logs
    TO authenticated, service_role;

  -- Corpo de PROD da purga do 106 (pg_get_functiondef 2026-10-05) e seus grants.
  CREATE FUNCTION public.purge_copilot_e_midia_logs() RETURNS void LANGUAGE plpgsql
  SECURITY DEFINER SET search_path TO 'public' AS $function$
  begin
    delete from public.agent_decision_logs where ctid in (
      select ctid from public.agent_decision_logs where created_at < now() - interval '30 days' limit 50000);
    delete from public.media_purge_queue where ctid in (
      select ctid from public.media_purge_queue
      where purged_at is not null and purged_at < now() - interval '7 days' limit 50000);
  end; $function$;
  REVOKE ALL ON FUNCTION public.purge_copilot_e_midia_logs() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.purge_copilot_e_midia_logs() TO service_role;

  SELECT cron.schedule('agent-decision-logs-retention', '23 3 * * *',
    'DELETE FROM public.agent_decision_logs WHERE created_at < now()-interval ''30 days''; UPDATE public.agent_decision_logs SET capabilities_snapshot=NULL WHERE capabilities_snapshot IS NOT NULL AND created_at < now()-interval ''1 day'';');
  SELECT cron.schedule('purge-copilot-midia-logs', '8-59/15 * * * *', 'select public.purge_copilot_e_midia_logs()');
`;

// Distribuição de prod: ~98% sucesso/skipped, ~2% erro; webhook domina.
const SEMEAR_RUNTIME_LOGS = `
  INSERT INTO public.runtime_logs (organization_id, module, action, status, reasoning, created_at)
  SELECT ('00000000-0000-0000-0000-' || lpad((g % 40)::text, 12, '0'))::uuid,
         (ARRAY['webhook','webhook','webhook','workflow','copilot','whatsapp'])[1 + g % 6],
         CASE WHEN g % 6 = 4 AND g % 50 = 4 THEN 'reasoning' ELSE 'acao_' || (g % 9) END,
         CASE WHEN g % 50 = 0 THEN 'error' WHEN g % 7 = 0 THEN 'skipped' ELSE 'success' END,
         CASE WHEN g % 6 = 4 AND g % 50 = 4 THEN 'pensou' END,
         now() - (g % 43200) * interval '1 minute'
    FROM generate_series(1, 60000) g;
  ANALYZE public.runtime_logs;
`;

const Q_MASTER_ERRO = `SELECT id FROM public.runtime_logs
  WHERE created_at >= now() - interval '1 day' AND status = 'error'
  ORDER BY created_at DESC LIMIT 50`;
const Q_REASONING = `SELECT id FROM public.runtime_logs
  WHERE module = 'copilot' AND action = 'reasoning' AND reasoning IS NOT NULL
    AND organization_id = '00000000-0000-0000-0000-000000000004'
  ORDER BY created_at DESC LIMIT 50`;
const Q_PURGE_WEBHOOK = `SELECT ctid FROM public.runtime_logs
  WHERE module = 'webhook' AND created_at < now() - interval '2 days' LIMIT 50000`;

async function plano(db, sql) {
  await db.exec('SET enable_seqscan = off'); // força o índice que EXISTIR; revela o melhor disponível
  const r = await db.query(`EXPLAIN ${sql}`);
  await db.exec('RESET enable_seqscan');
  return r.rows.map((x) => x['QUERY PLAN']).join('\n');
}
const ids = async (db, sql) => (await db.query(sql)).rows.map((r) => r.id ?? r.ctid).sort();

test('1B — parcial de erro substitui status_created; org_created sai sem leitor órfão', async () => {
  const db = new PGlite();
  try {
    await db.exec(ESQUELETO);
    await db.exec(SEMEAR_RUNTIME_LOGS);

    const antes = {
      master: await plano(db, Q_MASTER_ERRO),
      reasoning: await plano(db, Q_REASONING),
      purge: await plano(db, Q_PURGE_WEBHOOK),
    };
    const linhasAntes = {
      master: await ids(db, Q_MASTER_ERRO),
      reasoning: await ids(db, Q_REASONING),
    };
    assert.match(antes.master, /idx_runtime_logs_status_created/);

    // Um statement por arquivo: o exec roda fora de transação, como o psql autocommit.
    for (const f of [M1, M2, M3]) await db.exec(mig(f));
    await db.exec('ANALYZE public.runtime_logs');

    const idx = (await db.query(`SELECT indexrelid::regclass::text AS i, indisvalid
      FROM pg_index WHERE indrelid = 'public.runtime_logs'::regclass`)).rows;
    const nomes = idx.map((r) => r.i);
    assert.ok(!nomes.includes('idx_runtime_logs_status_created'));
    assert.ok(!nomes.includes('idx_runtime_logs_org_created'));
    assert.ok(idx.find((r) => r.i === 'idx_runtime_logs_error_created')?.indisvalid);
    const def = (await db.query(`SELECT pg_get_indexdef('public.idx_runtime_logs_error_created'::regclass) d`)).rows[0].d;
    assert.match(def, /\(created_at DESC\) WHERE \(status = 'error'::text\)/);

    const depois = {
      master: await plano(db, Q_MASTER_ERRO),
      reasoning: await plano(db, Q_REASONING),
      purge: await plano(db, Q_PURGE_WEBHOOK),
    };
    if (process.env.EXPLAIN) console.log(JSON.stringify({ antes, depois }, null, 2));

    assert.match(depois.master, /idx_runtime_logs_error_created/, depois.master);
    assert.match(depois.reasoning, /idx_runtime_logs_(module_action_time|reasoning_recent)/, depois.reasoning);
    assert.match(depois.purge, /idx_runtime_logs_module_(created|action_time)/, depois.purge);
    assert.doesNotMatch(Object.values(depois).join('\n'), /Seq Scan/);

    // Mesmo resultado, só outro caminho.
    assert.deepEqual(await ids(db, Q_MASTER_ERRO), linhasAntes.master);
    assert.deepEqual(await ids(db, Q_REASONING), linhasAntes.reasoning);
    assert.ok(linhasAntes.master.length > 0 && linhasAntes.reasoning.length > 0, 'controle positivo: há linhas');

    // Reaplicar é inócuo (IF [NOT] EXISTS).
    for (const f of [M1, M2, M3]) await db.exec(mig(f));
  } finally {
    await db.close();
  }
});

test('REVOKE TRUNCATE — authenticated e anon perdem TRUNCATE; resto da ACL intacta', async () => {
  const db = new PGlite();
  try {
    await db.exec(ESQUELETO);
    const priv = async (role, tbl, p) =>
      (await db.query(`SELECT has_table_privilege('${role}', '${tbl}', '${p}') ok`)).rows[0].ok;

    // Controle positivo: o furo existe antes.
    assert.equal(await priv('authenticated', 'public.runtime_logs', 'TRUNCATE'), true);
    assert.equal(await priv('authenticated', 'public.audit_log', 'TRUNCATE'), true);

    await db.exec(mig(M4));
    for (const t of ['public.runtime_logs', 'public.audit_log']) {
      assert.equal(await priv('authenticated', t, 'TRUNCATE'), false, t);
      assert.equal(await priv('anon', t, 'TRUNCATE'), false, t);
      assert.equal(await priv('service_role', t, 'TRUNCATE'), true, `${t}: service_role mantém`);
      assert.equal(await priv('authenticated', t, 'SELECT'), true, `${t}: só TRUNCATE sai`);
    }
    await db.exec('SET ROLE authenticated');
    await assert.rejects(db.exec('TRUNCATE public.audit_log'), /permission denied/);
    await assert.rejects(db.exec('TRUNCATE public.runtime_logs'), /permission denied/);
    await db.exec('RESET ROLE');
    await db.exec(mig(M4)); // idempotente
  } finally {
    await db.close();
  }
});

test('system_alerts — apaga resolvido criado há >30 d, em lotes de 5.000; aberto nunca; job por jobname', async () => {
  const db = new PGlite();
  try {
    await db.exec(ESQUELETO);
    await db.exec(`
      INSERT INTO public.system_alerts (severity, category, title, message, created_at, resolved_at, source_type)
      VALUES ('critical','cron_job_failure','aberto antigo','x', now()-interval '90 days', NULL, 'aberto'),
             ('critical','cron_job_failure','aberto recente','x', now()-interval '2 days', NULL, 'aberto_recente'),
             ('critical','cron_job_failure','resolvido recente','x', now()-interval '10 days', now()-interval '9 days', 'recente'),
             -- o caso de prod: criado há 40 d, resolvido em LOTE há 4 d → É apagado (idade pela criação)
             ('critical','cron_job_failure','lote 01/10','x', now()-interval '40 days', now()-interval '4 days', 'lote');
      INSERT INTO public.system_alerts (severity, category, title, message, created_at, resolved_at, source_type)
      SELECT 'critical','cron_job_failure','velho','x', now()-interval '60 days', now()-interval '31 days', 'velho'
        FROM generate_series(1, 5100);
    `);
    await db.exec(mig(M5));

    const purge = async () => (await db.query('SELECT public.purge_system_alerts_resolvidos() n')).rows[0].n;
    assert.equal(await purge(), 5000, 'lote limitado a 5.000');
    assert.equal(await purge(), 101, '100 velhos + o resolvido em lote');
    assert.equal(await purge(), 0);
    const sobra = (await db.query(`SELECT source_type FROM public.system_alerts ORDER BY 1`)).rows.map((r) => r.source_type);
    assert.deepEqual(sobra, ['aberto', 'aberto_recente', 'recente']);

    const jobs = (await db.query(`SELECT schedule, command, active FROM cron.job WHERE jobname = 'purge-system-alerts-resolvidos'`)).rows;
    assert.deepEqual(jobs, [{ schedule: '50 * * * *', command: 'SELECT public.purge_system_alerts_resolvidos()', active: true }]);

    for (const role of ['anon', 'authenticated', 'service_role']) {
      const ok = (await db.query(`SELECT has_function_privilege('${role}', 'public.purge_system_alerts_resolvidos()', 'EXECUTE') ok`)).rows[0].ok;
      assert.equal(ok, false, `${role} não executa a purga`);
    }

    await db.exec(mig(M5)); // reaplicar não duplica o job
    assert.equal((await db.query(`SELECT count(*)::int n FROM cron.job WHERE jobname = 'purge-system-alerts-resolvidos'`)).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('agent_decision_logs — UPDATE do job 73 entra na purga do 106 e o 73 é desativado', async () => {
  const db = new PGlite();
  try {
    await db.exec(ESQUELETO);
    await db.exec(`
      INSERT INTO public.agent_decision_logs (capabilities_snapshot, created_at) VALUES
        ('{"a":1}', now()-interval '40 days'),   -- apagada
        ('{"a":2}', now()-interval '2 days'),    -- snapshot esvaziado
        ('{"a":3}', now()-interval '2 hours');   -- intacta
      INSERT INTO public.media_purge_queue (purged_at) VALUES (now()-interval '10 days'), (NULL), (now()-interval '1 day');
    `);
    // Controle negativo: a função de prod sozinha NÃO esvazia o snapshot.
    await db.exec('SELECT public.purge_copilot_e_midia_logs()');
    assert.equal((await db.query(`SELECT count(*)::int n FROM public.agent_decision_logs WHERE capabilities_snapshot IS NOT NULL`)).rows[0].n, 2);

    await db.exec(mig(M6));
    await db.exec('SELECT public.purge_copilot_e_midia_logs()');

    const adl = (await db.query(`SELECT capabilities_snapshot c FROM public.agent_decision_logs ORDER BY created_at`)).rows.map((r) => r.c);
    assert.deepEqual(adl, [null, { a: 3 }]);
    assert.equal((await db.query(`SELECT count(*)::int n FROM public.media_purge_queue`)).rows[0].n, 2);

    const jobs = Object.fromEntries((await db.query(`SELECT jobname, active FROM cron.job`)).rows.map((r) => [r.jobname, r.active]));
    assert.equal(jobs['agent-decision-logs-retention'], false, '73 desativado por jobname');
    assert.equal(jobs['purge-copilot-midia-logs'], true, '106 segue ativo');

    const fn = (await db.query(`SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'purge_copilot_e_midia_logs'`)).rows[0];
    assert.equal(fn.prosecdef, true);
    assert.deepEqual(fn.proconfig, ['search_path=""']);
    const pode = async (role) =>
      (await db.query(`SELECT has_function_privilege('${role}', 'public.purge_copilot_e_midia_logs()', 'EXECUTE') ok`)).rows[0].ok;
    assert.equal(await pode('authenticated'), false);
    assert.equal(await pode('anon'), false);
    assert.equal(await pode('service_role'), true);
  } finally {
    await db.close();
  }
});

test('get_operations_overview — sucesso amostrado pesa 1/_sample_rate; gate e ACL de prod preservados', async () => {
  const db = new PGlite();
  try {
    await db.exec(ESQUELETO);
    // Corpo e ACL de PROD (pg_get_functiondef + proacl, 2026-10-05).
    await db.exec(`
      CREATE TABLE public.master_flag (on_ boolean);
      INSERT INTO public.master_flag VALUES (true);
      CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE
        AS $$ SELECT on_ FROM public.master_flag $$;
      CREATE OR REPLACE FUNCTION public.get_operations_overview(interval_param text DEFAULT '24 hours'::text)
       RETURNS json LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
      AS $function$
        SELECT CASE WHEN public.is_master_user() THEN (
          SELECT json_build_object(
            'jobs_success', COUNT(*) FILTER (WHERE status = 'success'),
            'jobs_error',   COUNT(*) FILTER (WHERE status = 'error'),
            'jobs_total',   COUNT(*),
            'orgs_active',  COUNT(DISTINCT organization_id)
          ) FROM public.runtime_logs WHERE created_at > NOW() - interval_param::INTERVAL
        ) ELSE json_build_object('error','access_denied') END;
      $function$;
      REVOKE ALL ON FUNCTION public.get_operations_overview(text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.get_operations_overview(text) TO anon, authenticated, service_role;

      INSERT INTO public.runtime_logs (organization_id, module, action, status, payload_snapshot) VALUES
        ('00000000-0000-0000-0000-000000000001', 'webhook', 'uazapi_process', 'success', '{"_sample_rate": 0.01}'),
        ('00000000-0000-0000-0000-000000000001', 'webhook', 'uazapi_receipt_unmatched', 'skipped', '{"_sample_rate": 0.1}'),
        ('00000000-0000-0000-0000-000000000002', 'general', 'qualquer', 'success', NULL),
        ('00000000-0000-0000-0000-000000000002', 'general', 'texto', 'success', '{"_sample_rate": "0.01"}'),
        ('00000000-0000-0000-0000-000000000002', 'general', 'lista', 'success', '[1,2]'),
        ('00000000-0000-0000-0000-000000000003', 'webhook', 'uazapi_process', 'error', NULL);
      INSERT INTO public.runtime_logs (module, action, status, payload_snapshot, created_at)
        VALUES ('webhook', 'uazapi_process', 'success', '{"_sample_rate": 0.01}', now() - interval '3 days');
    `);
    const acl = async () =>
      (await db.query(`SELECT proacl::text a, prosecdef, proconfig FROM pg_proc WHERE proname = 'get_operations_overview'`)).rows[0];
    const aclAntes = await acl();
    const overview = async () => (await db.query('SELECT public.get_operations_overview() o')).rows[0].o;

    // Controle: o corpo de prod conta linhas cruas.
    assert.deepEqual(await overview(), { jobs_success: 4, jobs_error: 1, jobs_total: 6, orgs_active: 3 });

    await db.exec(mig(M7));
    assert.deepEqual(await overview(), {
      jobs_success: 100 + 1 + 1 + 1, // 0.01 → 100; sem marca → 1; string e array não são número → 1
      jobs_error: 1,
      jobs_total: 100 + 10 + 1 + 1 + 1 + 1,
      orgs_active: 3,
    });
    assert.deepEqual(await acl(), aclAntes, 'CREATE OR REPLACE preserva ACL, DEFINER e search_path');
    assert.equal(aclAntes.prosecdef, true);
    assert.deepEqual(aclAntes.proconfig, ['search_path=public']);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const ok = (await db.query(
        `SELECT has_function_privilege('${role}', 'public.get_operations_overview(text)', 'EXECUTE') ok`,
      )).rows[0].ok;
      assert.equal(ok, true, `${role}: mesma ACL de prod`);
    }

    await db.exec('UPDATE public.master_flag SET on_ = false');
    assert.deepEqual(await overview(), { error: 'access_denied' }, 'gate is_master_user intacto');
  } finally {
    await db.close();
  }
});
