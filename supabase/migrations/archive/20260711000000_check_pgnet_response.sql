-- Verificar respostas do pg_net e detalhes dos itens stuck

-- 1. pg_net responses (colunas corretas)
DO $$
DECLARE
  v_resp RECORD;
  v_count INT := 0;
BEGIN
  FOR v_resp IN
    SELECT id, status_code, content, timed_out, error_msg, created
    FROM net._http_response
    ORDER BY created DESC
    LIMIT 10
  LOOP
    RAISE NOTICE 'HTTP[%]: status=% timed_out=% error=% content=%',
      v_resp.id, v_resp.status_code, v_resp.timed_out,
      left(COALESCE(v_resp.error_msg, ''), 100),
      left(COALESCE(v_resp.content, ''), 200);
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nenhuma resposta HTTP encontrada';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Tentar com colunas alternativas
  RAISE NOTICE 'Erro lendo _http_response: %. Tentando listar colunas...', SQLERRM;
  FOR v_resp IN
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'net' AND table_name = '_http_response'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  column: % (%)', v_resp.column_name, v_resp.data_type;
  END LOOP;
END $$;

-- 2. Cron job run details (colunas corretas)
DO $$
DECLARE
  v_detail RECORD;
  v_count INT := 0;
BEGIN
  FOR v_detail IN
    SELECT runid, jobid, job_pid, status, return_message, start_time, end_time
    FROM cron.job_run_details
    ORDER BY start_time DESC
    LIMIT 10
  LOOP
    RAISE NOTICE 'CronRun[%]: jobid=% status=% msg=% start=%',
      v_detail.runid, v_detail.jobid, v_detail.status,
      left(COALESCE(v_detail.return_message, ''), 120), v_detail.start_time;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nenhuma execução de cron encontrada';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Erro lendo job_run_details: %', SQLERRM;
  FOR v_detail IN
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'cron' AND table_name = 'job_run_details'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  column: % (%)', v_detail.column_name, v_detail.data_type;
  END LOOP;
END $$;

-- 3. Detalhes dos itens stuck em processing
DO $$
DECLARE
  v_item RECORD;
BEGIN
  RAISE NOTICE '--- Itens stuck em processing ---';
  FOR v_item IN
    SELECT id, pipe_type, action_type, lead_id, template_id, whatsapp_instance_id, scheduled_at, error_message
    FROM scheduled_pipe_messages
    WHERE status = 'processing'
    LIMIT 5
  LOOP
    RAISE NOTICE 'PROCESSING: id=% pipe=% action=% lead=% template=% instance=% sched=% err=%',
      v_item.id, v_item.pipe_type, v_item.action_type, v_item.lead_id,
      v_item.template_id, v_item.whatsapp_instance_id, v_item.scheduled_at,
      COALESCE(v_item.error_message, 'null');
  END LOOP;
END $$;

-- 4. Verificar se o template referenciado existe
DO $$
DECLARE
  v_item RECORD;
  v_template RECORD;
BEGIN
  RAISE NOTICE '--- Verificando templates dos itens ---';
  FOR v_item IN
    SELECT DISTINCT template_id FROM scheduled_pipe_messages WHERE template_id IS NOT NULL LIMIT 5
  LOOP
    SELECT id, name, content, message_type INTO v_template
    FROM campaign_templates WHERE id = v_item.template_id;
    IF v_template.id IS NULL THEN
      RAISE NOTICE '❌ Template % NÃO encontrado!', v_item.template_id;
    ELSE
      RAISE NOTICE '✅ Template %: name=% type=% content=%', v_template.id, v_template.name, v_template.message_type, left(COALESCE(v_template.content, ''), 60);
    END IF;
  END LOOP;
END $$;

-- 5. Verificar instância WhatsApp
DO $$
DECLARE
  v_inst RECORD;
BEGIN
  RAISE NOTICE '--- Instâncias WhatsApp ---';
  FOR v_inst IN
    SELECT id, instance_name, status FROM whatsapp_instances LIMIT 5
  LOOP
    RAISE NOTICE 'Instance: id=% name=% status=%', v_inst.id, v_inst.instance_name, v_inst.status;
  END LOOP;
END $$;
