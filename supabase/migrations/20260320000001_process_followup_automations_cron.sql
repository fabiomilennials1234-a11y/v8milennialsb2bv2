-- ============================================
-- CRON JOB: Processar regras de follow-up baseadas em tempo
-- Roda a cada 5 minutos, independente do cron do copiloto
-- ============================================

-- Função que invoca a edge function via pg_net
CREATE OR REPLACE FUNCTION public.invoke_process_followup_automations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  -- URL configurável via tabela cron_config
  SELECT value INTO worker_url FROM public.cron_config
  WHERE key = 'process_followup_automations_url';

  -- Se não configurado, usar URL padrão baseada no SUPABASE_URL
  IF worker_url IS NULL THEN
    SELECT value INTO worker_url FROM public.cron_config
    WHERE key = 'supabase_functions_base_url';
    IF worker_url IS NOT NULL THEN
      worker_url := worker_url || '/process-followup-automations';
    END IF;
  END IF;

  -- Obter secret do cron
  SELECT value INTO secret_val FROM public.cron_config
  WHERE key = 'cron_secret';

  -- Só executa se tiver URL configurada
  IF worker_url IS NOT NULL THEN
    PERFORM net.http_post(
      url := worker_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(secret_val, '')
      ),
      body := '{}'::jsonb
    );
  END IF;
EXCEPTION
  WHEN undefined_function THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
END;
$$;

-- Agendar cron job para rodar a cada 5 minutos
-- Usa DO block para ser idempotente
DO $$
BEGIN
  -- Remover job existente se houver
  PERFORM cron.unschedule('process-followup-automations');
EXCEPTION WHEN OTHERS THEN
  -- Ignora se não existir
  NULL;
END;
$$;

DO $$ BEGIN
  PERFORM cron.schedule(
    'process-followup-automations',
    '*/5 * * * *',
    'SELECT public.invoke_process_followup_automations()'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
