-- Restore dispatch bodies captured before migration27; retain service-only scheduler access.

DROP INDEX IF EXISTS public.idx_spm_processing_scheduled_at;
DROP INDEX IF EXISTS public.oraculo_feedback_alerts_processing_lease_idx;

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
