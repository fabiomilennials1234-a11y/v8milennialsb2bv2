-- 20261212000000_fix_master_ghost_lead_trash_rpcs.sql
--
-- FIX (master-ghost class): the lead trash RPCs resolved the caller's org
-- EXCLUSIVELY via public.team_members. Master users are global (master_users),
-- they have NO team_members row in a shadowed org — so every RPC hit
-- `v_org_id IS NULL` and raised 'No active organization membership'. The
-- frontend surfaced this as the generic "erro ao excluir lead".
--
-- The leads RLS already grants master full access (master_all_leads), but these
-- functions are SECURITY DEFINER and re-gated on team_members, defeating it.
--
-- Fix: master-aware org resolution.
--   * Mutation RPCs (bulk_delete / restore / restore_bulk / purge) carry the
--     lead id(s) — for master we drop the org pin and let the explicit ids
--     bound the scope (RLS is already bypassed under SECURITY DEFINER; master
--     is a global super-admin per master_all_leads).
--   * get_trash_leads carries no lead id, so it gains an optional p_org_id:
--     master scopes to the requested org (the org shadowed in the UI);
--     non-master callers always use their own team_members org (p_org_id ignored).
--
-- Same class as the master-ghost fixes for checklists (20261118000000) and the
-- whatsapp conversation list (20261126000000).

-- =============================================================================
-- 6a. bulk_delete_leads — soft-delete leads + clean pipeline entries
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bulk_delete_leads(p_lead_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_count integer;
BEGIN
  v_user_id := auth.uid();

  IF public.is_master_user() THEN
    -- master: no org pin; scope is bounded by the explicit p_lead_ids
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = v_user_id AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  -- Soft-delete leads (caller's org for members; any matching id for master)
  UPDATE public.leads
  SET deleted_at = now(), deleted_by = v_user_id
  WHERE id = ANY(p_lead_ids)
    AND (v_org_id IS NULL OR organization_id = v_org_id)
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Remove from pipeline_entries so kanban is clean
  DELETE FROM public.pipeline_entries
  WHERE lead_id = ANY(p_lead_ids)
    AND (v_org_id IS NULL OR organization_id = v_org_id);

  -- Remove from legacy pipe tables
  DELETE FROM public.pipe_whatsapp    WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);
  DELETE FROM public.pipe_confirmacao WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);
  DELETE FROM public.pipe_propostas   WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);
  DELETE FROM public.custom_pipe_entries WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);

  RETURN v_count;
END;
$$;

-- =============================================================================
-- 6b. get_trash_leads — list soft-deleted leads (optional org scope for master)
-- =============================================================================
-- Drop the old zero-arg signature so the new optional-param overload is unambiguous.
DROP FUNCTION IF EXISTS public.get_trash_leads();

CREATE OR REPLACE FUNCTION public.get_trash_leads(p_org_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  name text,
  company text,
  email text,
  phone text,
  deleted_at timestamptz,
  deleted_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF public.is_master_user() THEN
    -- master: scope to the org shadowed in the UI (NULL = all orgs)
    v_org_id := p_org_id;
  ELSE
    -- members: always own org; p_org_id is ignored (no cross-tenant peeking)
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  RETURN QUERY
  SELECT l.id, l.name, l.company, l.email, l.phone, l.deleted_at, l.deleted_by
  FROM public.leads l
  WHERE (v_org_id IS NULL OR l.organization_id = v_org_id)
    AND l.deleted_at IS NOT NULL
  ORDER BY l.deleted_at DESC;
END;
$$;

-- =============================================================================
-- 6c. restore_lead — restore single lead from trash
-- =============================================================================
CREATE OR REPLACE FUNCTION public.restore_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF public.is_master_user() THEN
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  UPDATE public.leads
  SET deleted_at = NULL, deleted_by = NULL
  WHERE id = p_lead_id
    AND (v_org_id IS NULL OR organization_id = v_org_id)
    AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found in trash';
  END IF;
END;
$$;

-- =============================================================================
-- 6d. restore_leads_bulk — restore multiple leads from trash
-- =============================================================================
CREATE OR REPLACE FUNCTION public.restore_leads_bulk(p_lead_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_count integer;
BEGIN
  IF public.is_master_user() THEN
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  UPDATE public.leads
  SET deleted_at = NULL, deleted_by = NULL
  WHERE id = ANY(p_lead_ids)
    AND (v_org_id IS NULL OR organization_id = v_org_id)
    AND deleted_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- =============================================================================
-- 6e. purge_lead — permanently delete a trashed lead + all dependencies
-- =============================================================================
CREATE OR REPLACE FUNCTION public.purge_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_upsell_ids uuid[];
  v_proposta_ids uuid[];
BEGIN
  IF public.is_master_user() THEN
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  -- Verify lead is in trash (and belongs to caller's org, unless master)
  IF NOT EXISTS(
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id
      AND (v_org_id IS NULL OR organization_id = v_org_id)
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Lead not found in trash';
  END IF;

  -- 1. Upsell chain (ON DELETE RESTRICT — must delete children first)
  SELECT array_agg(uc.id) INTO v_upsell_ids
  FROM public.upsell_clients uc
  WHERE uc.lead_id = p_lead_id;

  IF v_upsell_ids IS NOT NULL THEN
    DELETE FROM public.upsell_orders        WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_campanhas     WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_client_products WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_clients       WHERE id = ANY(v_upsell_ids);
  END IF;

  -- 2. Pipe proposta items (via pipe_propostas)
  SELECT array_agg(pp.id) INTO v_proposta_ids
  FROM public.pipe_propostas pp
  WHERE pp.lead_id = p_lead_id;

  IF v_proposta_ids IS NOT NULL THEN
    DELETE FROM public.pipe_proposta_items WHERE pipe_proposta_id = ANY(v_proposta_ids);
  END IF;

  -- 3. All other lead-dependent records
  DELETE FROM public.lead_tags        WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_history     WHERE lead_id = p_lead_id;
  DELETE FROM public.follow_ups       WHERE lead_id = p_lead_id;
  DELETE FROM public.acoes_do_dia     WHERE lead_id = p_lead_id;
  DELETE FROM public.campanha_leads   WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_scores      WHERE lead_id = p_lead_id;
  DELETE FROM public.leads_reativacao WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_whatsapp    WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_confirmacao WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_propostas   WHERE lead_id = p_lead_id;
  DELETE FROM public.custom_pipe_entries WHERE lead_id = p_lead_id;
  DELETE FROM public.pipeline_entries WHERE lead_id = p_lead_id;

  -- 4. Delete the lead itself
  DELETE FROM public.leads WHERE id = p_lead_id;
END;
$$;

-- Re-grant EXECUTE (recreated get_trash_leads signature needs explicit grant)
GRANT EXECUTE ON FUNCTION public.get_trash_leads(uuid) TO authenticated;
