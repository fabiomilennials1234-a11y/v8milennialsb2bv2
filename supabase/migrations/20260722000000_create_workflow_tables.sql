-- =====================================================
-- Visual Workflow Builder — tabelas e RLS
-- =====================================================

-- 1. workflows
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default false,
  trigger_type text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  definition jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  loop_limit int not null default 100,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workflows enable row level security;

create policy "workflows_select" on public.workflows
  for select using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "workflows_insert" on public.workflows
  for insert with check (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "workflows_update" on public.workflows
  for update using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "workflows_delete" on public.workflows
  for delete using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

-- Trigger para updated_at
create or replace function public.update_workflows_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger workflows_updated_at
  before update on public.workflows
  for each row
  execute function public.update_workflows_updated_at();

-- Índices
create index idx_workflows_org_id on public.workflows(organization_id);
create index idx_workflows_trigger_type on public.workflows(trigger_type);
create index idx_workflows_is_active on public.workflows(is_active);

-- 2. workflow_executions
create table if not exists public.workflow_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  status text not null default 'running',
  current_node_id text,
  loop_counters jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

alter table public.workflow_executions enable row level security;

create policy "workflow_executions_select" on public.workflow_executions
  for select using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "workflow_executions_insert" on public.workflow_executions
  for insert with check (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "workflow_executions_update" on public.workflow_executions
  for update using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

-- Índices
create index idx_workflow_executions_workflow_id on public.workflow_executions(workflow_id);
create index idx_workflow_executions_org_id on public.workflow_executions(organization_id);
create index idx_workflow_executions_status on public.workflow_executions(status);
create index idx_workflow_executions_lead_id on public.workflow_executions(lead_id);

-- 3. workflow_execution_steps
create table if not exists public.workflow_execution_steps (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.workflow_executions(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  node_label text not null default '',
  status text not null default 'success',
  input_data jsonb,
  output_data jsonb,
  error text,
  executed_at timestamptz not null default now()
);

alter table public.workflow_execution_steps enable row level security;

-- Steps herdam acesso da execution (join)
create policy "workflow_execution_steps_select" on public.workflow_execution_steps
  for select using (
    exists (
      select 1 from public.workflow_executions we
      where we.id = execution_id
        and we.organization_id in (
          select organization_id from public.team_members where user_id = auth.uid()
        )
    )
  );

create policy "workflow_execution_steps_insert" on public.workflow_execution_steps
  for insert with check (
    exists (
      select 1 from public.workflow_executions we
      where we.id = execution_id
        and we.organization_id in (
          select organization_id from public.team_members where user_id = auth.uid()
        )
    )
  );

-- Índices
create index idx_workflow_execution_steps_exec_id on public.workflow_execution_steps(execution_id);
create index idx_workflow_execution_steps_node_id on public.workflow_execution_steps(node_id);
