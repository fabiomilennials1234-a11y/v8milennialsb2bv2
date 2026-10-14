-- Rollback of 20271121000000_toth_cobrancas_full_diario.sql.
-- Unschedules the daily full sweep, restores invoke_toth_sync(TEXT) as of prod
-- 2026-10-14 (body of 20270821140000_toth_cron_sync.sql) and drops the two
-- columns.
-- ORDER MATTERS: deploy toth-sync-cobrancas WITHOUT cobrancas_full_cursor /
-- last_cobrancas_full_sweep_at in its select first. Dropping the columns while
-- the edge function still selects them makes the select fail → `conn` null →
-- "Nenhuma conexão ativa" on EVERY run (window included).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('toth-sync-cobrancas-full-diario')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'toth-sync-cobrancas-full-diario');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.invoke_toth_sync(TEXT, JSONB);

CREATE FUNCTION public.invoke_toth_sync(p_fn TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_org    RECORD;
BEGIN
  IF to_regclass('public.toth_connections') IS NULL THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/' || p_fn)
    INTO v_url
    FROM public.cron_config
   WHERE value LIKE 'https://%/functions/v1/%'
   ORDER BY key
   LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
    RETURN;
  END IF;

  FOR v_org IN
    SELECT organization_id
      FROM public.toth_connections
     WHERE status = 'connected'
       AND erp_sync_mode <> 'off'
  LOOP
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-secret', COALESCE(v_secret, '')
                 ),
      body    := jsonb_build_object('organization_id', v_org.organization_id)
    );
  END LOOP;
EXCEPTION
  WHEN invalid_schema_name THEN RETURN;
  WHEN undefined_function  THEN RETURN;
  WHEN undefined_column    THEN RETURN;
  WHEN undefined_table     THEN RETURN;
END;
$$;

COMMENT ON FUNCTION public.invoke_toth_sync(TEXT) IS
  'Dispara uma sincronização do Toth por organização conectada. Resolve a URL a partir do cron_config do próprio ambiente.';

REVOKE ALL     ON FUNCTION public.invoke_toth_sync(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_toth_sync(TEXT) TO service_role;

ALTER TABLE public.toth_connections
  DROP COLUMN IF EXISTS cobrancas_full_cursor,
  DROP COLUMN IF EXISTS last_cobrancas_full_sweep_at;

COMMIT;
