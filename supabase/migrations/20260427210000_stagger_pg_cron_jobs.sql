-- Stagger pg_cron jobs minutely para evitar lock contention em cron.job_run_details
-- e nos workers que iniciam transações simultâneas no segundo :00 de cada minuto.
--
-- Problema: 8 jobs com schedule '* * * * *' disparam todos no mesmo segundo:
--   12:00:00 → process-webhook-deliveries + process-ai-actions + workflow + ...
--   12:01:00 → mesmos 8 jobs
--
-- Em 30 orgs hoje funciona. Em 80+ orgs vai engasgar:
--   - Lock contention em cron.job_run_details (audit log do pg_cron)
--   - Workers brigando por pool de conexão
--   - net.http_post em rajada estourando rate limit interno do Supabase
--
-- Fix: cada job ganha pg_sleep(N) prefixado, com N distribuído em 0-35s.
--   - Mantém frequência minutely (SLA igual)
--   - Comando original preservado byte-a-byte (não reescreve com assumções)
--   - net.http_post é fire-and-forget (volta em ms), pg_sleep não bloqueia muito
--   - Carga distribuída ao longo dos primeiros 35s da janela de 60s
--
-- Distribuição:
--   :00  process-webhook-deliveries
--   :05  process-ai-actions
--   :10  process-workflow-executions
--   :15  workflow-cron-triggers
--   :20  campaign-rule-dispatch
--   :25  pipe-rule-dispatch
--   :30  process-scheduled-user-messages
--   :35  history-sync-worker
--
-- Como reverter: rerun migration com SLEEP_OFFSETS todos = 0.
-- Idempotente: pega o comando atual de cron.job e prefixa pg_sleep só se ainda
-- não estiver prefixado (detecta marcador "-- staggered:").

DO $outer$
DECLARE
  v_jobs JSONB := jsonb_build_array(
    jsonb_build_object('name', 'process-webhook-deliveries',     'sleep', 0),
    jsonb_build_object('name', 'process-ai-actions',             'sleep', 5),
    jsonb_build_object('name', 'process-workflow-executions',    'sleep', 10),
    jsonb_build_object('name', 'workflow-cron-triggers',         'sleep', 15),
    jsonb_build_object('name', 'campaign-rule-dispatch',         'sleep', 20),
    jsonb_build_object('name', 'pipe-rule-dispatch',             'sleep', 25),
    jsonb_build_object('name', 'process-scheduled-user-messages','sleep', 30),
    jsonb_build_object('name', 'history-sync-worker',            'sleep', 35)
  );
  v_job        JSONB;
  v_jobname    TEXT;
  v_sleep      INT;
  v_command    TEXT;
  v_new_cmd    TEXT;
  v_existing   RECORD;
  v_applied    INT := 0;
  v_skipped    INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not present — skipping stagger migration';
    RETURN;
  END IF;

  FOR v_job IN SELECT * FROM jsonb_array_elements(v_jobs) LOOP
    v_jobname := v_job->>'name';
    v_sleep   := (v_job->>'sleep')::INT;

    SELECT jobid, schedule, command INTO v_existing FROM cron.job WHERE jobname = v_jobname;
    IF NOT FOUND THEN
      RAISE NOTICE 'Job % not found in cron.job, skipping', v_jobname;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Idempotência: se já tem marcador "-- staggered:", remove e reaplica
    v_command := v_existing.command;
    v_command := regexp_replace(v_command, '^--\s*staggered:\d+s\s*\n', '', 'n');
    v_command := regexp_replace(v_command, '^SELECT\s+pg_sleep\(\d+\)\s*;\s*', '', 'i');

    IF v_sleep > 0 THEN
      v_new_cmd := format(
        '-- staggered:%ss%s' || E'\n' || 'SELECT pg_sleep(%s); %s',
        v_sleep, '', v_sleep, v_command
      );
    ELSE
      v_new_cmd := format('-- staggered:0s%s' || E'\n' || '%s', '', v_command);
    END IF;

    PERFORM cron.unschedule(v_jobname);
    PERFORM cron.schedule(v_jobname, v_existing.schedule, v_new_cmd);
    v_applied := v_applied + 1;
  END LOOP;

  RAISE NOTICE 'Stagger migration: applied=% skipped=%', v_applied, v_skipped;
END $outer$;
