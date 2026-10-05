-- rollback/20271107140001_cron_gate_workflow_billing.sql
--
-- Volta os dois invocadores aos corpos de prod capturados (pg_get_functiondef)
-- em 2026-10-05, antes do apply: sem gate, disparam a cada tick. Rodar DEPOIS
-- do rollback da M3. ACL preservada (postgres + service_role).

BEGIN;

CREATE OR REPLACE FUNCTION public.invoke_process_workflow_executions()
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

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[workflow-cron] cron_config missing: url=%, secret=%', v_url, v_secret IS NOT NULL;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[workflow-cron] invoke_process_workflow_executions failed: %', SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_billing_provision_worker()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/billing-provision-worker';
  v_secret TEXT;
BEGIN
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(v_secret, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_process_workflow_executions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invoke_billing_provision_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_workflow_executions() TO service_role;
GRANT EXECUTE ON FUNCTION public.invoke_billing_provision_worker() TO service_role;

COMMIT;
