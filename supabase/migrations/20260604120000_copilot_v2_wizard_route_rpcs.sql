-- 20260604120000_copilot_v2_wizard_route_rpcs.sql
--
-- Slice 12b — wizard-route enablers (Copilot v2 cutover).
--
-- The foundation (20260531174908) left public.copilot_v2_agents write-deny with
-- org-scoped SELECT only; Slice 8 (20260602220000) added the SAVE + ACTIVATE
-- RPCs but NOT a CREATE path — so the wizard had no way to mint the agent row it
-- configures. This migration adds:
--   * create_copilot_v2_agent           — get-or-create the (org, archetype) row.
--   * copilot_v2_v1_prefill_candidates  — admin-gated read of the org's legacy v1
--                                         copilot_agents, feeding the wizard's
--                                         "Pré-preencher do v1" seed (the pure
--                                         transform runs in the edge fn).
--
-- Invariants (identical to Slice 8):
--   * The org is NEVER taken from the payload for trust — it is resolved from the
--     caller's admin set (get_my_admin_organization_ids, a RLS-safe SECURITY
--     DEFINER helper). A single-org admin needs no argument; a multi-org admin
--     must disambiguate via p_organization_id, which is still validated to be in
--     the admin set.
--   * Caller must be an ADMIN of the resolved org (42501 otherwise).
--   * Read fn is read-only (no writes); it returns raw v1 rows as jsonb so it does
--     NOT couple to the (drift-prone) v1 copilot_agents column set — the Deno
--     prefillFromV1Agent picks the fields it can defend.

-- ── create_copilot_v2_agent ──────────────────────────────────────────────────
create or replace function public.create_copilot_v2_agent(
  p_archetype       copilot_v2_archetype,
  p_organization_id uuid default null
) returns public.copilot_v2_agents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_orgs uuid[];
  v_org        uuid;
  v_row        public.copilot_v2_agents;
begin
  select array_agg(id) into v_admin_orgs
  from (select get_my_admin_organization_ids() as id) s;

  if v_admin_orgs is null or array_length(v_admin_orgs, 1) is null then
    raise exception 'not authorized: caller administers no organization'
      using errcode = '42501';
  end if;

  if p_organization_id is not null then
    v_org := p_organization_id;
  elsif array_length(v_admin_orgs, 1) = 1 then
    v_org := v_admin_orgs[1];
  else
    raise exception 'organization_id required: caller administers multiple organizations'
      using errcode = '22023';
  end if;

  if not (v_org = any (v_admin_orgs)) then
    raise exception 'not authorized to create agents for org %', v_org
      using errcode = '42501';
  end if;

  -- get-or-create: a v2 agent is unique per (org, archetype); re-creating just
  -- returns the existing row so the wizard can re-open it idempotently.
  insert into public.copilot_v2_agents (organization_id, archetype)
  values (v_org, p_archetype)
  on conflict (organization_id, archetype)
    do update set updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_copilot_v2_agent(copilot_v2_archetype, uuid) from public, anon;
grant execute on function public.create_copilot_v2_agent(copilot_v2_archetype, uuid) to authenticated;

-- ── copilot_v2_v1_prefill_candidates ─────────────────────────────────────────
-- Admin-gated, read-only. Returns { organization_id, organization_name,
-- candidates: [ <raw v1 copilot_agents row as jsonb> ] }. The wizard edge fn
-- (copilot-v2-prefill) maps each candidate through the tested prefillFromV1Agent.
create or replace function public.copilot_v2_v1_prefill_candidates(
  p_organization_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_orgs uuid[];
  v_org        uuid;
  v_name       text;
  v_candidates jsonb;
begin
  select array_agg(id) into v_admin_orgs
  from (select get_my_admin_organization_ids() as id) s;

  if v_admin_orgs is null or array_length(v_admin_orgs, 1) is null then
    raise exception 'not authorized: caller administers no organization'
      using errcode = '42501';
  end if;

  if p_organization_id is not null then
    v_org := p_organization_id;
  elsif array_length(v_admin_orgs, 1) = 1 then
    v_org := v_admin_orgs[1];
  else
    raise exception 'organization_id required: caller administers multiple organizations'
      using errcode = '22023';
  end if;

  if not (v_org = any (v_admin_orgs)) then
    raise exception 'not authorized to read agents for org %', v_org
      using errcode = '42501';
  end if;

  select name into v_name from public.organizations where id = v_org;

  select coalesce(jsonb_agg(to_jsonb(a.*) order by a.created_at desc), '[]'::jsonb)
    into v_candidates
  from public.copilot_agents a
  where a.organization_id = v_org;

  return jsonb_build_object(
    'organization_id',   v_org,
    'organization_name', v_name,
    'candidates',        v_candidates
  );
end;
$$;

revoke all on function public.copilot_v2_v1_prefill_candidates(uuid) from public, anon;
grant execute on function public.copilot_v2_v1_prefill_candidates(uuid) to authenticated;
