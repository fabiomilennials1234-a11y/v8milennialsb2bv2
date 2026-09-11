DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-benchmark-weekly') THEN
      PERFORM cron.unschedule('oraculo-benchmark-weekly');
    END IF;
  END IF;
END
$cron$;

DROP TRIGGER IF EXISTS trg_initialize_oraculo_benchmark_on_reactivation
  ON public.organizations;
DROP TRIGGER IF EXISTS trg_initialize_oraculo_benchmark_snapshot
  ON public.organizations;
DROP FUNCTION IF EXISTS public.oraculo_benchmark(uuid);
DROP FUNCTION IF EXISTS public.initialize_oraculo_benchmark_snapshot();
DROP FUNCTION IF EXISTS public.refresh_oraculo_benchmark_weekly(date);
DROP FUNCTION IF EXISTS public.oraculo_benchmark_comparison(numeric,numeric);
DROP FUNCTION IF EXISTS public.oraculo_benchmark_week_is_closed(date,timestamptz,text);
DROP TABLE IF EXISTS public.oraculo_benchmark_weekly;
