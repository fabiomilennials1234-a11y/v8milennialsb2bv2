-- =============================================================================
-- Fix: Alinhar RLS de lead_history com nova lógica de permissões de leads
--
-- A policy antiga usava is_user_responsible() e has_no_responsible() que não
-- consideram feature_permissions. A nova política usa can_see_lead_by_permissions()
-- que integra com o sistema novo de permissões, alinhando com a RLS de leads.
-- =============================================================================

-- SELECT: qualquer membro que pode ver o lead pode ver seu histórico
DROP POLICY IF EXISTS "lead_history_select_by_lead" ON public.lead_history;
CREATE POLICY "lead_history_select_by_lead"
  ON public.lead_history FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
      AND (
        public.is_user_admin()
        OR public.has_feature_permission('leads.view_all')
        OR public.can_see_lead_by_permissions(sdr_id, closer_id)
        OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
        OR public.is_user_responsible_in_any_pipe(id)
      )
    )
  );
