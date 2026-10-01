-- rollback/20271101000000_alerta_cron_so_falha_sustentada.sql
--
-- Volta `check_cron_job_health` à regra anterior (alerta em QUALQUER falha nos
-- últimos 10 min, sem auto-resolução). Definição copiada de prod em 2026-10-01,
-- antes do apply (md5 do `pg_get_functiondef`: dabf3b5ed1d8a584b8c426cd12920cad).
--
-- ⚠ Os grants NÃO voltam ao que eram: prod concedia EXECUTE a `authenticated`
-- (qualquer usuário logado disparava a varredura e inseria alertas). Rollback de
-- comportamento não reabre o furo. Quem chama é o pg_cron (postgres).
--
-- ⚠ Alertas resolvidos pela regra nova (`auto_recovered`) e pela limpeza do
-- go-live (`adr-0038-ruido`) ficam resolvidos — este arquivo troca a regra, não
-- desfaz o que passou por ela.

CREATE OR REPLACE FUNCTION public.check_cron_job_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.check_cron_job_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_cron_job_health() FROM anon;
REVOKE ALL ON FUNCTION public.check_cron_job_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_cron_job_health() TO service_role;
