-- ============================================================================
-- Copilot v2 — Slice 6: cap PARAMETRIZÁVEL da send-media library.
--
-- DECISÃO DE PRODUTO ABERTA (ver slice-06-asset-stores ## Decisões abertas):
-- ≤5 por tipo  vs  ≤N total. O modo/limite vivem AQUI (config org-level), não
-- no código. O seed abaixo é PROVISÓRIO — o CTO troca o valor quando decidir.
-- committed-not-applied: dev via MCP após pre-check; PROD proibido.
-- ============================================================================

create table if not exists public.copilot_v2_send_media_limits (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- 'per_kind' = limite por tipo (image/video/audio); 'total' = limite agregado.
  mode            text not null default 'per_kind' check (mode in ('per_kind','total')),
  max_items       int  not null default 5 check (max_items between 1 and 50),
  updated_at      timestamptz not null default now()
);

alter table public.copilot_v2_send_media_limits enable row level security;
do $$ begin
  create policy copilot_v2_send_media_limits_org_read on public.copilot_v2_send_media_limits
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;
-- writes só via service_role (wizard/CTO) — sem policy de INSERT/UPDATE p/ authenticated.

-- Resolve a policy efetiva da org (default global quando a org não tem linha).
-- ⚠️ PROVISÓRIO: mode='per_kind', limit=5 é PLACEHOLDER. CTO decide o valor real.
create or replace function public.copilot_v2_assert_send_media_cap(
  p_org_id uuid,
  p_kind   public.copilot_v2_media_kind
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_mode  text;
  v_limit int;
  v_count int;
begin
  select mode, max_items into v_mode, v_limit
    from public.copilot_v2_send_media_limits
   where organization_id = p_org_id;

  -- Default global PROVISÓRIO (substituir quando o CTO decidir a regra).
  if v_mode is null then v_mode := 'per_kind'; v_limit := 5; end if;

  if v_mode = 'total' then
    select count(*) into v_count
      from public.copilot_v2_send_media
     where organization_id = p_org_id and is_active;
  else
    select count(*) into v_count
      from public.copilot_v2_send_media
     where organization_id = p_org_id and is_active and kind = p_kind;
  end if;

  -- true = ainda cabe um novo item (fail-CLOSED no caller: se já está no limite,
  -- a inserção é recusada).
  return v_count < v_limit;
end $$;

revoke all on function public.copilot_v2_assert_send_media_cap(uuid, public.copilot_v2_media_kind)
  from public, anon, authenticated;
grant execute on function public.copilot_v2_assert_send_media_cap(uuid, public.copilot_v2_media_kind)
  to service_role;
