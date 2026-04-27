-- Verificação de progresso dos disparos

-- 1. Estado da fila
DO $$
DECLARE
  v_status RECORD;
BEGIN
  RAISE NOTICE '--- Estado da fila ---';
  FOR v_status IN
    SELECT status, COUNT(*) as total FROM scheduled_pipe_messages GROUP BY status ORDER BY status
  LOOP
    RAISE NOTICE '%: %', v_status.status, v_status.total;
  END LOOP;
END $$;

-- 2. Últimos envios
DO $$
DECLARE
  v_item RECORD;
BEGIN
  RAISE NOTICE '--- Últimos envios ---';
  FOR v_item IN
    SELECT spm.id, spm.status, spm.action_type, spm.sent_at, spm.error_message,
           l.name as lead_name, l.phone as lead_phone
    FROM scheduled_pipe_messages spm
    LEFT JOIN leads l ON l.id = spm.lead_id
    WHERE spm.status IN ('sent', 'executed', 'failed')
    ORDER BY spm.sent_at DESC NULLS LAST
    LIMIT 15
  LOOP
    RAISE NOTICE '%: % action=% lead=% phone=% at=% err=%',
      v_item.status, v_item.id, v_item.action_type,
      v_item.lead_name, v_item.lead_phone,
      v_item.sent_at, COALESCE(v_item.error_message, '');
  END LOOP;
END $$;

-- 3. Últimas respostas pg_net
DO $$
DECLARE
  v_resp RECORD;
BEGIN
  RAISE NOTICE '--- pg_net ---';
  FOR v_resp IN
    SELECT id, status_code, created, left(COALESCE(content, ''), 250) as preview
    FROM net._http_response
    ORDER BY created DESC
    LIMIT 5
  LOOP
    RAISE NOTICE 'HTTP[%]: %  %', v_resp.id, v_resp.status_code, v_resp.preview;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '%', SQLERRM;
END $$;
