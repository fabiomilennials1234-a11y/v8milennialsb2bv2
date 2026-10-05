-- ISOLATED TEST DATABASE ONLY (PGlite). Never run on a populated Supabase project.
-- Esqueleto mínimo, copiado das colunas de prod em 2026-10-05, para as
-- migrations 20271107140000/01/02 (rate_limits, gates 59/107, dispatcher).
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;
  END LOOP;
END $$;
-- Emula o Supabase: função nova em public nasce com EXECUTE nominal.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE TABLE public.cron_config (key text PRIMARY KEY, value text);
INSERT INTO public.cron_config VALUES
  ('cron_secret', 'fixture-secret'),
  ('campaign_rule_dispatch_url', 'https://fixture.invalid/functions/v1/campaign-rule-dispatch');

CREATE TABLE public.fixture_http_calls (url text, headers jsonb, body jsonb, timeout_milliseconds integer);
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fixture_http_calls VALUES (url, headers, body, timeout_milliseconds);
  RETURN 1;
END;
$$;

-- ── rate_limits (DDL de prod) ───────────────────────────────────────────────
CREATE TABLE public.rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_seconds integer NOT NULL DEFAULT 60,
  request_count integer NOT NULL DEFAULT 1,
  max_requests integer NOT NULL DEFAULT 100,
  CONSTRAINT rate_limits_key_window_start_key UNIQUE (key, window_start)
);
CREATE INDEX idx_rate_limits_key_window ON public.rate_limits USING btree (key, window_start DESC);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON public.rate_limits TO service_role USING (true);

-- ── job 59 ──────────────────────────────────────────────────────────────────
CREATE TABLE public.workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-0000000000aa',
  status text NOT NULL,
  current_node_id text,
  next_run_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workflow_button_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-0000000000aa',
  execution_id uuid NOT NULL,
  node_id text NOT NULL DEFAULT 'n1',
  state text NOT NULL,
  deadline_at timestamptz,
  send_check_count integer NOT NULL DEFAULT 0,
  next_send_check_at timestamptz,
  send_started_at timestamptz
);
CREATE TABLE public.workflow_button_ingress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-0000000000aa',
  question_id uuid NOT NULL,
  received_at timestamptz NOT NULL
);

-- ── job 107 (pagamento) ─────────────────────────────────────────────────────
CREATE TABLE public.org_subscriptions (provider_payment_id text, cancelled_at timestamptz);
CREATE TABLE public.subscription_provisionings (provider_payment_id text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'provisioned');
CREATE TABLE public.payment_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_kind text NOT NULL, paid_at timestamptz);
CREATE TABLE public.payment_link_charges (payment_link_id uuid NOT NULL, provider_charge_id text NOT NULL UNIQUE);

-- ── jobs 96/139 ─────────────────────────────────────────────────────────────
CREATE TABLE public.voip_calls (
  tag text PRIMARY KEY,
  status text NOT NULL,
  end_reason text,
  authorized_at timestamptz NOT NULL,
  ringing_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── alertas ─────────────────────────────────────────────────────────────────
CREATE TABLE public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  severity text NOT NULL CHECK (severity = ANY (ARRAY['info','warning','error','critical'])),
  category text NOT NULL,
  title text NOT NULL,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- ── Invocadores já gateados em prod (#2162): aqui são dublês que registram a
-- chamada e o lock_timeout efetivo. Nome em fixture_raise → a chamada falha.
CREATE TABLE public.fixture_dispatch_calls (nome text NOT NULL, lock_timeout text NOT NULL, ordem serial);
CREATE TABLE public.fixture_raise (nome text PRIMARY KEY);
CREATE FUNCTION public.fixture_record(p_nome text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.fixture_dispatch_calls (nome, lock_timeout) VALUES (p_nome, current_setting('lock_timeout'));
  IF EXISTS (SELECT 1 FROM public.fixture_raise WHERE nome = p_nome) THEN
    RAISE EXCEPTION 'fixture: % falhou', p_nome;
  END IF;
END;
$$;
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['invoke_copilot_v2_worker', 'invoke_process_ai_actions',
    'invoke_workflow_cron_triggers', 'invoke_campaign_rule_dispatch', 'invoke_pipe_rule_dispatch',
    'invoke_process_scheduled_user_messages', 'invoke_history_sync_worker', 'invoke_omie_sync_dispatch',
    'invoke_process_blast_recipients', 'invoke_send_push', 'invoke_mass_send_status',
    'invoke_whatsapp_media_retry', 'invoke_infra_watchdog'] LOOP
    EXECUTE format('CREATE FUNCTION public.%I() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN PERFORM public.fixture_record(%L); END $f$', fn, fn);
  END LOOP;
END $$;
CREATE FUNCTION public.invoke_oraculo_feedback_worker(p_mode text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.fixture_record('invoke_oraculo_feedback_worker:' || p_mode); END $$;
-- Prod: sweep_copilot_queue(integer) com default; o job chamava sem argumento.
CREATE FUNCTION public.sweep_copilot_queue(p_limit integer DEFAULT 50) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.fixture_record('sweep_copilot_queue'); RETURN 0; END $$;

-- ── pg_cron mínimo (1.6: schedule por nome é upsert; alter_job; unschedule) ─
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  jobname text,
  username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  UPDATE cron.job j SET schedule = $2, command = $3 WHERE j.jobname = $1 AND j.username = current_user
    RETURNING j.jobid INTO v;
  IF v IS NULL THEN
    INSERT INTO cron.job (schedule, command, jobname) VALUES ($2, $3, $1) RETURNING jobid INTO v;
  END IF;
  RETURN v;
END $$;
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cron.job j SET schedule = COALESCE($2, j.schedule), command = COALESCE($3, j.command),
    active = COALESCE($6, j.active) WHERE j.jobid = $1;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job %', $1; END IF;
END $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job j WHERE j.jobname = $1 AND j.username = current_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'could not find valid entry for job ''%''', $1; END IF;
  RETURN true;
END $$;
-- Snapshot de prod 2026-10-05 dos 19 jobs consolidados + vizinhos que não mudam.
INSERT INTO cron.job (jobname, schedule, command) VALUES
  ('cron-health-monitor', '2-59/5 * * * *', 'SELECT public.check_cron_job_health()'),
  ('mass-send-status-poll', '*/2 * * * *', 'SELECT public.invoke_mass_send_status()'),
  ('whatsapp_media_retry', '*/2 * * * *', 'SELECT public.invoke_whatsapp_media_retry()'),
  ('copilot_v2_worker', '* * * * *', 'SELECT public.invoke_copilot_v2_worker()'),
  ('process-ai-actions', '* * * * *', 'SELECT public.invoke_process_ai_actions()'),
  ('process-workflow-executions', '* * * * *', 'SELECT public.invoke_process_workflow_executions()'),
  ('workflow-cron-triggers', '* * * * *', 'SELECT public.invoke_workflow_cron_triggers()'),
  ('campaign-rule-dispatch', '* * * * *', 'SELECT public.invoke_campaign_rule_dispatch()'),
  ('pipe-rule-dispatch', '* * * * *', 'SELECT public.invoke_pipe_rule_dispatch()'),
  ('process-scheduled-user-messages', '* * * * *', 'SELECT public.invoke_process_scheduled_user_messages()'),
  ('history-sync-worker', '* * * * *', 'SELECT public.invoke_history_sync_worker()'),
  ('copilot-queue-sweep', '* * * * *', 'SELECT public.sweep_copilot_queue();'),
  ('omie-sync-dispatch', '* * * * *', 'SELECT public.invoke_omie_sync_dispatch()'),
  ('voip-sweep-stuck-calls', '* * * * *', 'UPDATE public.voip_calls ...'),
  ('infra-watchdog', '1-59/2 * * * *', 'SELECT public.invoke_infra_watchdog()'),
  ('billing-provision-worker', '1-59/2 * * * *', 'SELECT public.invoke_billing_provision_worker()'),
  ('voip-reap-authorized', '* * * * *', 'UPDATE public.voip_calls ...'),
  ('process-blast-recipients', '* * * * *', 'SELECT public.invoke_process_blast_recipients();'),
  ('send-push', '* * * * *', 'SELECT public.invoke_send_push()'),
  ('oraculo-feedback-alerts', '* * * * *', 'SELECT public.invoke_oraculo_feedback_worker(''alerts'')');
