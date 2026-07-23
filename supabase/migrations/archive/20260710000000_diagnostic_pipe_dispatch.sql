-- DIAGNOSTIC: Verificar estado dos disparos de pipe
-- Esta migration é apenas diagnóstica (não altera nada permanente)

-- 1. Verificar extensões
DO $$
DECLARE
  v_ext RECORD;
BEGIN
  FOR v_ext IN SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_net', 'pg_cron')
  LOOP
    RAISE NOTICE 'Extension: % v%', v_ext.extname, v_ext.extversion;
  END LOOP;
END $$;

-- 2. Verificar cron jobs
DO $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE '%pipe%' OR jobname LIKE '%dispatch%' OR jobname LIKE '%campaign%'
  LOOP
    RAISE NOTICE 'CronJob: [%] % schedule=% cmd=%', v_job.jobid, v_job.jobname, v_job.schedule, left(v_job.command, 80);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao ler cron.job: %', SQLERRM;
END $$;

-- 3. Verificar pg_net responses (últimas chamadas HTTP)
DO $$
DECLARE
  v_resp RECORD;
  v_count INT := 0;
BEGIN
  FOR v_resp IN
    SELECT id, status_code, url, created_at
    FROM net._http_response
    ORDER BY created_at DESC
    LIMIT 15
  LOOP
    RAISE NOTICE 'HTTP Response: id=% status=% url=% at=%', v_resp.id, v_resp.status_code, left(v_resp.url, 80), v_resp.created_at;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nenhuma resposta HTTP encontrada em net._http_response';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao ler net._http_response: %', SQLERRM;
END $$;

-- 4. Verificar cron job run details (últimas execuções)
DO $$
DECLARE
  v_detail RECORD;
  v_count INT := 0;
BEGIN
  FOR v_detail IN
    SELECT jobid, jobname, status, return_message, start_time, end_time
    FROM cron.job_run_details
    WHERE jobname LIKE '%pipe%' OR jobname LIKE '%dispatch%'
    ORDER BY start_time DESC
    LIMIT 10
  LOOP
    RAISE NOTICE 'CronRun: [%] % status=% msg=% start=% end=%', v_detail.jobid, v_detail.jobname, v_detail.status, left(v_detail.return_message, 100), v_detail.start_time, v_detail.end_time;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nenhuma execução de cron encontrada para pipe/dispatch';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao ler cron.job_run_details: %', SQLERRM;
END $$;

-- 5. Verificar estado da fila
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

-- 6. Testar manualmente o claim (sem enviar - apenas verificar se funciona)
DO $$
DECLARE
  v_claimed UUID[];
  v_count INT;
BEGIN
  -- Tentar clamar 1 item
  SELECT array_agg(claimed_id) INTO v_claimed
  FROM claim_pipe_dispatch_batch('whatsapp', 1);

  v_count := COALESCE(array_length(v_claimed, 1), 0);
  RAISE NOTICE 'Claim test: % item(s) claimed', v_count;

  -- Resetar de volta para scheduled (não queremos processar aqui)
  IF v_count > 0 THEN
    UPDATE scheduled_pipe_messages SET status = 'scheduled' WHERE id = ANY(v_claimed);
    RAISE NOTICE 'Reset: % item(s) back to scheduled', v_count;
  END IF;
END $$;

-- 7. Verificar CRON_SECRET env na edge function (testar chamada)
DO $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_request_id BIGINT;
BEGIN
  SELECT value INTO v_url FROM cron_config WHERE key = 'pipe_rule_dispatch_url';
  SELECT value INTO v_secret FROM cron_config WHERE key = 'cron_secret';

  IF v_url IS NOT NULL AND v_url != '' THEN
    -- Fazer uma chamada de teste via pg_net
    SELECT net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', COALESCE(v_secret, '')
      ),
      body := jsonb_build_object('pipe_type', 'whatsapp')
    ) INTO v_request_id;
    RAISE NOTICE 'pg_net test call sent! request_id=% url=% secret_len=%', v_request_id, v_url, length(v_secret);
  ELSE
    RAISE NOTICE '⚠️  pipe_rule_dispatch_url não configurada!';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro ao chamar pg_net: %', SQLERRM;
END $$;
