-- =============================================================================
-- Migration: pending_ai_actions — fila de ações do Copilot
-- Garante idempotência, retry com backoff, e concorrência controlada.
-- Date: 2026-07-31
-- =============================================================================

-- 1. Criar tabela (IF NOT EXISTS para compatibilidade com bancos existentes)
CREATE TABLE IF NOT EXISTS public.pending_ai_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  lead_id UUID,
  conversation_id UUID,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  idempotency_key TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Adicionar colunas que podem não existir em tabelas pré-existentes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_ai_actions' AND column_name = 'retry_count') THEN
    ALTER TABLE public.pending_ai_actions ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_ai_actions' AND column_name = 'next_retry_at') THEN
    ALTER TABLE public.pending_ai_actions ADD COLUMN next_retry_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_ai_actions' AND column_name = 'processed_at') THEN
    ALTER TABLE public.pending_ai_actions ADD COLUMN processed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_ai_actions' AND column_name = 'error_message') THEN
    ALTER TABLE public.pending_ai_actions ADD COLUMN error_message TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_ai_actions' AND column_name = 'idempotency_key') THEN
    ALTER TABLE public.pending_ai_actions ADD COLUMN idempotency_key TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pending_ai_actions' AND column_name = 'conversation_id') THEN
    ALTER TABLE public.pending_ai_actions ADD COLUMN conversation_id UUID;
  END IF;
END $$;

-- 3. Índices para performance do worker
CREATE INDEX IF NOT EXISTS idx_pending_ai_actions_claim
  ON pending_ai_actions (status, next_retry_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_pending_ai_actions_concurrency
  ON pending_ai_actions (lead_id, action_type, status)
  WHERE status = 'processing';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_ai_actions_idempotency
  ON pending_ai_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('pending', 'processing');

-- 4. RPC: claim atômico de batch com FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_pending_ai_actions(batch_size INT DEFAULT 10)
RETURNS SETOF public.pending_ai_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE pending_ai_actions
  SET status = 'processing',
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM pending_ai_actions
    WHERE status = 'pending'
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  RETURNING *;
END;
$$;

-- 5. RPC: verificar se há ação concorrente para mesmo lead + action_type
CREATE OR REPLACE FUNCTION public.has_concurrent_ai_action(
  p_lead_id UUID,
  p_action_type TEXT,
  p_exclude_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pending_ai_actions
    WHERE lead_id = p_lead_id
      AND action_type = p_action_type
      AND status = 'processing'
      AND id != p_exclude_id
  );
$$;

-- 6. RLS: apenas service_role acessa
ALTER TABLE public.pending_ai_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access" ON public.pending_ai_actions;
CREATE POLICY "service_role_full_access"
  ON public.pending_ai_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 7. pg_cron: invocar worker a cada 1 minuto
CREATE OR REPLACE FUNCTION public.invoke_process_ai_actions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  worker_url TEXT;
  secret_val TEXT;
BEGIN
  SELECT value INTO worker_url FROM public.cron_config WHERE key = 'process_ai_actions_url';
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
    -- Remover job anterior se existir
    PERFORM cron.unschedule('process-ai-actions');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'process-ai-actions',
      '* * * * *',
      'SELECT public.invoke_process_ai_actions()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $outer$;

-- 8. Inserir URL do worker no cron_config (dev)
INSERT INTO public.cron_config (key, value)
VALUES ('process_ai_actions_url', 'https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/process-ai-actions')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

COMMENT ON TABLE public.pending_ai_actions IS 'Fila de ações do Copilot AI. Processada pelo worker process-ai-actions a cada 1 minuto.';
COMMENT ON FUNCTION public.claim_pending_ai_actions IS 'Claim atômico de batch de ações pendentes com FOR UPDATE SKIP LOCKED.';
COMMENT ON FUNCTION public.invoke_process_ai_actions IS 'Invoca Edge Function process-ai-actions via pg_net. Configure process_ai_actions_url em cron_config.';
