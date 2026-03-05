-- =============================================================================
-- FIX: Corrigir URLs placeholder no cron_config e resetar itens stuck
-- Date: 2026-03-05
-- =============================================================================

-- 1. Corrigir URLs que tinham placeholder PROJECT_REF
UPDATE public.cron_config
SET value = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/process-copilot-followups'
WHERE key = 'process_copilot_followups_url'
  AND (value LIKE '%PROJECT_REF%' OR value = '');

UPDATE public.cron_config
SET value = 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/process-outbound-dispatches'
WHERE key = 'process_outbound_dispatches_url'
  AND (value LIKE '%PROJECT_REF%' OR value = '');

-- 2. Resetar TODOS os itens stuck em 'processing' para 'scheduled'
UPDATE scheduled_pipe_messages
SET status = 'scheduled'
WHERE status = 'processing';

-- 3. Verificar estado após reset
DO $$
DECLARE
  v_status RECORD;
BEGIN
  RAISE NOTICE '--- Estado da fila após reset ---';
  FOR v_status IN
    SELECT status, COUNT(*) as total FROM scheduled_pipe_messages GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE 'Status %: % itens', v_status.status, v_status.total;
  END LOOP;
END $$;

-- 4. Verificar cron_config URLs
DO $$
DECLARE
  v_config RECORD;
BEGIN
  RAISE NOTICE '--- cron_config URLs ---';
  FOR v_config IN
    SELECT key, value FROM public.cron_config WHERE key LIKE '%url%' ORDER BY key
  LOOP
    RAISE NOTICE '%: %', v_config.key, v_config.value;
  END LOOP;
END $$;

-- 5. Disparar processamento imediato via pg_net
DO $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT value INTO v_url FROM public.cron_config WHERE key = 'pipe_rule_dispatch_url';
  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  IF v_url IS NOT NULL AND v_url != '' THEN
    SELECT net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(v_secret, '')
      ),
      body := jsonb_build_object('pipe_type', 'whatsapp')
    ) INTO v_request_id;
    RAISE NOTICE '✅ Disparo iniciado! request_id=%', v_request_id;
  END IF;
END $$;
