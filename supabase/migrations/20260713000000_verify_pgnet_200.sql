-- Verificar se pg_net agora retorna 200 (antes retornava 401)
-- Também verificar se os itens scheduled foram processados

-- 1. Verificar última resposta HTTP do pg_net
DO $$
DECLARE
  v_resp RECORD;
BEGIN
  RAISE NOTICE '--- Últimas respostas pg_net ---';
  FOR v_resp IN
    SELECT id, status_code, timed_out, error_msg, created,
           left(COALESCE(content, ''), 300) as content_preview
    FROM net._http_response
    ORDER BY created DESC
    LIMIT 5
  LOOP
    RAISE NOTICE 'HTTP[%]: status=% timed_out=% error=% content=%',
      v_resp.id, v_resp.status_code, v_resp.timed_out,
      left(COALESCE(v_resp.error_msg, ''), 100),
      v_resp.content_preview;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro lendo _http_response: %', SQLERRM;
END $$;

-- 2. Estado atual da fila
DO $$
DECLARE
  v_status RECORD;
BEGIN
  RAISE NOTICE '--- Estado da fila ---';
  FOR v_status IN
    SELECT status, COUNT(*) as total FROM scheduled_pipe_messages GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE 'Status %: % itens', v_status.status, v_status.total;
  END LOOP;
END $$;
