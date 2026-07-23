-- Fix check_cron_job_health: schema mismatch com system_alerts.
-- Bugs:
-- 1. INSERT usa coluna "description" que não existe — schema real tem "message"
-- 2. Severity 'high' não está no CHECK — válidos: info|warning|error|critical
-- Migration original 20260927000000 cria função mas schema do system_alerts
-- (mig 20260426010000) é distinto.

CREATE OR REPLACE FUNCTION public.check_cron_job_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_window_minutes  int  := 10;
  v_stale_minutes   int  := 15;
  v_rec             record;
  v_alerts_created  int  := 0;
  v_result          jsonb;
BEGIN
  -- ── 1. Jobs with recent failures ──────────────────────────────────────────
  FOR v_rec IN
    SELECT j.jobname, jrd.status, jrd.return_message, jrd.start_time, jrd.end_time
    FROM cron.job_run_details jrd
    JOIN cron.job j ON j.jobid = jrd.jobid
    WHERE jrd.start_time >= NOW() - (v_window_minutes || ' minutes')::interval
      AND jrd.status NOT IN ('succeeded')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE category = 'cron_job_failure'
        AND metadata->>'job_name' = v_rec.jobname
        AND resolved_at IS NULL
        AND created_at >= NOW() - INTERVAL '30 minutes'
    ) THEN
      INSERT INTO public.system_alerts (
        organization_id, severity, category, title, message, metadata
      ) VALUES (
        NULL,
        'critical',
        'cron_job_failure',
        'Cron job falhou: ' || v_rec.jobname,
        'Status: ' || v_rec.status || E'\n' ||
          COALESCE('Mensagem: ' || v_rec.return_message, '') || E'\n' ||
          'Horário: ' || v_rec.start_time::text,
        jsonb_build_object(
          'job_name', v_rec.jobname,
          'status', v_rec.status,
          'return_message', v_rec.return_message,
          'start_time', v_rec.start_time,
          'end_time', v_rec.end_time
        )
      );
      v_alerts_created := v_alerts_created + 1;
    END IF;
  END LOOP;

  -- ── 2. Stale jobs ─────────────────────────────────────────────────────────
  FOR v_rec IN
    SELECT j.jobname, j.schedule, MAX(jrd.start_time) AS last_run
    FROM cron.job j
    LEFT JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
    WHERE j.active = true
      AND j.schedule IN ('* * * * *', '*/2 * * * *')
    GROUP BY j.jobname, j.schedule
    HAVING MAX(jrd.start_time) < NOW() - (v_stale_minutes || ' minutes')::interval
        OR MAX(jrd.start_time) IS NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE category = 'cron_job_stale'
        AND metadata->>'job_name' = v_rec.jobname
        AND resolved_at IS NULL
        AND created_at >= NOW() - INTERVAL '30 minutes'
    ) THEN
      INSERT INTO public.system_alerts (
        organization_id, severity, category, title, message, metadata
      ) VALUES (
        NULL,
        'error',
        'cron_job_stale',
        'Cron job parado: ' || v_rec.jobname,
        'Última execução: ' || COALESCE(v_rec.last_run::text, 'nunca') ||
          E'\n' || 'Schedule: ' || v_rec.schedule,
        jsonb_build_object(
          'job_name', v_rec.jobname,
          'schedule', v_rec.schedule,
          'last_run', v_rec.last_run
        )
      );
      v_alerts_created := v_alerts_created + 1;
    END IF;
  END LOOP;

  v_result := jsonb_build_object(
    'checked_at', NOW(),
    'window_minutes', v_window_minutes,
    'alerts_created', v_alerts_created
  );

  RETURN v_result;
END;
$$;
