-- ADR-0038 (S7b) — alerta de cron só para falha SUSTENTADA, e que se resolve sozinho.
--
-- Medido em prod em 2026-09-30: `system_alerts` acumulou 19.692 alertas `critical`
-- de `cron_job_failure` em 30 dias (~650/dia), ZERO resolvidos. A regra antiga
-- criava um alerta crítico por QUALQUER falha isolada nos últimos 10 min — e ~0,7%
-- das execuções dos crons de 1 minuto falham com `job startup timeout`, sozinhas,
-- e se recuperam na execução seguinte. O ruído enterrava o sinal: no mesmo dia,
-- 13:05–13:10 UTC, 34 jobs falharam com `connection failed` (banco recusando
-- conexão) e nada distinguia isso do ruído de sempre.
--
-- Regra nova, simulada contra os 7 dias de `cron.job_run_details` de prod antes
-- de escrever (0 alertas no estado normal; pega o incidente das 13:05):
--   · job frequente (≥ 5 execuções nas últimas 2 h): alerta se ≥ 3 das últimas 5
--     falharam;
--   · job esparso (< 5 execuções em 2 h): alerta se a última falhou — uma falha de
--     job horário/diário importa sozinha;
--   · resolve sozinho quando o job volta: frequente com as 3 últimas OK, esparso
--     com a última OK. `resolved_by` fica NULL (quem resolveu foi o sistema) e o
--     motivo vai em metadata.
-- O mesmo para `cron_job_stale`: resolve quando o job voltou a rodar.
--
-- Endurecimento junto: a função é SECURITY DEFINER e estava executável por
-- `authenticated` — qualquer usuário logado disparava a varredura e inseria
-- alertas. Quem chama é o próprio pg_cron (job `cron-health-monitor`, como
-- postgres). Fica só service_role.
--
-- Só schema (guarda F4). A limpeza dos 19.692 alertas abertos é DML e é passo
-- manual do go-live — ver .specs/features/erros-e-observabilidade/SPEC.md (S7b).

CREATE OR REPLACE FUNCTION public.check_cron_job_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  v_window          interval := interval '2 hours';
  v_stale_minutes   int      := 15;
  v_rec             record;
  v_alerts_created  int      := 0;
  v_alerts_resolved int      := 0;
  v_n               int;
BEGIN
  -- ── 1. Falha sustentada ───────────────────────────────────────────────────
  FOR v_rec IN
    WITH runs AS (
      SELECT j.jobname, jrd.status, jrd.return_message, jrd.start_time, jrd.end_time,
             row_number() OVER (PARTITION BY j.jobid ORDER BY jrd.start_time DESC) AS rn,
             count(*)     OVER (PARTITION BY j.jobid)                             AS n_janela
      FROM cron.job j
      JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
      WHERE j.active
        AND jrd.start_time >= now() - v_window
        AND jrd.status IN ('succeeded', 'failed')
    )
    SELECT jobname,
           max(n_janela)                                                   AS n_janela,
           count(*) FILTER (WHERE rn <= 5 AND status = 'failed')           AS falhas_ult5,
           bool_or(rn = 1 AND status = 'failed')                           AS ultima_falhou,
           (array_agg(return_message ORDER BY start_time DESC)
              FILTER (WHERE status = 'failed'))[1]                         AS ultima_mensagem,
           max(start_time) FILTER (WHERE status = 'failed')                AS ultima_falha
    FROM runs
    GROUP BY jobname
  LOOP
    CONTINUE WHEN NOT (
      (v_rec.n_janela >= 5 AND v_rec.falhas_ult5 >= 3)
      OR (v_rec.n_janela < 5 AND v_rec.ultima_falhou)
    );

    -- Um alerta aberto por job basta: sem janela de 30 min, sem reabrir em série.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE category = 'cron_job_failure'
        AND metadata->>'job_name' = v_rec.jobname
        AND resolved_at IS NULL
    );

    INSERT INTO public.system_alerts (organization_id, severity, category, title, message, metadata)
    VALUES (
      NULL,
      'critical',
      'cron_job_failure',
      'Cron job falhando: ' || v_rec.jobname,
      CASE WHEN v_rec.n_janela >= 5
        THEN v_rec.falhas_ult5 || ' das últimas 5 execuções falharam.'
        ELSE 'A última execução falhou.'
      END
        || COALESCE(E'\nMensagem: ' || v_rec.ultima_mensagem, '')
        || COALESCE(E'\nÚltima falha: ' || v_rec.ultima_falha::text, ''),
      jsonb_build_object(
        'job_name',        v_rec.jobname,
        'failures_last_5', v_rec.falhas_ult5,
        'runs_in_window',  v_rec.n_janela,
        'last_message',    v_rec.ultima_mensagem,
        'last_failure_at', v_rec.ultima_falha,
        'rule',            'adr-0038-sustentada'
      )
    );
    v_alerts_created := v_alerts_created + 1;
  END LOOP;

  -- ── 2. Recuperação: fecha o alerta de falha quando o job voltou ──────────
  WITH runs AS (
    SELECT j.jobname, jrd.status,
           row_number() OVER (PARTITION BY j.jobid ORDER BY jrd.start_time DESC) AS rn,
           count(*)     OVER (PARTITION BY j.jobid)                             AS n_janela
    FROM cron.job j
    JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
    WHERE jrd.start_time >= now() - v_window
      AND jrd.status IN ('succeeded', 'failed')
  ), recuperados AS (
    SELECT jobname
    FROM runs
    GROUP BY jobname
    HAVING bool_and(status = 'succeeded') FILTER (WHERE rn <= CASE WHEN n_janela >= 5 THEN 3 ELSE 1 END)
  )
  UPDATE public.system_alerts a
  SET resolved_at = now(),
      metadata    = a.metadata || jsonb_build_object('resolved_reason', 'auto_recovered')
  FROM recuperados r
  WHERE a.category = 'cron_job_failure'
    AND a.resolved_at IS NULL
    AND a.metadata->>'job_name' = r.jobname;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_alerts_resolved := v_alerts_resolved + v_n;

  -- ── 3. Job parado ─────────────────────────────────────────────────────────
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
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.system_alerts
      WHERE category = 'cron_job_stale'
        AND metadata->>'job_name' = v_rec.jobname
        AND resolved_at IS NULL
    );

    INSERT INTO public.system_alerts (organization_id, severity, category, title, message, metadata)
    VALUES (
      NULL,
      'error',
      'cron_job_stale',
      'Cron job parado: ' || v_rec.jobname,
      'Última execução: ' || COALESCE(v_rec.last_run::text, 'nunca') || E'\n' || 'Schedule: ' || v_rec.schedule,
      jsonb_build_object('job_name', v_rec.jobname, 'schedule', v_rec.schedule, 'last_run', v_rec.last_run)
    );
    v_alerts_created := v_alerts_created + 1;
  END LOOP;

  -- Parado que voltou a rodar: resolve.
  UPDATE public.system_alerts a
  SET resolved_at = now(),
      metadata    = a.metadata || jsonb_build_object('resolved_reason', 'auto_recovered')
  WHERE a.category = 'cron_job_stale'
    AND a.resolved_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM cron.job j
      JOIN cron.job_run_details jrd ON jrd.jobid = j.jobid
      WHERE j.jobname = a.metadata->>'job_name'
        AND jrd.start_time >= NOW() - (v_stale_minutes || ' minutes')::interval
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_alerts_resolved := v_alerts_resolved + v_n;

  RETURN jsonb_build_object(
    'checked_at',      now(),
    'window',          v_window,
    'alerts_created',  v_alerts_created,
    'alerts_resolved', v_alerts_resolved
  );
END;
$$;

COMMENT ON FUNCTION public.check_cron_job_health() IS
  'Varre cron.job_run_details e mantém system_alerts: alerta só falha SUSTENTADA (≥3 das últimas 5 execuções; ou a última, em job esparso) e resolve sozinho quando o job volta. Chamada pelo pg_cron (cron-health-monitor). ADR-0038 S7b.';

-- Só o próprio cron (postgres) e o backend chamam. `authenticated` disparava a
-- varredura de fora e inseria alertas.
REVOKE ALL ON FUNCTION public.check_cron_job_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_cron_job_health() FROM anon;
REVOKE ALL ON FUNCTION public.check_cron_job_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_cron_job_health() TO service_role;
