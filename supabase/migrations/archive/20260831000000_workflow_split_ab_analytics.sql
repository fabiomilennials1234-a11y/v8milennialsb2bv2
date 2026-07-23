-- =====================================================
-- Workflow Split A/B Analytics — tabelas, RLS e RPC
-- =====================================================

-- 1. workflow_split_assignments
-- Atribuição sticky: uma variante por lead por split node.
create table if not exists public.workflow_split_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id     uuid not null references public.workflows(id) on delete cascade,
  node_id         text not null,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  variant_id      text not null,
  variant_label   text not null,
  execution_id    uuid not null references public.workflow_executions(id) on delete cascade,
  assigned_at     timestamptz not null default now(),

  -- Um lead só pode ter uma variante por split node
  unique (workflow_id, node_id, lead_id)
);

-- Índices
create index idx_split_assignments_org_id
  on public.workflow_split_assignments(organization_id);
create index idx_split_assignments_workflow_id
  on public.workflow_split_assignments(workflow_id);
create index idx_split_assignments_workflow_node
  on public.workflow_split_assignments(workflow_id, node_id);
create index idx_split_assignments_lead_id
  on public.workflow_split_assignments(lead_id);
create index idx_split_assignments_workflow_node_variant
  on public.workflow_split_assignments(workflow_id, node_id, variant_id);

-- 2. workflow_split_events
-- Eventos de funil após um lead entrar em um caminho de variante.
create table if not exists public.workflow_split_events (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignment_id   uuid not null references public.workflow_split_assignments(id) on delete cascade,
  execution_id    uuid not null references public.workflow_executions(id) on delete cascade,
  event_type      text not null,
  node_id         text,
  node_type       text,
  metadata        jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- Índices
create index idx_split_events_assignment_id
  on public.workflow_split_events(assignment_id);
create index idx_split_events_org_id
  on public.workflow_split_events(organization_id);
create index idx_split_events_event_type
  on public.workflow_split_events(event_type);

-- =====================================================
-- RLS
-- =====================================================

alter table public.workflow_split_assignments enable row level security;
alter table public.workflow_split_events enable row level security;

-- workflow_split_assignments — SELECT para membros da org
create policy "split_assignments_select"
  on public.workflow_split_assignments for select
  using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

-- workflow_split_assignments — INSERT para membros da org
create policy "split_assignments_insert"
  on public.workflow_split_assignments for insert
  with check (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

-- workflow_split_assignments — ALL para service_role
create policy "service_role_all_split_assignments"
  on public.workflow_split_assignments for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- workflow_split_events — SELECT para membros da org
create policy "split_events_select"
  on public.workflow_split_events for select
  using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

-- workflow_split_events — INSERT para membros da org
create policy "split_events_insert"
  on public.workflow_split_events for insert
  with check (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

-- workflow_split_events — ALL para service_role
create policy "service_role_all_split_events"
  on public.workflow_split_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- =====================================================
-- RPC: get_split_ab_metrics
-- =====================================================

create or replace function public.get_split_ab_metrics(
  p_workflow_id uuid,
  p_node_id    text,
  p_org_id     uuid
)
returns table (
  variant_id       text,
  variant_label    text,
  total_leads      bigint,
  total_executions bigint,
  messages_sent    bigint,
  completed        bigint,
  failed           bigint,
  waiting_response bigint,
  in_progress      bigint
)
language sql stable security definer
set search_path = public
as $$
  select
    a.variant_id,
    a.variant_label,
    count(distinct a.lead_id)      as total_leads,
    count(distinct a.execution_id) as total_executions,
    coalesce(sum(case when e.event_type = 'message_sent' then 1 else 0 end), 0) as messages_sent,
    count(distinct case when we.status = 'completed'                              then we.id end) as completed,
    count(distinct case when we.status in ('failed', 'loop_limit_reached')        then we.id end) as failed,
    count(distinct case when we.status = 'waiting_response'                       then we.id end) as waiting_response,
    count(distinct case when we.status in ('running', 'processing', 'paused')     then we.id end) as in_progress
  from public.workflow_split_assignments a
  join public.workflow_executions we
    on we.id = a.execution_id
  left join public.workflow_split_events e
    on e.assignment_id = a.id
  where a.workflow_id     = p_workflow_id
    and a.node_id         = p_node_id
    and a.organization_id = p_org_id
  group by a.variant_id, a.variant_label;
$$;

comment on function public.get_split_ab_metrics(uuid, text, uuid) is
  'Retorna métricas agregadas por variante para um split A/B node específico de um workflow.';
