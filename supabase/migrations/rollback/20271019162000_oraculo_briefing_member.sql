DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='oraculo-member-briefing') THEN
      PERFORM cron.unschedule('oraculo-member-briefing');
    END IF;
  END IF;
END $cron$;
DROP FUNCTION IF EXISTS public.oraculo_open_member_briefing(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_member_briefing_current(uuid,uuid);
DROP FUNCTION IF EXISTS public.generate_oraculo_member_briefings(timestamptz,integer);
DROP FUNCTION IF EXISTS public.oraculo_member_briefing_content(text,jsonb);
DROP FUNCTION IF EXISTS public.oraculo_member_briefing_worklist(uuid,uuid);
DROP FUNCTION IF EXISTS public.oraculo_member_briefing_headline(jsonb);
DROP FUNCTION IF EXISTS public.oraculo_member_briefing_due_at(text,timestamptz);
DROP TABLE IF EXISTS public.oraculo_member_briefing_conversations;
DROP TABLE IF EXISTS public.oraculo_member_briefing_runs;
DROP TABLE IF EXISTS public.oraculo_member_briefings;
