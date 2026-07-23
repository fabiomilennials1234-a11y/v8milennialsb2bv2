-- ============================================================================
-- Permission Consolidation — Phase 3: Drop legacy tables & rewrite RLS
-- PRD #408
--
-- POINT OF NO RETURN.
--
-- Part A: Rewrite RLS policies to remove can_see_lead_by_team_member_permissions()
-- Part B: Drop legacy functions and tables
--
-- Pre-requisite: confirm via prod query that zero members use team_access scope
--   SELECT * FROM team_member_permissions WHERE value NOT IN ('allowed', 'denied');
-- ============================================================================


-- ============================================================
-- Part A: Rewrite RLS policies
-- Remove can_see_lead_by_team_member_permissions() from OR chains.
-- All checks it provided are already covered by other functions:
--   - is_user_responsible() covers if_responsible
--   - can_see_lead_by_permissions() covers see_unassigned, see_subordinates
--   - has_feature_permission('leads.view_all') covers view_all
--   - is_user_responsible_in_any_pipe() covers pipe-level responsibility
-- ============================================================

-- leads SELECT
DROP POLICY IF EXISTS leads_select_by_responsibility_and_permissions ON public.leads;
CREATE POLICY leads_select_by_responsibility_and_permissions ON public.leads
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND organization_id IN (SELECT get_my_organization_ids())
    AND (
      is_user_admin()
      OR has_feature_permission('leads.view_all', organization_id)
      OR is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      OR can_see_lead_by_permissions(sdr_id, closer_id)
      OR is_user_responsible_in_any_pipe(id)
    )
  );

-- leads UPDATE
DROP POLICY IF EXISTS leads_update_by_responsibility_and_permissions ON public.leads;
CREATE POLICY leads_update_by_responsibility_and_permissions ON public.leads
  FOR UPDATE
  USING (
    deleted_at IS NULL
    AND organization_id IN (SELECT get_my_organization_ids())
    AND (
      is_user_admin()
      OR has_feature_permission('leads.view_all', organization_id)
      OR is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      OR can_see_lead_by_permissions(sdr_id, closer_id)
      OR is_user_responsible_in_any_pipe(id)
    )
  );

-- lead_history SELECT
DROP POLICY IF EXISTS lead_history_select_by_lead ON public.lead_history;
CREATE POLICY lead_history_select_by_lead
  ON public.lead_history FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (SELECT public.get_my_organization_ids())
        AND (
          public.is_user_admin()
          OR public.has_feature_permission('leads.view_all', organization_id)
          OR public.can_see_lead_by_permissions(sdr_id, closer_id)
          OR public.is_user_responsible_in_any_pipe(id)
        )
    )
  );


-- ============================================================
-- Part B: Drop legacy functions and tables
-- ============================================================

-- Drop functions that read from legacy tables
DROP FUNCTION IF EXISTS public.can_see_lead_by_team_member_permissions(UUID, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.save_team_member_permissions(UUID[], JSONB);

-- Drop legacy tables (CASCADE handles dependent objects like indexes, RLS policies)
DROP TABLE IF EXISTS public.team_member_permissions CASCADE;
DROP TABLE IF EXISTS public.team_member_org_permissions CASCADE;
DROP TABLE IF EXISTS public.organization_role_permissions CASCADE;
