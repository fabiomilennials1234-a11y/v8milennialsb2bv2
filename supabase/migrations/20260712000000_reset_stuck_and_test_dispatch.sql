-- =============================================================================
-- FIX: Resetar itens stuck em 'processing' e testar chamada pg_net
-- Agora que pipe-rule-dispatch foi redeployada sem JWT verification,
-- as chamadas pg_net devem retornar 200.
-- Date: 2026-03-05
-- =============================================================================

-- 1. Resetar itens stuck em 'processing' de volta para 'scheduled'
UPDATE scheduled_pipe_messages
SET status = 'scheduled', error_message = NULL
WHERE status = 'processing';

-- 2. Verificar estado atual da fila
DO $$
DECLARE
  v_status RECORD;
BEGIN
  RAISE NOTICE '--- Estado da fila scheduled_pipe_messages ---';
  FOR v_status IN
    SELECT status, COUNT(*) as total FROM scheduled_pipe_messages GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE 'Status %: % itens', v_status.status, v_status.total;
  END LOOP;
END $$;

-- 3. Testar chamada pg_net (agora deve retornar 200)
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
    RAISE NOTICE '✅ pg_net call sent! request_id=% url=%', v_request_id, v_url;
  ELSE
    RAISE NOTICE '⚠️ pipe_rule_dispatch_url não configurada!';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro pg_net: %', SQLERRM;
END $$;
