-- 20261128000007_meta_conversion_dispatch_cron.sql
-- Meta agency integration (ADR-0009) — Slice 5 cron. APPLIED TO PROD 2026-06-15.
-- Dispatches Lead Conversion Signals every 10 min. No-op until Ad Accounts are
-- bound with dataset_id; safe ahead of Meta-side Conversion Leads setup.

INSERT INTO public.cron_config (key, value)
VALUES ('meta_conversion_dispatch_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/meta-conversion-dispatch')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.invoke_meta_conversion_dispatch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE worker_url TEXT; secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'meta_conversion_dispatch_url';
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  IF worker_url IS NULL OR worker_url = '' THEN RETURN; END IF;
  PERFORM net.http_post(
    url := worker_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',COALESCE(secret_val,'')),
    body := '{}'::jsonb
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meta-conversion-dispatch') THEN
    PERFORM cron.unschedule('meta-conversion-dispatch');
  END IF;
  PERFORM cron.schedule('meta-conversion-dispatch', '*/10 * * * *', 'SELECT public.invoke_meta_conversion_dispatch()');
END $$;
