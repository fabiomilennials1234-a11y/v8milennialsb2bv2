-- ============================================================================
-- Copilot v2 — HITL (Human-in-the-loop) (Slice 5, ADR-0002 #7).
--
-- Per-org toggle (default OFF) + a table of pending approval proposals. When ON
-- and a critical action targets a high-value lead, the worker writes a proposal
-- and suppresses the send until a human approves/edits/rejects. NOT applied to
-- prod by this slice.
-- ============================================================================

-- Per-org settings for the copilot-v2 runtime (extensible). HITL default OFF.
create table if not exists public.copilot_v2_org_settings (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  hitl_enabled     boolean not null default false,
  judge_sample_rate numeric not null default 1.0 check (judge_sample_rate >= 0 and judge_sample_rate <= 1),
  updated_at       timestamptz not null default now()
);
alter table public.copilot_v2_org_settings enable row level security;
do $$ begin
  create policy copilot_v2_org_settings_read on public.copilot_v2_org_settings
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

create table if not exists public.copilot_v2_hitl_approvals (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_id          uuid,
  trace_id         uuid,
  conversation_id  uuid,
  proposed_reply   text,
  proposed_tools   text[] not null default '{}',
  tier             text,
  status           text not null default 'pending', -- pending | approved | edited | rejected
  decided_by       uuid,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists idx_copilot_v2_hitl_pending
  on public.copilot_v2_hitl_approvals (organization_id, status, created_at)
  where status = 'pending';
alter table public.copilot_v2_hitl_approvals enable row level security;
do $$ begin
  create policy copilot_v2_hitl_org_read on public.copilot_v2_hitl_approvals
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Worker writes a pending proposal (org from the trusted ctx).
create or replace function public.copilot_v2_create_hitl_proposal(
  p_org_id uuid, p_lead_id uuid, p_trace_id uuid, p_conversation_id uuid,
  p_reply text, p_tools text[], p_tier text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.copilot_v2_hitl_approvals
    (organization_id, lead_id, trace_id, conversation_id, proposed_reply, proposed_tools, tier)
  values (p_org_id, p_lead_id, p_trace_id, p_conversation_id, p_reply, coalesce(p_tools,'{}'), p_tier)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.copilot_v2_create_hitl_proposal(uuid, uuid, uuid, uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.copilot_v2_create_hitl_proposal(uuid, uuid, uuid, uuid, text, text[], text) to service_role;
