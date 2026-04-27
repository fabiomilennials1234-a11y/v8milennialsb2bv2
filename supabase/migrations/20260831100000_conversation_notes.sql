-- =====================================================
-- Conversation Notes — notas internas por lead
-- =====================================================

-- 1. Trigger function (idempotent)
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- 2. Table
create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.conversation_notes is
  'Notas internas vinculadas a uma conversa/lead. Nunca enviadas ao cliente.';

-- 3. RLS
alter table public.conversation_notes enable row level security;

create policy "conversation_notes_select" on public.conversation_notes
  for select using (
    organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "conversation_notes_insert" on public.conversation_notes
  for insert with check (
    author_id = auth.uid()
    and organization_id in (
      select organization_id from public.team_members where user_id = auth.uid()
    )
  );

create policy "conversation_notes_update" on public.conversation_notes
  for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "conversation_notes_delete" on public.conversation_notes
  for delete using (
    author_id = auth.uid()
  );

create policy "conversation_notes_service_role" on public.conversation_notes
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- 4. Indexes
create index idx_conv_notes_org on public.conversation_notes(organization_id);
create index idx_conv_notes_lead on public.conversation_notes(lead_id);
create index idx_conv_notes_author on public.conversation_notes(author_id);
create index idx_conv_notes_created on public.conversation_notes(lead_id, created_at desc);

-- 5. Trigger
create trigger conversation_notes_updated_at
  before update on public.conversation_notes
  for each row
  execute function public.set_updated_at();
