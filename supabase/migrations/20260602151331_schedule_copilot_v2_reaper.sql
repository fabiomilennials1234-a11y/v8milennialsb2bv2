-- Schedule the copilot v2 stale-processing reaper every minute.
-- Re-drives rows a crashed worker left in 'processing' (visibility timeout 5min).
-- NOT applied to prod by this slice — apply requires explicit CTO auth.
do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron not installed — skipping copilot_v2_reaper schedule'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_reaper') then
    perform cron.unschedule('copilot_v2_reaper');
  end if;
  perform cron.schedule('copilot_v2_reaper', '* * * * *',
    'SELECT public.copilot_v2_reap_stale_processing(5)');
end $outer$;
