-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

CREATE OR REPLACE FUNCTION public.get_jobs_overview(interval_param text DEFAULT '24 hours'::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_master_user() THEN
    RAISE EXCEPTION 'Forbidden: master access required';
  END IF;

  RETURN (
    SELECT json_build_object(
      'total',       COUNT(*),
      'success',     COUNT(*) FILTER (WHERE status = 'success'),
      'failed',      COUNT(*) FILTER (WHERE status = 'failed'),
      'dead_letter', COUNT(*) FILTER (WHERE status = 'dead_letter'),
      'retrying',    COUNT(*) FILTER (WHERE status = 'retrying'),
      'running',     COUNT(*) FILTER (WHERE status = 'running')
    )
    FROM public.automation_jobs
    WHERE created_at > NOW() - interval_param::INTERVAL
  );
END;
$function$;
