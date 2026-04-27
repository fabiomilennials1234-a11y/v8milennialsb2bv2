-- Migration: cron_job_health_monitor
-- Adds automated monitoring for pg_cron job failures and stale jobs.
-- Queries cron.job_run_details, inserts system_alerts on failure,
-- and schedules a health-check job every 5 minutes.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Health-check RPC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_cron_job_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_window_minutes  int  := 10;   -- look-back window for recent runs
  v_stale_minutes   int  := 15;   -- job is stale if no run in 2× its frequency
  v_rec             record;
  v_alerts_created  int  := 0;
  v_result          jsonb;
BEGIN
  -- ── 1. Jobs with recent failures ──────────────────────────────────────────
  FOR v_rec IN
    SELECT
      j.jobname,
      jrd.status,
      jrd.return_message,
      jrd.start_time,
      jrd.end_time
    FROM cron.job_run_details jrd
    JOIN cron.job             j   ON j.jobid = jrd.jobid
    WHERE jrd.start_time >= NOW() - (v_window_minutes || ' minutes')::interval
      AND jrd.status NOT IN ('succeeded')
  LOOP
    -- Avoid duplicate alerts: skip if an unresolved alert already exists
    IF NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE category   = 'cron_job_failure'
        AND metadata->>'job_name' = v_rec.jobname
        AND resolved_at IS NULL
        AND created_at >= NOW() - INTERVAL '30 minutes'
    ) THEN
      INSERT INTO public.system_alerts (
        organization_id,
        severity,
        category,
        title,
        description,
        metadata
      ) VALUES (
        NULL,  -- system-level alert, not org-scoped
        'critical',
        'cron_job_failure',
        'Cron job falhou: ' || v_rec.jobname,
        'Status: ' || v_rec.status || E'\n' ||
          COALESCE('Mensagem: ' || v_rec.return_message, '') || E'\n' ||
          'Horário: ' || v_rec.start_time::text,
        jsonb_build_object(
          'job_name',      v_rec.jobname,
          'status',        v_rec.status,
          'return_message', v_rec.return_message,
          'start_time',    v_rec.start_time,
          'end_time',      v_rec.end_time
        )
      );
      v_alerts_created := v_alerts_created + 1;
    END IF;
  END LOOP;

  -- ── 2. Stale jobs (should have run but haven't) ────────────────────────────
  -- Only check 1-minute-frequency jobs (most critical cron tier).
  FOR v_rec IN
    SELECT j.jobname, j.schedule, MAX(jrd.start_time) AS last_run
    FROM cron.job             j
    LEFT JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
    WHERE j.active = true
      AND j.schedule IN ('* * * * *', '*/2 * * * *')  -- 1-min and 2-min jobs
    GROUP BY j.jobname, j.schedule
    HAVING MAX(jrd.start_time) < NOW() - (v_stale_minutes || ' minutes')::interval
        OR MAX(jrd.start_time) IS NULL
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE category   = 'cron_job_stale'
        AND metadata->>'job_name' = v_rec.jobname
        AND resolved_at IS NULL
        AND created_at >= NOW() - INTERVAL '30 minutes'
    ) THEN
      INSERT INTO public.system_alerts (
        organization_id,
        severity,
        category,
        title,
        description,
        metadata
      ) VALUES (
        NULL,
        'high',
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
    'checked_at',    NOW(),
    'window_minutes', v_window_minutes,
    'alerts_created', v_alerts_created
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.check_cron_job_health() IS
  'Queries cron.job_run_details for failures and stale jobs, inserts system_alerts. '
  'Called every 5 min by pg_cron job cron-health-monitor.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Diagnostic view: last run per job
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_cron_job_status AS
SELECT
  j.jobname,
  j.schedule,
  j.active,
  jrd.status                           AS last_status,
  jrd.return_message                   AS last_message,
  jrd.start_time                       AS last_run_at,
  jrd.end_time - jrd.start_time        AS last_duration,
  CASE
    WHEN j.schedule = '* * * * *'       THEN 'every 1 min'
    WHEN j.schedule = '*/2 * * * *'     THEN 'every 2 min'
    WHEN j.schedule = '*/5 * * * *'     THEN 'every 5 min'
    WHEN j.schedule LIKE '0 % * * *'    THEN 'daily'
    ELSE j.schedule
  END                                  AS frequency_label,
  EXTRACT(EPOCH FROM (NOW() - jrd.start_time)) / 60 AS minutes_since_last_run
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT status, return_message, start_time, end_time
  FROM cron.job_run_details
  WHERE jobid = j.jobid
  ORDER BY start_time DESC
  LIMIT 1
) jrd ON true
ORDER BY j.jobname;

COMMENT ON VIEW public.v_cron_job_status IS
  'Quick diagnostic: last run status and timing for every pg_cron job. '
  'Query this to debug a stuck job: SELECT * FROM v_cron_job_status WHERE jobname = ''name'';';

-- Grant read to authenticated users so the master dashboard can query it
GRANT SELECT ON public.v_cron_job_status TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Register the monitoring cron job
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_base_url  text;
  v_cron_secret text;
BEGIN
  -- Remove existing job to allow re-run (idempotent)
  PERFORM cron.unschedule('cron-health-monitor')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-health-monitor');

  -- Run check_cron_job_health() directly via SQL (no HTTP needed)
  PERFORM cron.schedule(
    'cron-health-monitor',
    '*/5 * * * *',
    $$SELECT public.check_cron_job_health()$$
  );
END;
$$;
