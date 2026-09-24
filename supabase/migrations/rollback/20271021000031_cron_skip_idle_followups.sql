-- Restore exact pre-guard production function bodies captured 2026-09-24.

CREATE OR REPLACE FUNCTION public.invoke_meta_leadgen_poll()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'meta_leadgen_poll_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN
    RAISE NOTICE 'meta_leadgen_poll_url não configurado';
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
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_meta_leadgen_poll() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_meta_leadgen_poll() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_process_copilot_followups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_copilot_followups_url';
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

REVOKE ALL ON FUNCTION public.invoke_process_copilot_followups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_copilot_followups() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_process_followup_automations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  -- URL configurável via tabela cron_config
  SELECT value INTO worker_url FROM public.cron_config
  WHERE key = 'process_followup_automations_url';

  -- Se não configurado, usar URL padrão baseada no SUPABASE_URL
  IF worker_url IS NULL THEN
    SELECT value INTO worker_url FROM public.cron_config
    WHERE key = 'supabase_functions_base_url';
    IF worker_url IS NOT NULL THEN
      worker_url := worker_url || '/process-followup-automations';
    END IF;
  END IF;

  -- Obter secret do cron
  SELECT value INTO secret_val FROM public.cron_config
  WHERE key = 'cron_secret';

  -- Só executa se tiver URL configurada
  IF worker_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(secret_val, '')
      ),
      body := '{}'::jsonb
    );
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_process_followup_automations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_followup_automations() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_process_followup_situations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE secret_val text;
BEGIN
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  PERFORM net.http_post(
    url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/process-followup-situations',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', COALESCE(secret_val,'')),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN NULL;
END; $function$;

REVOKE ALL ON FUNCTION public.invoke_process_followup_situations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_followup_situations() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_process_outbound_dispatches()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_outbound_dispatches_url';
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

REVOKE ALL ON FUNCTION public.invoke_process_outbound_dispatches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_outbound_dispatches() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_workflow_cron_triggers()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  v_url := replace(v_url, 'campaign-rule-dispatch', 'process-workflow-executions');

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{"mode":"cron_triggers"}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[workflow-cron] invoke_workflow_cron_triggers failed: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_workflow_cron_triggers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_workflow_cron_triggers() TO service_role;


