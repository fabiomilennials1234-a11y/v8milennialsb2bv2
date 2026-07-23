-- pg_cron schedule para event-dispatcher (slice 19 event-bus piloto).
--
-- Roda 1/min, consome domain_events.status = 'pending', faz fan-out
-- para handlers registrados em supabase/functions/_shared/events/registry.ts.
--
-- Pré-requisitos:
--   1. `event_dispatcher_url` em public.cron_config
--   2. `cron_secret` em public.cron_config (mesmo do CRON_SECRET das edge fns)
--
-- Exemplo de seed (apenas em dev — substituir PROJECT_REF):
--   INSERT INTO public.cron_config (key, value) VALUES
--     ('event_dispatcher_url', 'https://PROJECT_REF.supabase.co/functions/v1/event-dispatcher'),
--     ('cron_secret', '<segredo>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- NÃO aplicar em prod nesta slice. Aplicação coordenada após smoke em dev.

CREATE OR REPLACE FUNCTION public.invoke_event_dispatcher()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'event_dispatcher_url';
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
  WHEN undefined_function THEN
    -- pg_net não instalado (dev local sem extensão) — silencia
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$$;

COMMENT ON FUNCTION public.invoke_event_dispatcher IS
  'Slice 19 event-bus. Chama edge function event-dispatcher para drenar '
  'domain_events pending. Configure event_dispatcher_url e cron_secret em cron_config.';

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotente: unschedule + schedule garante 1 entrada única.
    BEGIN
      PERFORM cron.unschedule('event-dispatcher');
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    PERFORM cron.schedule(
      'event-dispatcher',
      '* * * * *',
      'SELECT public.invoke_event_dispatcher()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END
$outer$;
