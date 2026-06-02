-- 20260602220000_copilot_v2_save_config_rpcs.sql
--
-- Slice 8 — owner/admin SAVE RPCs for the Copilot v2 wizard. The foundation
-- (20260531174908) left copilot_v2_agents / copilot_v2_config deny-all for writes
-- with org-scoped SELECT only, and reserved these RPCs for Slice 8.
--
-- Invariants:
--   * The org is NEVER taken from the payload — it is resolved from the agent row
--     and the caller must be an ADMIN of that org (get_my_admin_organization_ids,
--     a SECURITY DEFINER helper that is RLS-safe).
--   * The config save is a single upsert statement — no orphan window between an
--     INSERT and a follow-up UPDATE (kills v1 audit #35).
--   * escape_hatch_notes length is re-checked server-side (defense in depth on top
--     of the table CHECK + the edge linter) — a client that bypasses the wizard
--     cannot persist a 501-char note.
--   * Activation flips through its own RPC so the edge can gate it on the
--     activation check before calling it.

-- ── save_copilot_v2_config ───────────────────────────────────────────────────
create or replace function public.save_copilot_v2_config(
  p_agent_id           uuid,
  p_slots              jsonb,
  p_escape_hatch_notes text
) returns public.copilot_v2_config
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.copilot_v2_config;
begin
  -- org from the agent row, never from the payload
  select organization_id into v_org from public.copilot_v2_agents where id = p_agent_id;
  if v_org is null then
    raise exception 'copilot_v2 agent % not found', p_agent_id using errcode = 'P0002';
  end if;

  -- caller must be an admin of that org
  if v_org not in (select get_my_admin_organization_ids()) then
    raise exception 'not authorized to configure agents for org %', v_org using errcode = '42501';
  end if;

  -- server-side length guard (defense in depth)
  if p_escape_hatch_notes is not null and char_length(p_escape_hatch_notes) > 500 then
    raise exception 'escape_hatch_notes exceeds 500 chars' using errcode = '22001';
  end if;

  -- transactional upsert — single statement, no orphan window
  insert into public.copilot_v2_config (agent_id, organization_id, slots, escape_hatch_notes, updated_at)
  values (p_agent_id, v_org, coalesce(p_slots, '{}'::jsonb), p_escape_hatch_notes, now())
  on conflict (agent_id) do update
    set slots              = excluded.slots,
        escape_hatch_notes = excluded.escape_hatch_notes,
        updated_at         = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_copilot_v2_config(uuid, jsonb, text) from public, anon;
grant execute on function public.save_copilot_v2_config(uuid, jsonb, text) to authenticated;

-- ── set_copilot_v2_agent_active ──────────────────────────────────────────────
create or replace function public.set_copilot_v2_agent_active(
  p_agent_id uuid,
  p_active   boolean
) returns public.copilot_v2_agents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.copilot_v2_agents;
begin
  select organization_id into v_org from public.copilot_v2_agents where id = p_agent_id;
  if v_org is null then
    raise exception 'copilot_v2 agent % not found', p_agent_id using errcode = 'P0002';
  end if;

  if v_org not in (select get_my_admin_organization_ids()) then
    raise exception 'not authorized to (de)activate agents for org %', v_org using errcode = '42501';
  end if;

  update public.copilot_v2_agents
     set is_active = p_active, updated_at = now()
   where id = p_agent_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_copilot_v2_agent_active(uuid, boolean) from public, anon;
grant execute on function public.set_copilot_v2_agent_active(uuid, boolean) to authenticated;
