-- ============================================================
-- Google Calendar: Sharing, Events Cache, Watch Channels
-- ============================================================

-- ------------------------------------------------------------
-- 1. google_calendar_sharing
--    Controla quem pode ver/criar eventos no calendário de quem
-- ------------------------------------------------------------
create table if not exists public.google_calendar_sharing (
  id               uuid        default gen_random_uuid() primary key,
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  owner_id         uuid        not null references auth.users(id) on delete cascade,
  viewer_id        uuid        not null references auth.users(id) on delete cascade,
  can_create_events boolean    not null default false,
  created_at       timestamptz not null default now(),

  constraint unique_calendar_sharing unique (owner_id, viewer_id),
  constraint no_self_sharing check (owner_id <> viewer_id)
);

create index if not exists idx_calendar_sharing_org      on public.google_calendar_sharing(organization_id);
create index if not exists idx_calendar_sharing_owner    on public.google_calendar_sharing(owner_id);
create index if not exists idx_calendar_sharing_viewer   on public.google_calendar_sharing(viewer_id);

alter table public.google_calendar_sharing enable row level security;

-- Usuário vê compartilhamentos onde é dono ou visualizador
create policy "calendar_sharing_select"
  on public.google_calendar_sharing for select
  using (auth.uid() = owner_id or auth.uid() = viewer_id);

-- Usuário gerencia seus próprios compartilhamentos (onde é dono)
create policy "calendar_sharing_insert"
  on public.google_calendar_sharing for insert
  with check (auth.uid() = owner_id);

create policy "calendar_sharing_update"
  on public.google_calendar_sharing for update
  using (auth.uid() = owner_id);

create policy "calendar_sharing_delete"
  on public.google_calendar_sharing for delete
  using (auth.uid() = owner_id);

-- Service role acesso total
create policy "calendar_sharing_service_role"
  on public.google_calendar_sharing for all
  using (auth.role() = 'service_role');

-- ------------------------------------------------------------
-- 2. google_calendar_events_cache
--    Cache local de eventos para performance na /agenda
-- ------------------------------------------------------------
create table if not exists public.google_calendar_events_cache (
  id                  text        primary key, -- Google event ID
  user_id             uuid        not null references auth.users(id) on delete cascade,
  organization_id     uuid        not null references public.organizations(id) on delete cascade,
  google_calendar_id  text        not null default 'primary',
  title               text,
  description         text,
  location            text,
  start_at            timestamptz not null,
  end_at              timestamptz,
  all_day             boolean     not null default false,
  meet_link           text,
  attendees           jsonb,
  lead_id             uuid        references public.leads(id) on delete set null,
  origin              text        not null default 'google'
                        check (origin in ('google', 'calcom', 'system')),
  google_event_status text        not null default 'confirmed'
                        check (google_event_status in ('confirmed', 'tentative', 'cancelled')),
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_cal_cache_user          on public.google_calendar_events_cache(user_id);
create index if not exists idx_cal_cache_org           on public.google_calendar_events_cache(organization_id);
create index if not exists idx_cal_cache_start         on public.google_calendar_events_cache(start_at);
create index if not exists idx_cal_cache_lead          on public.google_calendar_events_cache(lead_id);
create index if not exists idx_cal_cache_origin        on public.google_calendar_events_cache(origin);

alter table public.google_calendar_events_cache enable row level security;

-- Usuário vê seus próprios eventos
create policy "cal_cache_select_own"
  on public.google_calendar_events_cache for select
  using (auth.uid() = user_id);

-- Usuário vê eventos de quem compartilhou com ele
create policy "cal_cache_select_shared"
  on public.google_calendar_events_cache for select
  using (
    exists (
      select 1 from public.google_calendar_sharing s
      where s.owner_id = google_calendar_events_cache.user_id
        and s.viewer_id = auth.uid()
    )
  );

-- Service role acesso total (Edge Functions gravam no cache)
create policy "cal_cache_service_role"
  on public.google_calendar_events_cache for all
  using (auth.role() = 'service_role');

-- Trigger updated_at
create or replace function public.set_cal_cache_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_cal_cache_updated_at
  before update on public.google_calendar_events_cache
  for each row execute function public.set_cal_cache_updated_at();

-- ------------------------------------------------------------
-- 3. google_calendar_watch_channels
--    Rastreia canais de push notification do Google Calendar
--    (expiram a cada ~7 dias e precisam ser renovados)
-- ------------------------------------------------------------
create table if not exists public.google_calendar_watch_channels (
  id               uuid        default gen_random_uuid() primary key,
  user_id          uuid        not null references auth.users(id) on delete cascade,
  organization_id  uuid        not null references public.organizations(id) on delete cascade,
  channel_id       text        not null unique, -- UUID gerado por nós, enviado ao Google
  resource_id      text,                        -- retornado pelo Google após watch
  calendar_id      text        not null default 'primary',
  expiration       timestamptz,                 -- quando o canal expira
  is_active        boolean     not null default true,
  created_at       timestamptz not null default now()
);

create index if not exists idx_watch_channels_user       on public.google_calendar_watch_channels(user_id);
create index if not exists idx_watch_channels_active     on public.google_calendar_watch_channels(is_active);
create index if not exists idx_watch_channels_expiration on public.google_calendar_watch_channels(expiration);
create index if not exists idx_watch_channels_channel_id on public.google_calendar_watch_channels(channel_id);

alter table public.google_calendar_watch_channels enable row level security;

-- Somente service role gerencia canais de watch
create policy "watch_channels_service_role"
  on public.google_calendar_watch_channels for all
  using (auth.role() = 'service_role');

-- Usuário pode ver seus próprios canais
create policy "watch_channels_select_own"
  on public.google_calendar_watch_channels for select
  using (auth.uid() = user_id);
