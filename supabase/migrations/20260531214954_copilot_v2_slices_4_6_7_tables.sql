-- ============================================================================
-- Copilot v2 — Slices 4/6/7 tables (rubric, send-media, knowledge).
-- Additive, isolated, idempotent. Applied to PROD (jsjsmuncfkbsbzqzqhfq)
-- 2026-05-31 via MCP, recorded as schema_migrations version 20260531214954.
-- ============================================================================
create extension if not exists vector;

-- Slice 4 — Rubric per Qualificador agent
create table if not exists public.copilot_v2_rubric (
  agent_id        uuid primary key references public.copilot_v2_agents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rules           jsonb not null default '[]'::jsonb,
  updated_at      timestamptz not null default now()
);

-- Slice 6 — Send-media library (org-level) + per-archetype junction
do $$ begin create type copilot_v2_media_kind as enum ('image','video'); exception when duplicate_object then null; end $$;
create table if not exists public.copilot_v2_send_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  storage_path    text not null,
  kind            copilot_v2_media_kind not null,
  what_it_is      text not null,
  trigger         text not null,
  nuance          text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create table if not exists public.copilot_v2_agent_media (
  agent_id        uuid not null references public.copilot_v2_agents(id) on delete cascade,
  media_id        uuid not null references public.copilot_v2_send_media(id) on delete cascade,
  organization_id uuid not null,
  trigger         text,
  primary key (agent_id, media_id)
);

-- Slice 7 — Knowledge base (org-level) + chunks (pgvector 1536d)
do $$ begin create type copilot_v2_knowledge_kind as enum ('image','video','doc','pdf'); exception when duplicate_object then null; end $$;
do $$ begin create type copilot_v2_knowledge_status as enum ('pending','ingesting','ready','failed'); exception when duplicate_object then null; end $$;
create table if not exists public.copilot_v2_knowledge (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  storage_path    text not null,
  source_kind     copilot_v2_knowledge_kind not null,
  extracted_text  text,
  status          copilot_v2_knowledge_status not null default 'pending',
  created_at      timestamptz not null default now()
);
create table if not exists public.copilot_v2_knowledge_chunks (
  id              bigint generated always as identity primary key,
  knowledge_id    uuid not null references public.copilot_v2_knowledge(id) on delete cascade,
  organization_id uuid not null,
  content         text not null,
  embedding       vector(1536),
  created_at      timestamptz not null default now()
);
create index if not exists idx_copilot_v2_knowledge_chunks_kid on public.copilot_v2_knowledge_chunks (knowledge_id);

-- RLS: deny-all default; org-scoped read on rubric/send_media/knowledge (wizard reads)
alter table public.copilot_v2_rubric            enable row level security;
alter table public.copilot_v2_send_media        enable row level security;
alter table public.copilot_v2_agent_media       enable row level security;
alter table public.copilot_v2_knowledge         enable row level security;
alter table public.copilot_v2_knowledge_chunks  enable row level security;

do $$ begin create policy copilot_v2_rubric_org_read on public.copilot_v2_rubric
  for select to authenticated using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
do $$ begin create policy copilot_v2_send_media_org_read on public.copilot_v2_send_media
  for select to authenticated using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
do $$ begin create policy copilot_v2_knowledge_org_read on public.copilot_v2_knowledge
  for select to authenticated using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
-- copilot_v2_agent_media + copilot_v2_knowledge_chunks: no authenticated policy → service_role only
