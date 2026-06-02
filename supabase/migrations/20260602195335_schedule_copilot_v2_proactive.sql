-- Schedule copilot-v2-proactive every minute (first-touch é evento via lead-webhook;
-- followup + resgate Carteira são cron). pg_net → edge com x-cron-secret.
-- NOT applied to prod by this slice — apply requires explicit CTO auth (Slice 12).
create or replace function public.invoke_copilot_v2_proactive()
returns void language plpgsql security definer set search_path = public as $$
declare v_url text; v_secret text;
begin
  select value into v_url    from public.cron_config where key = 'campaign_rule_dispatch_url';
  select value into v_secret from public.cron_config where key = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning '[copilot-v2-proactive] cron_config incomplete: url=%, secret_present=%', v_url is not null, v_secret is not null;
    return;
  end if;
  v_url := replace(v_url, 'campaign-rule-dispatch', 'copilot-v2-proactive');
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
exception when others then
  raise warning '[copilot-v2-proactive] invoke failed: %', sqlerrm;
end $$;

revoke all on function public.invoke_copilot_v2_proactive() from public;
grant execute on function public.invoke_copilot_v2_proactive() to service_role;

do $outer$
begin
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise notice 'pg_cron not installed — skipping copilot_v2_proactive schedule'; return;
  end if;
  if exists (select 1 from cron.job where jobname='copilot_v2_proactive') then
    perform cron.unschedule('copilot_v2_proactive');
  end if;
  perform cron.schedule('copilot_v2_proactive', '* * * * *', 'SELECT public.invoke_copilot_v2_proactive()');
end $outer$;
