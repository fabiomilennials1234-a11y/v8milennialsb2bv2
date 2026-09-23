-- Restore exact pre-change dispatcher bodies captured from production
-- 2026-09-23. Safe to apply after the due-work guard migration.
CREATE OR REPLACE FUNCTION public.invoke_history_sync_worker()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  worker_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/history-sync-worker';
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
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_process_ai_actions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_ai_actions_url';
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
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_user_messages()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
  anon_key TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_scheduled_user_messages_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  SELECT value INTO anon_key FROM public.cron_config WHERE key = 'supabase_anon_key';

  IF worker_url IS NULL OR worker_url = '' THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, ''),
      'Authorization', 'Bearer ' || COALESCE(anon_key, '')
    ),
    body := '{}'::jsonb
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_send_push()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  worker_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/send-push';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';

  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', COALESCE(secret_val, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
EXCEPTION
  -- Mesmo padrão das outras invoke_*: exceção aqui só sujaria
  -- cron.job_run_details. A saúde do disparo é vigiada pelo cron-health-check,
  -- que desde #1886 avisa de verdade em vez de só registrar.
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_history_sync_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_history_sync_worker() TO service_role;
REVOKE ALL ON FUNCTION public.invoke_process_ai_actions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_ai_actions() TO service_role;
REVOKE ALL ON FUNCTION public.invoke_process_scheduled_user_messages() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_scheduled_user_messages() TO service_role;
REVOKE ALL ON FUNCTION public.invoke_send_push() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_send_push() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_mass_send_status()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  worker_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/mass-send-status';
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
    body := jsonb_build_object('all_running', true)
  );
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN OTHERS THEN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.invoke_copilot_v2_worker()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_url text; v_secret text;
begin
  select value into v_url    from public.cron_config where key = 'campaign_rule_dispatch_url';
  select value into v_secret from public.cron_config where key = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning '[copilot-v2-worker] cron_config incomplete: url=%, secret_present=%', v_url is not null, v_secret is not null;
    return;
  end if;
  v_url := replace(v_url, 'campaign-rule-dispatch', 'copilot-v2-worker');
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning '[copilot-v2-worker] invoke failed: %', sqlerrm;
end $function$;

REVOKE ALL ON FUNCTION public.invoke_mass_send_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_mass_send_status() TO service_role;
REVOKE ALL ON FUNCTION public.invoke_copilot_v2_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_copilot_v2_worker() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_dlq_replay()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[whatsapp-dlq-replay] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'whatsapp-dlq-replay');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-dlq-replay] invoke failed: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_whatsapp_dlq_replay() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_dlq_replay() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_media_retry()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url    FROM public.cron_config WHERE key = 'campaign_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING '[whatsapp-media-retry] cron_config incomplete: url=%, secret_present=%',
      v_url IS NOT NULL, v_secret IS NOT NULL;
    RETURN;
  END IF;

  v_url := replace(v_url, 'campaign-rule-dispatch', 'whatsapp-media-retry');

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[whatsapp-media-retry] invoke failed: %', SQLERRM;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_whatsapp_media_retry() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_media_retry() TO service_role;
