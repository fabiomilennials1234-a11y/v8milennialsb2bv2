-- ============================================================
-- Migration: Fix Realtime RLS recursion
-- Problem: Supabase Realtime's apply_rls() evaluates RLS policies
--   on tables in the publication. Many policies contain inline
--   subqueries on team_members, which triggers team_members RLS
--   (team_members_select_organization → get_my_organization_ids()
--   → queries team_members again) → infinite recursion → Realtime
--   crashes with "Too many database timeouts".
-- Fix: Replace all inline team_members subqueries with calls to
--   get_my_organization_ids() (SECURITY DEFINER, bypasses RLS).
-- ============================================================

-- 1. Ensure helper functions exist and are SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_my_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_organization_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND role = 'admin'
    AND is_active = true;
$$;

-- Helper: get team_member IDs for current user (used by commissions/goals)
CREATE OR REPLACE FUNCTION public.get_my_team_member_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true;
$$;

-- ============================================================
-- 2. Fix whatsapp_messages policies
-- ============================================================

DROP POLICY IF EXISTS whatsapp_messages_select_by_responsibility ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_select_by_responsibility ON public.whatsapp_messages
  FOR SELECT
  USING (
    organization_id IN (SELECT get_my_organization_ids())
    AND (
      is_user_admin()
      OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to)
      OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to)
    )
  );

DROP POLICY IF EXISTS whatsapp_messages_update_by_responsibility ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_update_by_responsibility ON public.whatsapp_messages
  FOR UPDATE
  USING (
    organization_id IN (SELECT get_my_organization_ids())
    AND (
      auth.role() = 'service_role'
      OR is_user_admin()
      OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to)
      OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to)
    )
  )
  WITH CHECK (
    organization_id IN (SELECT get_my_organization_ids())
    AND (
      auth.role() = 'service_role'
      OR is_user_admin()
      OR is_user_responsible(NULL::uuid, NULL::uuid, assigned_to)
      OR has_no_responsible(NULL::uuid, NULL::uuid, assigned_to)
    )
  );

-- ============================================================
-- 3. Fix leads policies
-- ============================================================

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
      OR can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR is_user_responsible_in_any_pipe(id)
    )
  );

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
      OR can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR is_user_responsible_in_any_pipe(id)
    )
  );

DROP POLICY IF EXISTS leads_delete_configurable ON public.leads;
CREATE POLICY leads_delete_configurable ON public.leads
  FOR DELETE
  USING (
    deleted_at IS NULL
    AND can_delete_lead()
    AND organization_id IN (SELECT get_my_organization_ids())
  );

-- ============================================================
-- 4. Fix pipeline_entries policies
-- ============================================================

DROP POLICY IF EXISTS pipeline_entries_select ON public.pipeline_entries;
CREATE POLICY pipeline_entries_select ON public.pipeline_entries
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS pipeline_entries_update ON public.pipeline_entries;
CREATE POLICY pipeline_entries_update ON public.pipeline_entries
  FOR UPDATE
  USING (
    organization_id IN (SELECT get_my_organization_ids())
    OR is_master_user()
  );

DROP POLICY IF EXISTS pipeline_entries_delete ON public.pipeline_entries;
CREATE POLICY pipeline_entries_delete ON public.pipeline_entries
  FOR DELETE
  USING (
    organization_id IN (SELECT get_my_organization_ids())
    OR is_master_user()
  );

-- ============================================================
-- 5. Fix pipeline_stages policies
-- ============================================================

DROP POLICY IF EXISTS "Users can view pipeline stages" ON public.pipeline_stages;
CREATE POLICY "Users can view pipeline stages" ON public.pipeline_stages
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS "Users can manage pipeline stages" ON public.pipeline_stages;
CREATE POLICY "Users can manage pipeline stages" ON public.pipeline_stages
  FOR ALL
  USING (organization_id IN (SELECT get_my_organization_ids()));

-- ============================================================
-- 6. Fix pipelines policies
-- ============================================================

DROP POLICY IF EXISTS pipelines_select ON public.pipelines;
CREATE POLICY pipelines_select ON public.pipelines
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS pipelines_update ON public.pipelines;
CREATE POLICY pipelines_update ON public.pipelines
  FOR UPDATE
  USING (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS pipelines_delete ON public.pipelines;
CREATE POLICY pipelines_delete ON public.pipelines
  FOR DELETE
  USING (organization_id IN (SELECT get_my_organization_ids()));

-- ============================================================
-- 7. Fix campanha_leads policies
-- ============================================================

DROP POLICY IF EXISTS campanha_leads_select_by_responsibility ON public.campanha_leads;
CREATE POLICY campanha_leads_select_by_responsibility ON public.campanha_leads
  FOR SELECT
  USING (
    campanha_id IN (
      SELECT c.id FROM campanhas c
      WHERE c.organization_id IN (SELECT get_my_organization_ids())
    )
    AND (
      is_user_admin()
      OR is_user_responsible(sdr_id, NULL::uuid, NULL::uuid)
      OR has_no_responsible(sdr_id, NULL::uuid, NULL::uuid)
    )
  );

DROP POLICY IF EXISTS campanha_leads_select_by_permissions ON public.campanha_leads;
CREATE POLICY campanha_leads_select_by_permissions ON public.campanha_leads
  FOR SELECT
  USING (
    campanha_id IN (
      SELECT c.id FROM campanhas c
      WHERE c.organization_id IN (SELECT get_my_organization_ids())
    )
    AND (
      is_user_admin()
      OR has_feature_permission('leads.view_all', (
        SELECT c2.organization_id FROM campanhas c2 WHERE c2.id = campanha_leads.campanha_id LIMIT 1
      ))
      OR can_see_lead_by_permissions(sdr_id, NULL::uuid)
    )
  );

DROP POLICY IF EXISTS campanha_leads_update_authorized ON public.campanha_leads;
CREATE POLICY campanha_leads_update_authorized ON public.campanha_leads
  FOR UPDATE
  USING (
    campanha_id IN (
      SELECT c.id FROM campanhas c
      WHERE c.organization_id IN (SELECT get_my_organization_ids())
    )
    AND (
      is_user_admin()
      OR is_user_responsible(sdr_id, closer_id, NULL::uuid)
      OR has_no_responsible(sdr_id, closer_id, NULL::uuid)
      OR is_campanha_viewer(campanha_id)
      OR is_campanha_member(campanha_id)
    )
  );

DROP POLICY IF EXISTS campanha_leads_delete_authorized ON public.campanha_leads;
CREATE POLICY campanha_leads_delete_authorized ON public.campanha_leads
  FOR DELETE
  USING (
    campanha_id IN (
      SELECT c.id FROM campanhas c
      WHERE c.organization_id IN (SELECT get_my_organization_ids())
    )
    AND (
      is_user_admin()
      OR is_campanha_viewer(campanha_id)
      OR is_campanha_member(campanha_id)
      OR is_user_responsible(sdr_id, closer_id, NULL::uuid)
    )
  );

-- ============================================================
-- 8. Fix follow_ups policies
-- ============================================================

DROP POLICY IF EXISTS follow_ups_delete_configurable ON public.follow_ups;
CREATE POLICY follow_ups_delete_configurable ON public.follow_ups
  FOR DELETE
  USING (
    can_delete_lead()
    AND (SELECT l.organization_id FROM leads l WHERE l.id = follow_ups.lead_id LIMIT 1)
        IN (SELECT get_my_organization_ids())
  );

-- ============================================================
-- 9. Fix goals policies
-- ============================================================

DROP POLICY IF EXISTS goals_select_org ON public.goals;
CREATE POLICY goals_select_org ON public.goals
  FOR SELECT
  USING (team_member_id IN (SELECT get_my_team_member_ids())
    OR EXISTS (
      SELECT 1 FROM public.team_members t
      WHERE t.id = goals.team_member_id
        AND t.organization_id IN (SELECT get_my_organization_ids())
    )
  );

DROP POLICY IF EXISTS goals_manage_admin_org ON public.goals;
CREATE POLICY goals_manage_admin_org ON public.goals
  FOR ALL
  USING (
    (is_user_admin() OR is_master_user())
    AND EXISTS (
      SELECT 1 FROM public.team_members t
      WHERE t.id = goals.team_member_id
        AND t.organization_id IN (SELECT get_my_organization_ids())
    )
  );

-- ============================================================
-- 10. Fix commissions policies
-- ============================================================

DROP POLICY IF EXISTS commissions_select_org ON public.commissions;
CREATE POLICY commissions_select_org ON public.commissions
  FOR SELECT
  USING (
    team_member_id IN (SELECT get_my_team_member_ids())
    OR EXISTS (
      SELECT 1 FROM public.team_members t
      WHERE t.id = commissions.team_member_id
        AND t.organization_id IN (SELECT get_my_organization_ids())
    )
  );

DROP POLICY IF EXISTS "Usuários podem ver próprias comissões" ON public.commissions;
CREATE POLICY "Usuários podem ver próprias comissões" ON public.commissions
  FOR SELECT
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR team_member_id IN (SELECT get_my_team_member_ids())
  );

-- ============================================================
-- 11. Fix phone_ai_preferences policies
-- ============================================================

DROP POLICY IF EXISTS phone_ai_prefs_select_same_org ON public.phone_ai_preferences;
CREATE POLICY phone_ai_prefs_select_same_org ON public.phone_ai_preferences
  FOR SELECT
  USING (organization_id IN (SELECT get_my_organization_ids()));

-- ============================================================
-- 12. Fix INSERT policies on publication tables (also had inline team_members)
-- ============================================================

DROP POLICY IF EXISTS whatsapp_messages_insert_admin_service ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_insert_admin_service ON public.whatsapp_messages
  FOR INSERT
  WITH CHECK (
    (auth.role() = 'service_role')
    OR (is_user_admin() AND organization_id IN (SELECT get_my_organization_ids()))
  );

DROP POLICY IF EXISTS leads_insert_organization ON public.leads;
CREATE POLICY leads_insert_organization ON public.leads
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS pipeline_entries_insert ON public.pipeline_entries;
CREATE POLICY pipeline_entries_insert ON public.pipeline_entries
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS pipelines_insert ON public.pipelines;
CREATE POLICY pipelines_insert ON public.pipelines
  FOR INSERT
  WITH CHECK (organization_id IN (SELECT get_my_organization_ids()));

DROP POLICY IF EXISTS campanha_leads_insert_organization ON public.campanha_leads;
CREATE POLICY campanha_leads_insert_organization ON public.campanha_leads
  FOR INSERT
  WITH CHECK (
    campanha_id IN (
      SELECT c.id FROM campanhas c
      WHERE c.organization_id IN (SELECT get_my_organization_ids())
    )
  );

-- ============================================================
-- 13. Remove team_members from Realtime publication (if still there)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'team_members'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.team_members;
  END IF;
END
$$;
