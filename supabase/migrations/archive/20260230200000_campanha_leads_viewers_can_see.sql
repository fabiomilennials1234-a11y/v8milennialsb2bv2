-- Quem foi adicionado como viewer da campanha (campanha_allowed_viewers) pode ver todos os leads dessa campanha.
-- Assim, vendedor, closer externo ou qualquer pessoa adicionada à visualização enxerga os leads dentro da campanha.

DROP POLICY IF EXISTS "campanha_leads_select_by_permissions" ON public.campanha_leads;

CREATE POLICY "campanha_leads_select_by_permissions"
  ON public.campanha_leads FOR SELECT
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
      OR public.can_see_lead_by_team_member_permissions(
        (SELECT organization_id FROM public.campanhas WHERE id = campanha_id LIMIT 1),
        'campanhas',
        sdr_id,
        NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.campanha_allowed_viewers av
        JOIN public.team_members tm ON tm.id = av.team_member_id AND tm.user_id = auth.uid()
        WHERE av.campanha_id = campanha_leads.campanha_id
      )
    )
  );
