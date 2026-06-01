-- ============================================================================
-- Copilot v2 — queue worker claim/complete/fail RPCs.
-- Applied to PROD (jsjsmuncfkbsbzqzqhfq) 2026-06-01 via MCP, version 20260601015114.
-- Atomic claim via FOR UPDATE SKIP LOCKED so concurrent workers never double-process.
-- ============================================================================
create or replace function public.copilot_v2_claim_messages(p_batch_size int default 10)
returns setof public.copilot_v2_message_queue
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.copilot_v2_message_queue q
     set status = 'processing', attempts = q.attempts + 1, updated_at = now()
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

create or replace function public.copilot_v2_complete_message(p_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.copilot_v2_message_queue
     set status = 'processed', updated_at = now()
   where id = p_id;
$$;

-- Retry backoff 1→5→15min; after 3 attempts → dead-letter.
create or replace function public.copilot_v2_fail_message(p_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_attempts int; v_org uuid; v_phone text; v_content text; v_trace uuid;
begin
  select attempts, organization_id, canonical_phone, content, trace_id
    into v_attempts, v_org, v_phone, v_content, v_trace
    from public.copilot_v2_message_queue where id = p_id;

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

revoke all on function public.copilot_v2_claim_messages(int) from public, anon, authenticated;
revoke all on function public.copilot_v2_complete_message(uuid) from public, anon, authenticated;
revoke all on function public.copilot_v2_fail_message(uuid, text) from public, anon, authenticated;
