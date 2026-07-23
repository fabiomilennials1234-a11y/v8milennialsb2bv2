-- Schedule whatsapp-dlq-replay edge function every 5 minutes.
--
-- Drains the whatsapp_webhook_dlq table by re-running instance resolution and
-- re-POSTing payloads through the live whatsapp-webhook endpoint. UPSERT
-- guarantees idempotency, so replay is safe even if the original event already
-- landed via a parallel path.

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_dlq_replay()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_dlq_replay() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_dlq_replay() TO service_role;

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping whatsapp_dlq_replay schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_dlq_replay') THEN
    PERFORM cron.unschedule('whatsapp_dlq_replay');
  END IF;

  PERFORM cron.schedule(
    'whatsapp_dlq_replay',
    '*/5 * * * *',
    'SELECT public.invoke_whatsapp_dlq_replay()'
  );
END
$outer$;

COMMENT ON FUNCTION public.invoke_whatsapp_dlq_replay() IS
  'Invokes whatsapp-dlq-replay every 5 minutes via pg_net. Drains '
  'whatsapp_webhook_dlq by re-running instance resolution + replay against '
  'whatsapp-webhook. UPSERT preserves idempotency.';
