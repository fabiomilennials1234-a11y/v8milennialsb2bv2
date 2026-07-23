-- Schedule copilot-v2-worker every minute (drains copilot_v2_message_queue).
-- Applied to PROD (jsjsmuncfkbsbzqzqhfq) 2026-06-01 via MCP, version 20260601020907.
-- pg_net → edge fn with x-cron-secret; URL + secret from public.cron_config.
create or replace function public.invoke_copilot_v2_worker()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value into v_url    from public.cron_config where key = 'campaign_rule_dispatch_url';
  select value into v_secret from public.cron_config where key = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning '[copilot-v2-worker] cron_config incomplete: url=%, secret_present=%', v_url is not null, v_secret is not null;
    return;
  end if;
  v_url := replace(v_url, 'campaign-rule-dispatch', 'copilot-v2-worker');
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning '[copilot-v2-worker] invoke failed: %', sqlerrm;
end $$;

revoke all on function public.invoke_copilot_v2_worker() from public;
grant execute on function public.invoke_copilot_v2_worker() to service_role;

do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron not installed — skipping copilot_v2_worker schedule'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_worker') then
    perform cron.unschedule('copilot_v2_worker');
  end if;
  perform cron.schedule('copilot_v2_worker', '* * * * *', 'SELECT public.invoke_copilot_v2_worker()');
end $outer$;