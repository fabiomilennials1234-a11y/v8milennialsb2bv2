-- ============================================================================
-- Copilot v2 — Proactivity ledger + atomic slot claim (Slice 11, ADR #11).
--
-- Ledger idempotente dos disparos proativos (first-touch, followup, resgate
-- Carteira) + claim atômico do slot que serializa o rate-limit por org/dia e
-- mata o double-send da v1 (#7/#8/#9). org_id SEMPRE do ctx/cron, nunca do LLM.
--
-- NOT applied to prod by this slice — apply requires explicit CTO auth (Slice 12).
-- Default target = dev (bcfadphgsibjzivtbjvc) via MCP apply_migration.
-- ============================================================================

create table if not exists public.copilot_v2_proactive_log (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  lead_id           uuid,
  kind              text not null,            -- first_touch | followup | carteira_rescue
  slot              text not null,            -- "1" | "d3" | "d7" | rodada de resgate
  idempotency_key   text not null,
  enqueued_queue_id uuid,                     -- a row de copilot_v2_message_queue criada (null se ON CONFLICT)
  sent_date         date not null default (now() at time zone 'utc')::date,
  created_at        timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists idx_copilot_v2_proactive_log_org_day
  on public.copilot_v2_proactive_log (organization_id, sent_date);

alter table public.copilot_v2_proactive_log enable row level security;
-- Org members may READ their own proactive ledger (observabilidade/wizard).
-- Writes só via RPC SECURITY DEFINER (service_role). NUNCA inline SELECT FROM
-- team_members numa policy (recursão RLS sob Realtime — root CLAUDE.md).
do $$ begin
  create policy copilot_v2_proactive_log_org_read on public.copilot_v2_proactive_log
    for select to authenticated
    using (organization_id in (select get_my_organization_ids()));
exception when duplicate_object then null; end $$;

-- Claim atômico do slot proativo. Fail-CLOSED + idempotente:
--  - chave já existe        → (false, 'already_claimed')   [não erro]
--  - count(dia) >= ceiling  → (false, 'rate_limit_reached')
--  - senão                  → insere ledger e (true, null)
-- O ON CONFLICT DO NOTHING no insert é o serializador: 2 ticks concorrentes,
-- só um insere; o outro relê e vê already_claimed. org_id vem do caller (cron),
-- nunca do LLM.
create or replace function public.copilot_v2_claim_proactive_slot(
  p_org_id uuid,
  p_lead_id uuid,
  p_kind text,
  p_slot text,
  p_idempotency_key text,
  p_daily_ceiling int
) returns table (claimed boolean, reason text, log_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_count int; v_id uuid;
begin
  if p_daily_ceiling is null or p_daily_ceiling <= 0 then
    return query select false, 'no_rate_ceiling'::text, null::uuid; return;
  end if;

  -- Já reivindicado? (idempotente — não conta como erro)
  if exists (
    select 1 from public.copilot_v2_proactive_log
     where organization_id = p_org_id and idempotency_key = p_idempotency_key
  ) then
    return query select false, 'already_claimed'::text, null::uuid; return;
  end if;

  select count(*) into v_count
    from public.copilot_v2_proactive_log
   where organization_id = p_org_id
     and sent_date = (now() at time zone 'utc')::date;
  if v_count >= p_daily_ceiling then
    return query select false, 'rate_limit_reached'::text, null::uuid; return;
  end if;

  insert into public.copilot_v2_proactive_log
    (organization_id, lead_id, kind, slot, idempotency_key)
  values (p_org_id, p_lead_id, p_kind, p_slot, p_idempotency_key)
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- corrida: outro tick inseriu entre o exists e o insert
    return query select false, 'already_claimed'::text, null::uuid; return;
  end if;

  return query select true, null::text, v_id;
end $$;

revoke all on function public.copilot_v2_claim_proactive_slot(uuid, uuid, text, text, text, int) from public, anon, authenticated;
grant execute on function public.copilot_v2_claim_proactive_slot(uuid, uuid, text, text, text, int) to service_role;
