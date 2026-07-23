-- =============================================================================
-- Leads soft-delete (trash / lixeira)
-- Adds deleted_at + deleted_by to leads, updates RLS to hide trashed leads,
-- updates leads_compat view, creates RPCs for trash operations.
-- =============================================================================

-- 1. Add soft-delete columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id);

-- 2. Index for trash queries + general filter
CREATE INDEX IF NOT EXISTS idx_leads_org_deleted_at
  ON public.leads (organization_id, deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 3. Recreate unique phone index to exclude soft-deleted leads
--    This allows a new lead with the same phone to be created after the original is trashed.
DROP INDEX IF EXISTS idx_leads_org_phone_unique;
CREATE UNIQUE INDEX idx_leads_org_phone_unique
  ON public.leads (organization_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL AND deleted_at IS NULL;

-- =============================================================================
-- 4. Update RLS policies to exclude soft-deleted leads from normal operations
-- =============================================================================

-- SELECT: regular users
DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  USING (
    deleted_at IS NULL
    AND (organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    ))
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all'::text, organization_id)
      OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads'::text, sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  );

-- UPDATE: regular users
DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    deleted_at IS NULL
    AND (organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    ))
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all'::text, organization_id)
      OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads'::text, sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid()) AND tm.is_active = true
    )
  );

-- DELETE: regular users (only non-trashed leads)
DROP POLICY IF EXISTS "leads_delete_configurable" ON public.leads;
CREATE POLICY "leads_delete_configurable"
  ON public.leads FOR DELETE
  USING (
    deleted_at IS NULL
    AND public.can_delete_lead()
    AND (organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid())
    ))
  );

-- Master: ALL — also exclude soft-deleted from normal operations
DROP POLICY IF EXISTS "master_all_leads" ON public.leads;
CREATE POLICY "master_all_leads"
  ON public.leads FOR ALL
  USING (deleted_at IS NULL AND public.is_master_user());

-- Master: SELECT — also exclude soft-deleted from normal operations
DROP POLICY IF EXISTS "master_select_all_leads" ON public.leads;
CREATE POLICY "master_select_all_leads"
  ON public.leads FOR SELECT
  USING (deleted_at IS NULL AND public.is_master_user());

-- INSERT: no change needed (deleted_at defaults to NULL)
-- Policy "leads_insert_organization" stays as-is.

-- =============================================================================
-- 5. Update leads_compat view to exclude soft-deleted leads
-- =============================================================================

CREATE OR REPLACE VIEW public.leads_compat AS
SELECT
  l.id,
  l.name,
  l.company,
  l.email,
  l.phone,
  l.utm_campaign,
  l.utm_source,
  l.utm_medium,
  l.utm_content,
  l.utm_term,
  l.rating,
  l.faturamento,
  l.urgency,
  l.segment,
  l.sdr_id,
  l.closer_id,
  l.notes,
  l.created_at,
  l.updated_at,
  l.compromisso_date,
  l.organization_id,
  l.pipe_whatsapp,
  l.normalized_phone,
  l.ai_disabled,
  l.ai_disabled_at,
  l.ai_disabled_by,
  l.metrics_period_at,
  l.origin,
  l.is_shadow,
  l.qualification_score,
  l.responsible_id,
  l.meta_campaign_id,
  l.meta_adset_id,
  l.meta_ad_id,
  l.pre_sale_responsible_id,
  l.sale_responsible_id,
  l.contact_id,
  l.company_entity_id,
  c.job_title   AS contact_job_title,
  c.linkedin_url AS contact_linkedin,
  co.domain      AS company_domain,
  co.industry    AS company_industry,
  co.size_range  AS company_size,
  co.revenue_range AS company_revenue,
  co.website     AS company_website
FROM public.leads l
  LEFT JOIN public.contacts c  ON l.contact_id = c.id
  LEFT JOIN public.companies co ON l.company_entity_id = co.id
WHERE l.deleted_at IS NULL;

-- =============================================================================
-- 6. RPCs for trash operations
-- =============================================================================

-- 6a. bulk_delete_leads — soft-delete leads + clean pipeline entries
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

  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = v_user_id AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  -- Soft-delete leads (only those belonging to caller's org, not already trashed)
  UPDATE public.leads
  SET deleted_at = now(), deleted_by = v_user_id
  WHERE id = ANY(p_lead_ids)
    AND organization_id = v_org_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Remove from pipeline_entries so kanban is clean
  DELETE FROM public.pipeline_entries
  WHERE lead_id = ANY(p_lead_ids)
    AND organization_id = v_org_id;

  -- Remove from legacy pipe tables
  DELETE FROM public.pipe_whatsapp    WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.pipe_confirmacao WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.pipe_propostas   WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;
  DELETE FROM public.custom_pipe_entries WHERE lead_id = ANY(p_lead_ids) AND organization_id = v_org_id;

  RETURN v_count;
END;
$$;

-- 6b. get_trash_leads — list soft-deleted leads for current org
CREATE OR REPLACE FUNCTION public.get_trash_leads()
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
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  RETURN QUERY
  SELECT l.id, l.name, l.company, l.email, l.phone, l.deleted_at, l.deleted_by
  FROM public.leads l
  WHERE l.organization_id = v_org_id
    AND l.deleted_at IS NOT NULL
  ORDER BY l.deleted_at DESC;
END;
$$;

-- 6c. restore_lead — restore single lead from trash
CREATE OR REPLACE FUNCTION public.restore_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  UPDATE public.leads
  SET deleted_at = NULL, deleted_by = NULL
  WHERE id = p_lead_id
    AND organization_id = v_org_id
    AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found in trash';
  END IF;
END;
$$;

-- 6d. restore_leads_bulk — restore multiple leads from trash
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
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  UPDATE public.leads
  SET deleted_at = NULL, deleted_by = NULL
  WHERE id = ANY(p_lead_ids)
    AND organization_id = v_org_id
    AND deleted_at IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 6e. purge_lead — permanently delete a trashed lead + all dependencies
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
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No active organization membership';
  END IF;

  -- Verify lead is in trash and belongs to org
  IF NOT EXISTS(
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id AND organization_id = v_org_id AND deleted_at IS NOT NULL
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
