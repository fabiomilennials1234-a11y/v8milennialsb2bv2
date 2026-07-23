-- 20261128000005_meta_leadgen_poll_cron.sql
-- Meta agency integration (ADR-0009) — Slice 4 cron. APPLIED TO PROD 2026-06-15.
-- Polls bound Meta pages every 5 min. Invoker reads url + cron_secret from
-- cron_config (secret never leaves the DB). No-op until pages are bound, so it
-- is safe to enable ahead of the binding UI.

INSERT INTO public.cron_config (key, value)
VALUES ('meta_leadgen_poll_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/meta-leadgen-poll')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.invoke_meta_leadgen_poll()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.invoke_meta_leadgen_poll IS 'Chama meta-leadgen-poll via pg_net (ADR-0009). Lê url + cron_secret de cron_config.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-leadgen-poll') THEN
    PERFORM cron.unschedule('meta-leadgen-poll');
  END IF;
  PERFORM cron.schedule('meta-leadgen-poll', '*/5 * * * *', 'SELECT public.invoke_meta_leadgen_poll()');
END $$;
