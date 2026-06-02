-- ============================================================================
-- Copilot v2 — handoff dispatch (Slice 5).
--
-- Idempotent, org-scoped fan-out of a transfer_to_human notification:
--   - in-app: insert one row per target user into public.notifications
--   - whatsapp: queue a pending dispatch row (sent by the worker to the member's
--     opt-in phone) + keep the legacy handoff_notify_phones group path
-- Idempotency: a STABLE key (transfer:{org}:{lead}:{trace}) — NOT the v1 minute
-- time-bucket (#26). The unique on (organization_id, idempotency_key) collapses
-- retries to exactly one dispatch.
--
-- team_members.phone ALREADY EXISTS (nullable) — NOT recreated here; we only
-- formalize the opt-in read surface. NOT applied to prod by this slice.
-- ============================================================================

-- Audit/queue row for one handoff dispatch (idempotent).
create table if not exists public.copilot_v2_handoff_notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_id          uuid,
  trace_id         uuid,
  idempotency_key  text not null,
  reason           text,
  summary          text,
  tier             text,
  target_user_ids  uuid[] not null default '{}',
  whatsapp_phones  text[] not null default '{}',   -- member opt-in phones + legacy groups
  whatsapp_status  text not null default 'pending', -- pending | sent | failed
  created_at       timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists idx_copilot_v2_handoff_wa_pending
  on public.copilot_v2_handoff_notifications (whatsapp_status, created_at)
  where whatsapp_status = 'pending';

alter table public.copilot_v2_handoff_notifications enable row level security;
-- org-scoped read for the wizard/observability; writes via SECURITY DEFINER RPC.
do $$ begin
  create policy copilot_v2_handoff_org_read on public.copilot_v2_handoff_notifications
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Idempotent dispatch: dedup by stable key → fan out in-app + queue WhatsApp.
-- org_id is supplied by the trusted edge context, NEVER the LLM/payload.
create or replace function public.copilot_v2_dispatch_handoff(
  p_org_id          uuid,
  p_lead_id         uuid,
  p_trace_id        uuid,
  p_idempotency_key text,
  p_reason          text,
  p_summary         text,
  p_tier            text,
  p_target_user_ids uuid[],
  p_whatsapp_phones text[],
  p_title           text,
  p_link            text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_uid uuid;
begin
  insert into public.copilot_v2_handoff_notifications
    (organization_id, lead_id, trace_id, idempotency_key, reason, summary, tier, target_user_ids, whatsapp_phones)
  values
    (p_org_id, p_lead_id, p_trace_id, p_idempotency_key, p_reason, p_summary, p_tier,
     coalesce(p_target_user_ids, '{}'), coalesce(p_whatsapp_phones, '{}'))
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    return 'already_dispatched';  -- idempotent: a prior dispatch won
  end if;

  -- In-app: one notification per target user (the AlertsDropdown reads by user_id).
  foreach v_uid in array coalesce(p_target_user_ids, '{}') loop
    insert into public.notifications (organization_id, user_id, type, title, description, lead_id, link)
    values (p_org_id, v_uid, 'transfer_to_human', p_title,
            coalesce(p_summary, p_reason), p_lead_id, coalesce(p_link, '/pipe-whatsapp'));
  end loop;

  return 'dispatched';
end $$;

revoke all on function public.copilot_v2_dispatch_handoff(uuid, uuid, uuid, text, text, text, text, uuid[], text[], text, text) from public, anon, authenticated;
grant execute on function public.copilot_v2_dispatch_handoff(uuid, uuid, uuid, text, text, text, text, uuid[], text[], text, text) to service_role;

-- Mark a handoff's WhatsApp leg sent/failed (worker, after dispatch).
create or replace function public.copilot_v2_mark_handoff_whatsapp(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.copilot_v2_handoff_notifications set whatsapp_status = p_status where id = p_id;
end $$;
revoke all on function public.copilot_v2_mark_handoff_whatsapp(uuid, text) from public, anon, authenticated;
grant execute on function public.copilot_v2_mark_handoff_whatsapp(uuid, text) to service_role;

comment on column public.team_members.phone is
  'Opt-in: WhatsApp pessoal do membro p/ notificação de handoff role-aware (Copilot v2). Null = não recebe WhatsApp (só in-app).';
