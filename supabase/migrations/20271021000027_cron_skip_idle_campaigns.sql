-- Read-only eligibility guards. Production definitions compared with deployed workers 2026-09-23.
-- Keep cron cadence, HTTP auth/body, claim concurrency and worker-side recovery unchanged.
-- A false probe defers arrivals until the next existing tick; never claims or mutates tasks.

-- Live plans already use due-send/timeout indexes. These recovery probes lacked
-- indexes and scanned historical rows; only in-flight rows belong in the index.
CREATE INDEX IF NOT EXISTS idx_spm_processing_scheduled_at
  ON public.scheduled_pipe_messages (scheduled_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS oraculo_feedback_alerts_processing_lease_idx
  ON public.oraculo_feedback_alerts (lease_until) WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.invoke_campaign_rule_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN

  -- Preserve due sends, expired response waits and recovery of stale processing.
  -- Workers remain owners of claims, wrapper cancellation and delivery gates.
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_campaign_messages
      WHERE status = 'scheduled' AND scheduled_at <= now())
    AND NOT EXISTS (SELECT 1 FROM public.scheduled_campaign_messages
      WHERE status = 'waiting_response' AND wait_timeout_at <= now())
    AND NOT EXISTS (SELECT 1 FROM public.scheduled_campaign_messages
      WHERE status = 'processing' AND scheduled_at < now() - interval '2 minutes') THEN
    RETURN;
  END IF;
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.invoke_oraculo_feedback_worker(p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_url text; v_secret text;
BEGIN

  -- Weekly mode creates its own digest; an empty alert queue must not block it.
  IF p_mode = 'alerts' AND NOT EXISTS (
    SELECT 1 FROM public.oraculo_feedback_alerts
    WHERE status = 'pending' AND next_attempt_at <= now()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.oraculo_feedback_alerts
    WHERE status = 'processing' AND lease_until < now()
  ) THEN RETURN; END IF;
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/oraculo-feedback-worker')
    INTO v_url FROM public.cron_config
    WHERE value LIKE 'https://%/functions/v1/%'
    ORDER BY key LIMIT 1;
  IF coalesce(v_url, '') = '' OR coalesce(v_secret, '') = '' THEN
    RAISE WARNING '[oraculo-feedback-worker] cron_config incompleto';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 30000
  );
EXCEPTION WHEN invalid_schema_name OR undefined_function OR undefined_table THEN RETURN;
END;
$function$;


CREATE OR REPLACE FUNCTION public.invoke_pipe_rule_dispatch()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN

  -- Preserve due sends, expired response waits and recovery of stale processing.
  -- Workers remain owners of claims, wrapper cancellation and delivery gates.
  IF NOT EXISTS (SELECT 1 FROM public.scheduled_pipe_messages
      WHERE status = 'scheduled' AND scheduled_at <= now())
    AND NOT EXISTS (SELECT 1 FROM public.scheduled_pipe_messages
      WHERE status = 'waiting_response' AND wait_timeout_at <= now())
    AND NOT EXISTS (SELECT 1 FROM public.scheduled_pipe_messages
      WHERE status = 'processing' AND scheduled_at < now() - interval '2 minutes') THEN
    RETURN;
  END IF;
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.invoke_process_blast_recipients()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN

  -- Exact eligibility of claim_blast_recipients, including abandoned claims.
  -- Preserve release windows, official-provider routing and paused plans.
  IF NOT EXISTS (
    SELECT 1 FROM public.blast_plan_recipients r
    JOIN public.blast_plans p ON p.id = r.plan_id
    JOIN public.whatsapp_instances i ON i.id = p.instance_id
    WHERE r.status = 'pending'
      AND (r.claimed_at IS NULL OR r.claimed_at < now() - interval '10 minutes')
      AND r.lot_index < p.lots_released
      AND p.status = 'active' AND p.template IS NOT NULL
      AND i.provider = 'notificame'
  ) THEN RETURN; END IF;
  IF to_regclass('public.blast_plan_recipients') IS NULL THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/process-blast-recipients')
    INTO v_url
    FROM public.cron_config
   WHERE value LIKE 'https://%/functions/v1/%'
   ORDER BY key
   LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', COALESCE(v_secret, '')
               ),
    body    := '{}'::jsonb
  );
EXCEPTION
  -- `invalid_schema_name` é obrigatório: sem pg_net o Postgres falha no SCHEMA
  -- (3F000 schema "net" does not exist) ANTES de procurar a função, e
  -- `undefined_function` não captura isso.
  WHEN invalid_schema_name THEN RETURN;
  WHEN undefined_function  THEN RETURN;
  WHEN undefined_column    THEN RETURN;
  WHEN undefined_table     THEN RETURN;
END;
$function$;


REVOKE ALL ON FUNCTION public.invoke_campaign_rule_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_campaign_rule_dispatch() TO service_role;
REVOKE ALL ON FUNCTION public.invoke_oraculo_feedback_worker(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_oraculo_feedback_worker(text) TO service_role;
REVOKE ALL ON FUNCTION public.invoke_pipe_rule_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_pipe_rule_dispatch() TO service_role;
REVOKE ALL ON FUNCTION public.invoke_process_blast_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_blast_recipients() TO service_role;
