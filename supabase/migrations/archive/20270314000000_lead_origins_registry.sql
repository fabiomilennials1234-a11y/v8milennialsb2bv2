-- ============================================================================
-- lead_origins — registry unificado de origens de lead (Slice A)
-- ----------------------------------------------------------------------------
-- Fonte única de verdade de LISTA / LABEL / COR das origens de lead.
-- Substitui as 4 fontes dessincronizadas do frontend (useMktOriginConfig,
-- src/lib/lead/lead-origins, maps locais duplicados).
--
-- Slice A é behavior-preserving no dado: NÃO altera o enum `lead_origin`.
-- Só criamos built-ins (organization_id = NULL). CRUD de origens custom por org
-- (organization_id preenchido) fica pro Slice B — a coluna já nasce nullable e
-- os índices já cobrem o caso custom (forward-compat).
--
-- Seed espelha EXATAMENTE ALL_ORIGINS / ORIGIN_LABELS / ORIGIN_COLORS de
-- src/modules/analytics/hooks/useMktOriginConfig.ts (13 built-ins).
--
-- Segurança:
--   - RLS habilitada. Built-ins (org_id NULL) legíveis por qualquer authenticated;
--     custom legíveis só por membros da org (get_my_organization_ids) ou master.
--   - SEM policies de INSERT/UPDATE/DELETE neste slice (custom CRUD = Slice B).
--   - service_role NÃO faz BYPASSRLS neste projeto → policy explícita FOR ALL.
--   - anon sem policy → RLS nega (built-ins nunca vazam pra não-autenticado).
-- ============================================================================

create table if not exists public.lead_origins (
  id              uuid primary key default gen_random_uuid(),
  -- NULL = built-in global (Slice A). Preenchido = custom da org (Slice B).
  organization_id uuid references public.organizations(id) on delete cascade,
  slug            text not null,
  label           text not null,
  color           text not null,               -- hex (#RRGGBB)
  sort_order      int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.lead_origins is
  'Registry de origens de lead: fonte única de lista/label/cor. org_id NULL = built-in global; preenchido = custom da org (Slice B).';

-- ── Unicidade ──────────────────────────────────────────────────────────────
-- Built-ins: um slug global único (org_id NULL).
create unique index if not exists lead_origins_builtin_slug_uidx
  on public.lead_origins (slug)
  where organization_id is null;

-- Custom (forward-compat Slice B): slug único por org.
create unique index if not exists lead_origins_org_slug_uidx
  on public.lead_origins (organization_id, slug)
  where organization_id is not null;

-- ── Índices de leitura ─────────────────────────────────────────────────────
-- Query comum do hook: built-ins + custom da org, ordenado por sort_order.
create index if not exists lead_origins_org_sort_idx
  on public.lead_origins (organization_id, sort_order);

-- ── updated_at trigger ─────────────────────────────────────────────────────
-- Função dedicada e self-contained (search_path pinado) — não depende de
-- helper global (há drift entre ambientes: set_updated_at não existe em todo lugar).
create or replace function public.tg_lead_origins_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_lead_origins_updated_at on public.lead_origins;
create trigger set_lead_origins_updated_at
  before update on public.lead_origins
  for each row execute function public.tg_lead_origins_set_updated_at();

-- ── Grants + RLS ───────────────────────────────────────────────────────────
alter table public.lead_origins enable row level security;

revoke all on public.lead_origins from anon;
-- Supabase concede ALL a `authenticated` por default privileges. Slice A é
-- read-only p/ authenticated (write custom = Slice B) → deixa só SELECT.
-- RLS já bloqueia writes (sem policy), mas mantemos o GRANT coerente (defense-in-depth).
revoke insert, update, delete, truncate, references, trigger
  on public.lead_origins from authenticated;
grant select on public.lead_origins to authenticated;
grant all    on public.lead_origins to service_role;

-- SELECT: built-ins visíveis a qualquer authenticated; custom só à própria org
-- (espelha o padrão de `leads`: get_my_organization_ids() OR is_master_user()).
drop policy if exists lead_origins_select on public.lead_origins;
create policy lead_origins_select
  on public.lead_origins for select
  to authenticated
  using (
    organization_id is null
    or organization_id in (select public.get_my_organization_ids())
    or (select public.is_master_user())
  );

-- service_role (edge/cron) — obrigatório: não há BYPASSRLS neste projeto.
drop policy if exists lead_origins_service_all on public.lead_origins;
create policy lead_origins_service_all
  on public.lead_origins for all
  to service_role
  using (true) with check (true);

-- NB: sem policies de INSERT/UPDATE/DELETE para authenticated — custom CRUD = Slice B.

-- ── Seed dos 13 built-ins (org_id NULL) ────────────────────────────────────
-- Espelha useMktOriginConfig.ts: slug/label (ORIGIN_LABELS) / color (ORIGIN_COLORS).
-- sort_order segue a ordem de ALL_ORIGINS. Idempotente via ON CONFLICT no índice
-- parcial de built-ins.
insert into public.lead_origins (organization_id, slug, label, color, sort_order)
values
  (null, 'whatsapp',         'WhatsApp',          '#25D366', 0),
  (null, 'meta_ads',         'Meta Ads',          '#1877F2', 1),
  (null, 'instagram',        'Instagram',         '#E1306C', 2),
  (null, 'tiktok',           'Tiktok',            '#010101', 3),
  (null, 'google_ads',       'Google Ads',        '#EA4335', 4),
  (null, 'site',             'Site',              '#6366F1', 5),
  (null, 'landing_page',     'Landing Page',      '#0EA5E9', 6),
  (null, 'remarketing',      'Remarketing',       '#F59E0B', 7),
  (null, 'indicacao',        'Indicação',         '#10B981', 8),
  (null, 'evento',           'Evento',            '#8B5CF6', 9),
  (null, 'prospeccao_ativa', 'Prospecção Ativa',  '#F97316', 10),
  (null, 'cal',              'Cal.com',           '#292929', 11),
  (null, 'outro',            'Outro',             '#64748B', 12)
on conflict (slug) where organization_id is null
do update set
  label      = excluded.label,
  color      = excluded.color,
  sort_order = excluded.sort_order,
  updated_at = now();
