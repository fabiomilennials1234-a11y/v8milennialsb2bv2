-- Agenda o reaper de ingestão travada (visibility-timeout 10min) a cada minuto.
-- Espelha 20260602151331_schedule_copilot_v2_reaper.sql (op pura de DB, sem pg_net).
-- NÃO aplicar em prod neste slice.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron ausente — skip schedule copilot_v2_ingestion_reaper'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_ingestion_reaper') then
    perform cron.unschedule('copilot_v2_ingestion_reaper');
  end if;
  perform cron.schedule('copilot_v2_ingestion_reaper', '* * * * *',
    'SELECT public.copilot_v2_reap_stale_ingestion(10)');
end $outer$;
