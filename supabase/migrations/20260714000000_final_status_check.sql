-- Verificação final: status dos itens e erros
-- A edge function processa itens com delay entre envios (30-90s)
-- Itens em "processing" por >5min são automaticamente resetados pelo próximo cron run

-- 1. Estado da fila
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

-- 2. Itens com erro
DO $$
DECLARE
  v_item RECORD;
  v_count INT := 0;
BEGIN
  RAISE NOTICE '--- Itens com erro ---';
  FOR v_item IN
    SELECT id, status, error_message, action_type, lead_id
    FROM scheduled_pipe_messages
    WHERE status = 'failed' OR error_message IS NOT NULL
    LIMIT 10
  LOOP
    RAISE NOTICE 'FAILED: id=% status=% action=% err=%',
      v_item.id, v_item.status, v_item.action_type, left(COALESCE(v_item.error_message, 'null'), 150);
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nenhum item com erro encontrado';
  END IF;
END $$;

-- 3. Itens enviados/executados com sucesso
DO $$
DECLARE
  v_item RECORD;
BEGIN
  RAISE NOTICE '--- Itens enviados/executados ---';
  FOR v_item IN
    SELECT id, status, action_type, sent_at, lead_id
    FROM scheduled_pipe_messages
    WHERE status IN ('sent', 'executed')
    ORDER BY sent_at DESC
    LIMIT 10
  LOOP
    RAISE NOTICE 'OK: id=% status=% action=% sent_at=%', v_item.id, v_item.status, v_item.action_type, v_item.sent_at;
  END LOOP;
END $$;

-- 4. Últimas respostas pg_net (confirmar 200s)
DO $$
DECLARE
  v_resp RECORD;
BEGIN
  RAISE NOTICE '--- pg_net responses ---';
  FOR v_resp IN
    SELECT id, status_code, created, left(COALESCE(content, ''), 200) as preview
    FROM net._http_response
    ORDER BY created DESC
    LIMIT 5
  LOOP
    RAISE NOTICE 'HTTP[%]: status=% at=% content=%', v_resp.id, v_resp.status_code, v_resp.created, v_resp.preview;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro: %', SQLERRM;
END $$;
