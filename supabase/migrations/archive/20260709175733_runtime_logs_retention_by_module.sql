-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260709175733  name: runtime_logs_retention_by_module
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.purge_runtime_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.runtime_logs
  WHERE ctid IN (
    SELECT ctid FROM public.runtime_logs
    WHERE module = 'webhook'
      AND created_at < now() - interval '2 days'
    LIMIT 50000
  );

  DELETE FROM public.runtime_logs
  WHERE ctid IN (
    SELECT ctid FROM public.runtime_logs
    WHERE module <> 'webhook'
      AND created_at < now() - interval '30 days'
    LIMIT 50000
  );
END;
$$;

COMMENT ON FUNCTION public.purge_runtime_logs() IS
  'Retencao de runtime_logs: webhook 2 dias, demais modulos 30 dias. Batches de 50k para nao segurar lock. Ver migration 20270115010000.';

REVOKE ALL ON FUNCTION public.purge_runtime_logs() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup_runtime_logs_90d');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-runtime-logs-2d');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-runtime-logs',
  '*/10 * * * *',
  $$SELECT public.purge_runtime_logs()$$
);
