-- Skip empty cron dispatches without changing schedules, claims or delivery.
-- Cross-tenant existence probes are scheduler-only; no tenant data is returned.
-- Re-evaluation/claim remains in each worker (the probe is not a queue lock).
-- An enqueue after a negative probe waits until the next existing cron tick.
-- Independent cron-health-check noop probes remain scheduled and unchanged.
-- Live definitions captured from production 2026-09-23 for paired rollback.

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
  -- Keep the worker as owner of full-import UTC windows and pressure gates.
  -- Queued full jobs may cause a conservative extra call outside the window.
  -- Recover running jobs before evaluating queued work, just like the worker.
  IF NOT EXISTS (
    SELECT 1 FROM public.history_sync_jobs
    WHERE status = 'queued'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.history_sync_jobs
    WHERE status = 'running' AND updated_at < now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;
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
  -- Match claim_pending_ai_actions eligibility, including crashed workers.
  IF NOT EXISTS (
    SELECT 1 FROM public.pending_ai_actions
    WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now())
  ) AND NOT EXISTS (
    SELECT 1 FROM public.pending_ai_actions
    WHERE status = 'processing' AND updated_at < now() - interval '10 minutes'
  ) THEN
    RETURN;
  END IF;
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
  -- Match the worker's due query. Retries retain their scheduled_at backoff.
  IF NOT EXISTS (
    SELECT 1 FROM public.scheduled_user_messages
    WHERE status = 'scheduled' AND scheduled_at <= now()
  ) THEN
    RETURN;
  END IF;
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
  -- Reuse the canonical read-only eligibility function: access, preferences,
  -- presence, subscription and age checks must not drift from the worker.
  IF NOT EXISTS (
    SELECT 1 FROM public.fn_avisos_pendentes_de_push(p_limite => 1)
  ) THEN
    RETURN;
  END IF;
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
  -- Match the all_running branch; explicit user refresh remains unchanged.
  IF NOT EXISTS (
    SELECT 1 FROM public.uazapi_sender_jobs WHERE status IN ('queued', 'running')
  ) THEN
    RETURN;
  END IF;
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
  -- Match copilot_v2_claim_messages. A pending row is eligible regardless
  -- of next_retry_at; only retry rows honor that backoff.
  IF NOT EXISTS (
    SELECT 1 FROM public.copilot_v2_message_queue
    WHERE status = 'pending'
       OR (status = 'retry' AND (next_retry_at IS NULL OR next_retry_at <= now()))
  ) THEN
    RETURN;
  END IF;
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
  -- Match worker retry eligibility; exhausted rows stay for manual review.
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_webhook_dlq
    WHERE resolved_at IS NULL AND attempts < 5
  ) THEN
    RETURN;
  END IF;
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
  -- Match worker retry eligibility; exhausted rows stay for manual review.
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_media_jobs
    WHERE resolved_at IS NULL AND attempts < 5
  ) THEN
    RETURN;
  END IF;
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
