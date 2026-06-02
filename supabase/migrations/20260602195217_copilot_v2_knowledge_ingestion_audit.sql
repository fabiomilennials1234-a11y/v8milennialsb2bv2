-- ============================================================================
-- Copilot v2 — ingestão determinística (audit inbound, incidente VitrineVET
-- 2026-06-01 / #668/#670). copilot_v2_knowledge ganha colunas de auditoria +
-- um reaper de visibility-timeout pra rows presas em 'ingesting'.
-- committed-not-applied: dev pode não ter 20260531214954 — validar antes.
-- NÃO aplicar em prod neste slice.
-- ============================================================================
alter table public.copilot_v2_knowledge
  add column if not exists error_message        text,
  add column if not exists updated_at           timestamptz not null default now(),
  add column if not exists ingesting_started_at timestamptz,
  add column if not exists ingested_at          timestamptz;

create index if not exists idx_copilot_v2_knowledge_status_started
  on public.copilot_v2_knowledge (status, ingesting_started_at);

-- Reaper: rows presas em 'ingesting' além do visibility-timeout (worker morto
-- / timeout de extração) viram 'failed' com motivo determinístico, NUNCA ficam
-- presas. Espelha copilot_v2_reap_stale_processing do 1-H. Retorna count.
create or replace function public.copilot_v2_reap_stale_ingestion(p_timeout_minutes int default 10)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with reaped as (
    update public.copilot_v2_knowledge
       set status = 'failed', updated_at = now(),
           error_message = coalesce(error_message, 'reaped: ingestão travada além do visibility-timeout')
     where status = 'ingesting'
       and ingesting_started_at is not null
       and ingesting_started_at < now() - make_interval(mins => p_timeout_minutes)
    returning 1
  )
  select count(*) into v_count from reaped;
  return v_count;
end $$;

revoke all on function public.copilot_v2_reap_stale_ingestion(int) from public, anon, authenticated;
grant execute on function public.copilot_v2_reap_stale_ingestion(int) to service_role;
