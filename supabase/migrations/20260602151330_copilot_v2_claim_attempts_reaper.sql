-- ============================================================================
-- Copilot v2 — claim hardening (#22): attempts bumped on FAILURE not claim,
-- plus a visibility-timeout reaper that re-drives stale 'processing' rows.
--
-- Supersedes the claim/fail RPCs from 20260601015114 (immutable; re-created
-- here). NOT applied to prod by this slice — apply requires explicit CTO auth.
-- ============================================================================

-- (a) Claim no longer bumps attempts (a claim is not a failure). Same atomic
--     FOR UPDATE SKIP LOCKED selection as before.
create or replace function public.copilot_v2_claim_messages(p_batch_size int default 10)
returns setof public.copilot_v2_message_queue
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.copilot_v2_message_queue q
     set status = 'processing', updated_at = now()
   where q.id in (
     select id from public.copilot_v2_message_queue
      where status = 'pending'
         or (status = 'retry' and (next_retry_at is null or next_retry_at <= now()))
      order by created_at
      for update skip locked
      limit p_batch_size
   )
  returning q.*;
end $$;

-- (a) Failure increments attempts, THEN decides retry vs DLQ. attempts now
--     counts real failures, so a transient crash never burns a retry.
create or replace function public.copilot_v2_fail_message(p_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int; v_org uuid; v_phone text; v_content text; v_trace uuid;
begin
  update public.copilot_v2_message_queue
     set attempts = attempts + 1, updated_at = now()
   where id = p_id
  returning attempts, organization_id, canonical_phone, content, trace_id
    into v_attempts, v_org, v_phone, v_content, v_trace;

  if v_attempts is null then
    return; -- row vanished (cascade delete) — nothing to do
  end if;

  if v_attempts >= 3 then
    update public.copilot_v2_message_queue set status='dead', last_error=p_error, updated_at=now() where id=p_id;
    insert into public.copilot_v2_dlq (organization_id, queue_id, canonical_phone, content, trace_id, reason)
    values (v_org, p_id, v_phone, v_content, v_trace, p_error);
  else
    update public.copilot_v2_message_queue
       set status='retry', last_error=p_error,
           next_retry_at = now() + (case v_attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' else interval '15 minutes' end),
           updated_at=now()
     where id=p_id;
  end if;
end $$;

-- (b) Reaper: return rows stuck in 'processing' past the visibility timeout
--     (crashed/timed-out worker) to 'retry' so they are re-driven. Does NOT
--     bump attempts (it was never a real failure). Returns count for logging.
create or replace function public.copilot_v2_reap_stale_processing(p_timeout_minutes int default 5)
returns int
language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  with reaped as (
    update public.copilot_v2_message_queue
       set status = 'retry', next_retry_at = now(), updated_at = now(),
           last_error = coalesce(last_error, 'reaped: stale processing (visibility timeout)')
     where status = 'processing'
       and updated_at < now() - make_interval(mins => p_timeout_minutes)
    returning 1
  )
  select count(*) into v_count from reaped;
  return v_count;
end $$;

revoke all on function public.copilot_v2_claim_messages(int) from public, anon, authenticated;
revoke all on function public.copilot_v2_fail_message(uuid, text) from public, anon, authenticated;
revoke all on function public.copilot_v2_reap_stale_processing(int) from public, anon, authenticated;
grant execute on function public.copilot_v2_reap_stale_processing(int) to service_role;
