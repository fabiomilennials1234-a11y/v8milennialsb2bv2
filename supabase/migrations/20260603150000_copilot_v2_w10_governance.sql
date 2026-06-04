-- ============================================================================
-- Copilot v2 — W10 Governança de custo + kill-switch (Fase D).
--
-- COMMITTED-NOT-APPLIED. Adds:
--   1. cost cap + inbound rate config on copilot_v2_org_settings (per-org, tunable)
--   2. copilot_v2_cost_ledger (per-org daily USD/token accrual) + atomic
--      record/window RPCs (mirrors the turn_counters upsert-increment pattern)
--   3. copilot_v2_org_pause (org-level kill-switch, typed reason) + set/check RPCs
--   4. realtime on copilot_v2_org_pause so the FE banner reflects a pause instantly
--
-- Invariants: RLS deny-all by default; org-scoped SELECT for the dashboard;
-- writes only via SECURITY DEFINER RPCs (service_role, or org admin for the
-- manual kill-switch). organization_id ALWAYS from the trusted ctx, never the LLM.
-- ============================================================================

-- ── 1. Cost cap + rate-limit config (extends the existing org settings) ──────
-- Soft daily cap drives graceful degradation; hard monthly cap drives org pause.
-- A 0/negative cap is forbidden (CHECK) — disable governance via the flag, not a
-- zero cap, so the cost gate's "malformed cap → fail-closed" path stays a bug,
-- not a config state.
alter table public.copilot_v2_org_settings
  add column if not exists cost_governance_enabled boolean not null default true;
alter table public.copilot_v2_org_settings
  add column if not exists soft_daily_usd numeric not null default 3.0 check (soft_daily_usd > 0);
alter table public.copilot_v2_org_settings
  add column if not exists hard_monthly_usd numeric not null default 50.0 check (hard_monthly_usd > 0);
alter table public.copilot_v2_org_settings
  add column if not exists inbound_rate_per_min integer not null default 15 check (inbound_rate_per_min > 0);

-- ── 2. Cost ledger — per-org daily bucket of token/USD spend ─────────────────
create table if not exists public.copilot_v2_cost_ledger (
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  period_date       date not null,
  prompt_tokens     bigint not null default 0,
  completion_tokens bigint not null default 0,
  cost_usd          numeric not null default 0,
  turn_count        integer not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (organization_id, period_date)
);
create index if not exists idx_copilot_v2_cost_ledger_org_date
  on public.copilot_v2_cost_ledger (organization_id, period_date);

alter table public.copilot_v2_cost_ledger enable row level security;
do $$ begin
  create policy copilot_v2_cost_ledger_org_read on public.copilot_v2_cost_ledger
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Atomic upsert-increment of today's (UTC) bucket. Concurrent worker turns
-- serialize on the PK so no spend is lost (same shape as copilot_v2_next_turn).
-- Negative inputs are clamped to 0 — a turn can never DECREASE recorded spend.
create or replace function public.copilot_v2_record_cost(
  p_org_id uuid,
  p_prompt_tokens bigint,
  p_completion_tokens bigint,
  p_cost_usd numeric
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.copilot_v2_cost_ledger
    (organization_id, period_date, prompt_tokens, completion_tokens, cost_usd, turn_count, updated_at)
  values
    (p_org_id, (now() at time zone 'utc')::date,
     greatest(coalesce(p_prompt_tokens, 0), 0),
     greatest(coalesce(p_completion_tokens, 0), 0),
     greatest(coalesce(p_cost_usd, 0), 0), 1, now())
  on conflict (organization_id, period_date) do update set
    prompt_tokens     = public.copilot_v2_cost_ledger.prompt_tokens + greatest(coalesce(excluded.prompt_tokens, 0), 0),
    completion_tokens = public.copilot_v2_cost_ledger.completion_tokens + greatest(coalesce(excluded.completion_tokens, 0), 0),
    cost_usd          = public.copilot_v2_cost_ledger.cost_usd + greatest(coalesce(excluded.cost_usd, 0), 0),
    turn_count        = public.copilot_v2_cost_ledger.turn_count + 1,
    updated_at        = now();
end $$;

-- Returns this org's spend SO FAR today (UTC) and month-to-date (calendar month).
create or replace function public.copilot_v2_cost_window(p_org_id uuid)
returns table (daily_usd numeric, monthly_usd numeric)
language sql security definer set search_path = public as $$
  select
    coalesce((
      select cost_usd from public.copilot_v2_cost_ledger
      where organization_id = p_org_id
        and period_date = (now() at time zone 'utc')::date
    ), 0) as daily_usd,
    coalesce((
      select sum(cost_usd) from public.copilot_v2_cost_ledger
      where organization_id = p_org_id
        and period_date >= date_trunc('month', (now() at time zone 'utc')::date)::date
    ), 0) as monthly_usd;
$$;

-- ── 3. Org-level pause (kill-switch) — typed reason, no phone ────────────────
create table if not exists public.copilot_v2_org_pause (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  paused_until     timestamptz,
  reason           text check (reason in ('takeover', 'loop', 'teto', 'baixa_confianca')),
  paused_by        uuid,  -- auth.users id of the admin; null when set by the system (hard cap)
  updated_at       timestamptz not null default now()
);
alter table public.copilot_v2_org_pause enable row level security;
do $$ begin
  create policy copilot_v2_org_pause_org_read on public.copilot_v2_org_pause
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Worker reads the org pause (service_role).
create or replace function public.copilot_v2_check_org_pause(p_org_id uuid)
returns timestamptz
language sql security definer set search_path = public as $$
  select paused_until from public.copilot_v2_org_pause where organization_id = p_org_id;
$$;

-- Set (or clear, with p_until = null) the org pause. Callable by the system
-- (service_role, e.g. the hard-cap auto-pause) or by an ADMIN of that org (the
-- manual kill-switch toggle from the dashboard). The reason CHECK on the column
-- rejects anything outside the closed enum.
create or replace function public.copilot_v2_set_org_pause(
  p_org_id uuid,
  p_until timestamptz,
  p_reason text default null,
  p_paused_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_by uuid;
begin
  if auth.role() <> 'service_role' then
    if not (p_org_id in (select get_my_admin_organization_ids())) then
      raise exception 'not authorized to pause org %', p_org_id using errcode = '42501';
    end if;
    -- Audit: capture the acting admin server-side, never trust the client arg.
    v_by := auth.uid();
  else
    v_by := p_paused_by;  -- system path (hard cap) may attribute or leave null
  end if;

  insert into public.copilot_v2_org_pause (organization_id, paused_until, reason, paused_by, updated_at)
  values (p_org_id, p_until, p_reason, v_by, now())
  on conflict (organization_id) do update set
    paused_until = excluded.paused_until,
    reason       = excluded.reason,
    paused_by    = excluded.paused_by,
    updated_at   = now();
end $$;

-- ── 4. Grants — deny by default, expose the minimum surface ──────────────────
revoke all on function public.copilot_v2_record_cost(uuid, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.copilot_v2_record_cost(uuid, bigint, bigint, numeric) to service_role;

revoke all on function public.copilot_v2_cost_window(uuid) from public, anon, authenticated;
grant execute on function public.copilot_v2_cost_window(uuid) to service_role;

revoke all on function public.copilot_v2_check_org_pause(uuid) from public, anon, authenticated;
grant execute on function public.copilot_v2_check_org_pause(uuid) to service_role;

-- set_org_pause: service_role (system) + authenticated (org admin, guarded inside).
revoke all on function public.copilot_v2_set_org_pause(uuid, timestamptz, text, uuid) from public, anon;
grant execute on function public.copilot_v2_set_org_pause(uuid, timestamptz, text, uuid) to authenticated, service_role;

-- ── 5. Realtime — FE banner reflects a pause flip instantly ──────────────────
do $$ begin
  alter publication supabase_realtime add table public.copilot_v2_org_pause;
exception when duplicate_object then null; end $$;
