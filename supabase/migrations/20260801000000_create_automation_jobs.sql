-- =============================================================================
-- Migration: automation_jobs — tabela unificada de rastreamento de jobs
-- Registra execução de todos os engines: pipe_dispatch, copilot, campaign, etc.
-- Date: 2026-08-01
-- =============================================================================

-- 1. Tabela principal
CREATE TABLE IF NOT EXISTS public.automation_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Origem do job
  source_engine     TEXT NOT NULL CHECK (source_engine IN (
    'pipe_dispatch', 'copilot', 'campaign', 'followup', 'webhook', 'workflow'
  )),

  -- Referência à entidade afetada
  entity_type       TEXT NOT NULL,
  entity_id         UUID NOT NULL,

  -- Referência ao job de origem (ex: scheduled_pipe_messages.id)
  source_table      TEXT,
  source_id         UUID,

  -- Tipo de ação executada
  action_type       TEXT NOT NULL,

  -- Ciclo de vida
  status            TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'failed', 'retrying', 'dead_letter')),

  -- Timing
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ,
  next_retry_at     TIMESTAMPTZ,

  -- Retry
  retry_count       INTEGER NOT NULL DEFAULT 0,
  max_retries       INTEGER NOT NULL DEFAULT 3,

  -- Payload e erro
  payload_snapshot  JSONB,
  error_message     TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Índices
CREATE INDEX IF NOT EXISTS idx_automation_jobs_org_status
  ON public.automation_jobs(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_source
  ON public.automation_jobs(source_engine, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_entity
  ON public.automation_jobs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_dead_letter
  ON public.automation_jobs(status, created_at DESC)
  WHERE status = 'dead_letter';

CREATE INDEX IF NOT EXISTS idx_automation_jobs_retrying
  ON public.automation_jobs(status, next_retry_at)
  WHERE status = 'retrying';

-- 3. RLS
ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_automation_jobs" ON public.automation_jobs;
CREATE POLICY "service_role_full_access_automation_jobs"
  ON public.automation_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "master_admin_read_automation_jobs" ON public.automation_jobs;
CREATE POLICY "master_admin_read_automation_jobs"
  ON public.automation_jobs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.master_users
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- 4. RPC: resumo de jobs para dashboard
CREATE OR REPLACE FUNCTION public.get_jobs_overview(interval_param TEXT DEFAULT '24 hours')
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total',       COUNT(*),
    'success',     COUNT(*) FILTER (WHERE status = 'success'),
    'failed',      COUNT(*) FILTER (WHERE status = 'failed'),
    'dead_letter', COUNT(*) FILTER (WHERE status = 'dead_letter'),
    'retrying',    COUNT(*) FILTER (WHERE status = 'retrying'),
    'running',     COUNT(*) FILTER (WHERE status = 'running')
  )
  FROM public.automation_jobs
  WHERE created_at > NOW() - interval_param::INTERVAL;
$$;

COMMENT ON FUNCTION public.get_jobs_overview IS 'Retorna resumo agregado de automation_jobs para o Operations Center.';

-- 5. Limpeza automática: manter 90 dias
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remover job anterior se existir
    PERFORM cron.unschedule('cleanup-automation-jobs');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-automation-jobs',
      '0 2 * * *',
      $$DELETE FROM public.automation_jobs WHERE created_at < NOW() - INTERVAL '90 days'$$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- 6. pg_cron: retry dead letter jobs a cada 5 minutos
CREATE OR REPLACE FUNCTION public.invoke_retry_dead_letter_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'retry_dead_letter_jobs_url';
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
$$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('retry-dead-letter-jobs');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'retry-dead-letter-jobs',
      '*/5 * * * *',
      'SELECT public.invoke_retry_dead_letter_jobs()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- 7. Inserir URL do worker no cron_config (dev)
INSERT INTO public.cron_config (key, value)
VALUES ('retry_dead_letter_jobs_url', 'https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/retry-dead-letter-jobs')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMENT ON TABLE public.automation_jobs IS 'Rastreamento unificado de todos os jobs de automação. Retém 90 dias.';
COMMENT ON FUNCTION public.invoke_retry_dead_letter_jobs IS 'Invoca Edge Function retry-dead-letter-jobs via pg_net a cada 5 minutos.';
