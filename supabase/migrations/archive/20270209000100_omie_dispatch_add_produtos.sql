-- 20270209000100_omie_dispatch_add_produtos.sql
-- S12: adiciona o worker de produtos ao dispatcher do S10 (4º endpoint por org).

INSERT INTO public.cron_config (key, value)
VALUES ('omie_sync_produtos_url', 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/omie-sync-produtos')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

CREATE OR REPLACE FUNCTION public.invoke_omie_sync_dispatch()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  secret_val TEXT;
  url_clientes TEXT;
  url_pedidos TEXT;
  url_financeiro TEXT;
  url_produtos TEXT;
  bucket_count CONSTANT INT := 30;
  r RECORD;
  hdr JSONB;
BEGIN
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  SELECT value INTO url_clientes FROM public.cron_config WHERE key = 'omie_sync_clientes_url';
  SELECT value INTO url_pedidos FROM public.cron_config WHERE key = 'omie_sync_pedidos_url';
  SELECT value INTO url_financeiro FROM public.cron_config WHERE key = 'omie_sync_financeiro_url';
  SELECT value INTO url_produtos FROM public.cron_config WHERE key = 'omie_sync_produtos_url';
  IF url_clientes IS NULL OR url_clientes = '' THEN RETURN; END IF;

  hdr := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', COALESCE(secret_val, ''));

  FOR r IN
    SELECT organization_id
    FROM public.omie_connections
    WHERE status = 'connected'
      AND erp_sync_mode <> 'off'
      AND (abs(hashtext(organization_id::text)) % bucket_count) = (EXTRACT(minute FROM now())::int % bucket_count)
  LOOP
    PERFORM net.http_post(url := url_clientes,   headers := hdr, body := jsonb_build_object('organization_id', r.organization_id));
    PERFORM net.http_post(url := url_pedidos,    headers := hdr, body := jsonb_build_object('organization_id', r.organization_id));
    PERFORM net.http_post(url := url_financeiro, headers := hdr, body := jsonb_build_object('organization_id', r.organization_id));
    IF url_produtos IS NOT NULL AND url_produtos <> '' THEN
      PERFORM net.http_post(url := url_produtos, headers := hdr, body := jsonb_build_object('organization_id', r.organization_id));
    END IF;
  END LOOP;
EXCEPTION
  WHEN undefined_function THEN
    RETURN;
END;
$$;
