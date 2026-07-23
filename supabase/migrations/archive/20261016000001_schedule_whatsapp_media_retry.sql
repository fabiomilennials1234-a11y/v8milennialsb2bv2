-- Schedule whatsapp-media-retry edge function every 2 minutes.
--
-- Drains whatsapp_media_jobs by re-running download + Storage upload for
-- pending rows (resolved_at IS NULL AND attempts < 5). Faster cadence than
-- the webhook DLQ replay because the WhatsApp media CDN is the constraint:
-- URLs expire ~14 days, but transient CDN errors should be cleared quickly.

CREATE OR REPLACE FUNCTION public.invoke_whatsapp_media_retry()
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
$$;

REVOKE ALL    ON FUNCTION public.invoke_whatsapp_media_retry() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_whatsapp_media_retry() TO service_role;

DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping whatsapp_media_retry schedule';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp_media_retry') THEN
    PERFORM cron.unschedule('whatsapp_media_retry');
  END IF;

  PERFORM cron.schedule(
    'whatsapp_media_retry',
    '*/2 * * * *',
    'SELECT public.invoke_whatsapp_media_retry()'
  );
END
$outer$;

COMMENT ON FUNCTION public.invoke_whatsapp_media_retry() IS
  'Invokes whatsapp-media-retry every 2 minutes via pg_net. Drains '
  'whatsapp_media_jobs by retrying CDN download + Storage upload.';
