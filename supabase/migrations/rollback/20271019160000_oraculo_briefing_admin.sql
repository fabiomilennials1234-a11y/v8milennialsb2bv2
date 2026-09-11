DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-admin-briefing') THEN
      PERFORM cron.unschedule('oraculo-admin-briefing');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-admin-briefing-shrinkage') THEN
      PERFORM cron.unschedule('oraculo-admin-briefing-shrinkage');
    END IF;
  END IF;
END
$cron$;
DROP TRIGGER IF EXISTS trg_oraculo_briefing_acted_by_click ON public.oraculo_action_proposals;
DROP FUNCTION IF EXISTS public.oraculo_admin_briefing_metrics(timestamptz);
DROP FUNCTION IF EXISTS public.measure_oraculo_admin_briefing_shrinkage(timestamptz,integer);
DROP FUNCTION IF EXISTS public.mark_oraculo_briefing_acted_by_click();
DROP FUNCTION IF EXISTS public.oraculo_open_admin_briefing(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_admin_briefing_current(uuid,uuid);
DROP FUNCTION IF EXISTS public.generate_oraculo_admin_briefings(timestamptz,integer);
DROP FUNCTION IF EXISTS public.oraculo_admin_briefing_due_at(uuid,text,timestamptz);
DROP FUNCTION IF EXISTS public.oraculo_admin_briefing_stagger_minute(uuid);
DROP FUNCTION IF EXISTS public.oraculo_admin_briefing_headline(jsonb);
ALTER TABLE public.oraculo_action_proposals DROP COLUMN IF EXISTS briefing_id;
DROP TABLE IF EXISTS public.oraculo_admin_briefing_conversations;
DROP TABLE IF EXISTS public.oraculo_admin_briefing_runs;
DROP TABLE IF EXISTS public.oraculo_admin_briefings;
