-- 20260602230000_copilot_v2_eval_cases.sql
--
-- Slice 9 — eval dataset + run results for the Copilot v2 simulator/eval-suite.
-- Each case: an input message + the expected deterministic outcome (tier for the
-- Qualificador via the rubric; first-allowed write tool for Vendedor/Carteira).
-- MVP: cases are READ-ONLY for tenants (org-scoped SELECT); writes are
-- service_role only (seeded). expected_tier is TEXT+CHECK bound to the
-- rubric-engine QualificationTier strings (NOT the v1 qualification_tier enum) to
-- avoid coupling the eval to a v1 type. Committed-not-applied (MCP apply to dev).

-- ── eval cases ───────────────────────────────────────────────────────────────
create table if not exists public.copilot_v2_eval_cases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  archetype        copilot_v2_archetype not null,
  case_name        text not null,
  input_message    text not null,
  expected_tier    text check (expected_tier is null or expected_tier in
                      ('diamante','ouro','prata','bronze','desqualificado')),
  expected_tool    text,
  expected_action  text,
  expected_signals jsonb,
  system_context   text,
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_copilot_v2_eval_cases_lookup
  on public.copilot_v2_eval_cases (organization_id, archetype, enabled);

-- ── eval run results ─────────────────────────────────────────────────────────
create table if not exists public.copilot_v2_eval_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  case_id          uuid not null references public.copilot_v2_eval_cases(id) on delete cascade,
  archetype        copilot_v2_archetype not null,
  status           text not null check (status in ('pass','fail','skip','error')),
  expected         jsonb,
  actual           jsonb,
  reasoning        text,
  run_at           timestamptz not null default now()
);
create index if not exists idx_copilot_v2_eval_runs_case
  on public.copilot_v2_eval_runs (case_id, run_at);

-- ── RLS: deny-all default; org-scoped SELECT; writes service_role only ───────
alter table public.copilot_v2_eval_cases enable row level security;
alter table public.copilot_v2_eval_runs  enable row level security;

do $$ begin
  create policy copilot_v2_eval_cases_org_read on public.copilot_v2_eval_cases
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy copilot_v2_eval_runs_org_read on public.copilot_v2_eval_runs
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
-- No authenticated INSERT/UPDATE/DELETE policy → service_role only (seed + runner).
