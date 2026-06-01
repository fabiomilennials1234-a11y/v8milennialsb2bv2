-- ============================================================================
-- Copilot v2 — Foundation (Slice 0/1)
--
-- Clean-slate agent runtime, isolated from v1 (ADR-0002). New tables prefixed
-- copilot_v2_*. RLS deny-all by default; internal tables are service_role only;
-- org-scoped read where the frontend needs it, via the SECURITY DEFINER helper
-- get_my_organization_ids() (NEVER inline SELECT FROM team_members in a policy —
-- causes RLS recursion under Realtime; see root CLAUDE.md).
--
-- This migration carries the Slice 1 spine: message queue + DLQ, atomic dedup
-- lock, phone-keyed pause (canonical-phone keyed — fixes the 40% ai_disabled
-- incident at the schema level), turn counter (atomic — kills the
-- increment_conversation_turn race), and end-to-end trace tables.
--
-- Applied to PROD (jsjsmuncfkbsbzqzqhfq) 2026-05-31 via MCP, recorded as
-- schema_migrations version 20260531174908. Verified: 9 tables + 5 RPCs;
-- dedup race / turn race / phone-keyed pause regressions all pass on prod.
-- ============================================================================

-- ── Enums (closed, validated) ───────────────────────────────────────────────
do $$ begin
  create type copilot_v2_archetype as enum ('qualificador', 'vendedor', 'carteira');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Closed model allowlist. Flash-class for high-volume archetypes, Sonnet-class
  -- for Vendedor's closing nuance. Validated; never free-text.
  create type copilot_v2_model_id as enum (
    'google/gemini-2.5-flash',
    'anthropic/claude-haiku-4-5',
    'anthropic/claude-sonnet-4-6'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type copilot_v2_queue_status as enum ('pending', 'processing', 'processed', 'retry', 'dead');
exception when duplicate_object then null; end $$;

-- ── Agents: one row per enabled archetype per org ────────────────────────────
create table if not exists public.copilot_v2_agents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  archetype        copilot_v2_archetype not null,
  is_active        boolean not null default false,
  model_id         copilot_v2_model_id not null default 'google/gemini-2.5-flash',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, archetype)
);

-- ── Config: typed slots (Zod-validated at the edge) + capped escape-hatch ─────
create table if not exists public.copilot_v2_config (
  agent_id            uuid primary key references public.copilot_v2_agents(id) on delete cascade,
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  slots               jsonb not null default '{}'::jsonb,
  escape_hatch_notes  text,
  updated_at          timestamptz not null default now(),
  constraint copilot_v2_escape_hatch_len check (escape_hatch_notes is null or char_length(escape_hatch_notes) <= 500)
);

-- ── Durable inbound queue + dead-letter ──────────────────────────────────────
create table if not exists public.copilot_v2_message_queue (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  lead_id          uuid,
  canonical_phone  text not null,
  conversation_id  uuid,
  message_type     text not null default 'text',
  content          text not null,
  source           text not null default 'inbound',
  trace_id         uuid not null,
  idempotency_key  text not null,
  status           copilot_v2_queue_status not null default 'pending',
  attempts         int not null default 0,
  next_retry_at    timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists idx_copilot_v2_queue_pending
  on public.copilot_v2_message_queue (status, next_retry_at)
  where status in ('pending', 'retry');

create table if not exists public.copilot_v2_dlq (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  queue_id         uuid,
  canonical_phone  text,
  content          text,
  trace_id         uuid,
  reason           text not null,
  payload          jsonb,
  created_at       timestamptz not null default now()
);

-- ── Atomic dedup lock (serializes concurrent identical messages) ─────────────
create table if not exists public.copilot_v2_dedup_locks (
  dedup_key        text primary key,
  organization_id  uuid not null,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_copilot_v2_dedup_expiry on public.copilot_v2_dedup_locks (expires_at);

-- ── Phone-keyed pause state (canonical phone — the incident fix) ─────────────
create table if not exists public.copilot_v2_pause_state (
  organization_id  uuid not null,
  canonical_phone  text not null,
  paused_until     timestamptz,
  reason           text,
  updated_at       timestamptz not null default now(),
  primary key (organization_id, canonical_phone)
);

-- ── Atomic per-conversation turn counter (kills the turn-bump race) ──────────
create table if not exists public.copilot_v2_turn_counters (
  conversation_id  uuid primary key,
  organization_id  uuid not null,
  turn_count       int not null default 0,
  updated_at       timestamptz not null default now()
);

-- ── End-to-end trace ─────────────────────────────────────────────────────────
create table if not exists public.copilot_v2_traces (
  trace_id         uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  lead_id          uuid,
  conversation_id  uuid,
  archetype        copilot_v2_archetype,
  turn_number      int,
  status           text not null default 'open',
  created_at       timestamptz not null default now()
);
create table if not exists public.copilot_v2_trace_steps (
  id          bigint generated always as identity primary key,
  trace_id    uuid not null references public.copilot_v2_traces(trace_id) on delete cascade,
  step        text not null,                 -- border | gate | enqueue | cognition | tool | outbound
  reason      text,
  -- metadata only at info level: never raw message content (PII; ADR defers redaction to v2)
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_copilot_v2_trace_steps_trace on public.copilot_v2_trace_steps (trace_id, created_at);

-- ============================================================================
-- RLS — deny-all default. Internal tables: no anon/authenticated policy
-- (service_role bypasses RLS). Agent/config: org-scoped SELECT for the wizard.
-- ============================================================================
alter table public.copilot_v2_agents          enable row level security;
alter table public.copilot_v2_config           enable row level security;
alter table public.copilot_v2_message_queue    enable row level security;
alter table public.copilot_v2_dlq              enable row level security;
alter table public.copilot_v2_dedup_locks      enable row level security;
alter table public.copilot_v2_pause_state      enable row level security;
alter table public.copilot_v2_turn_counters    enable row level security;
alter table public.copilot_v2_traces           enable row level security;
alter table public.copilot_v2_trace_steps      enable row level security;

-- Org members may READ their own agents + config (wizard). Writes go through
-- SECURITY DEFINER RPCs (owner/admin only) — added in Slice 8.
do $$ begin
  create policy copilot_v2_agents_org_read on public.copilot_v2_agents
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy copilot_v2_config_org_read on public.copilot_v2_config
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy copilot_v2_traces_org_read on public.copilot_v2_traces
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
-- queue, dlq, dedup_locks, pause_state, turn_counters, trace_steps: no
-- authenticated policy → deny-all for everyone but service_role.

-- ============================================================================
-- RPCs (service_role surface — org_id always supplied by the trusted edge
-- context, NEVER by the LLM or the inbound payload).
-- ============================================================================

-- Atomic dedup reservation: INSERT ON CONFLICT DO NOTHING RETURNING.
create or replace function public.copilot_v2_acquire_dedup_lock(
  p_dedup_key text,
  p_org_id uuid,
  p_window_seconds int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_reserved boolean;
begin
  -- Opportunistically clear expired locks for this key.
  delete from public.copilot_v2_dedup_locks
   where dedup_key = p_dedup_key and expires_at < now();

  insert into public.copilot_v2_dedup_locks (dedup_key, organization_id, expires_at)
  values (p_dedup_key, p_org_id, now() + make_interval(secs => p_window_seconds))
  on conflict (dedup_key) do nothing
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end $$;

-- Enqueue a message (idempotent on (org, idempotency_key)).
create or replace function public.copilot_v2_enqueue_message(
  p_org_id uuid,
  p_lead_id uuid,
  p_canonical_phone text,
  p_message_type text,
  p_content text,
  p_source text,
  p_trace_id uuid,
  p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.copilot_v2_message_queue
    (organization_id, lead_id, canonical_phone, message_type, content, source, trace_id, idempotency_key)
  values
    (p_org_id, p_lead_id, p_canonical_phone, p_message_type, p_content, p_source, p_trace_id, p_idempotency_key)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;
  return v_id; -- null when a duplicate was suppressed
end $$;

-- Phone-keyed pause check / set (canonical phone — the incident fix).
create or replace function public.copilot_v2_check_human_pause(
  p_org_id uuid,
  p_canonical_phone text
) returns timestamptz
language sql security definer set search_path = public as $$
  select paused_until
    from public.copilot_v2_pause_state
   where organization_id = p_org_id and canonical_phone = p_canonical_phone;
$$;

create or replace function public.copilot_v2_set_human_pause(
  p_org_id uuid,
  p_canonical_phone text,
  p_until timestamptz,
  p_reason text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.copilot_v2_pause_state (organization_id, canonical_phone, paused_until, reason, updated_at)
  values (p_org_id, p_canonical_phone, p_until, p_reason, now())
  on conflict (organization_id, canonical_phone)
  do update set paused_until = excluded.paused_until, reason = excluded.reason, updated_at = now();
end $$;

-- Atomic turn bump — upsert + returning makes concurrent bumps serial,
-- so no turn is ever lost (increment_conversation_turn race fix).
create or replace function public.copilot_v2_next_turn(
  p_conversation_id uuid,
  p_org_id uuid
) returns int
language plpgsql security definer set search_path = public as $$
declare v_turn int;
begin
  insert into public.copilot_v2_turn_counters (conversation_id, organization_id, turn_count, updated_at)
  values (p_conversation_id, p_org_id, 1, now())
  on conflict (conversation_id)
  do update set turn_count = public.copilot_v2_turn_counters.turn_count + 1, updated_at = now()
  returning turn_count into v_turn;
  return v_turn;
end $$;

revoke all on function public.copilot_v2_acquire_dedup_lock(text, uuid, int) from public, anon, authenticated;
revoke all on function public.copilot_v2_enqueue_message(uuid, uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.copilot_v2_check_human_pause(uuid, text) from public, anon, authenticated;
revoke all on function public.copilot_v2_set_human_pause(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.copilot_v2_next_turn(uuid, uuid) from public, anon, authenticated;
