-- RLS: considerar team_member_permissions (matriz por usuário) além de organization_role_permissions
-- Assim o admin pode marcar "Se responsável" + "Sem responsável" na tela Permissões de personalização
-- e o usuário passa a ver os dois escopos ao mesmo tempo.
-- Data: 2026-02-18

-- Função: usuário vê lead/pipe se algum escopo de view em team_member_permissions permitir
CREATE OR REPLACE FUNCTION public.can_see_lead_by_team_member_permissions(
  p_organization_id UUID,
  p_resource_key TEXT,
  p_sdr_id UUID,
  p_closer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tm_id UUID;
  v_value TEXT;
  v_can_see BOOLEAN := false;
BEGIN
  SELECT tm.id INTO v_tm_id
  FROM public.team_members tm
  WHERE tm.user_id = auth.uid()
    AND tm.organization_id = p_organization_id
    AND tm.is_active = true
  LIMIT 1;

  IF v_tm_id IS NULL THEN
    RETURN false;
  END IF;

  FOR v_value IN
    SELECT tmp.value
    FROM public.team_member_permissions tmp
    WHERE tmp.team_member_id = v_tm_id
      AND tmp.resource_key = p_resource_key
      AND tmp.action_key = 'view'
      AND tmp.value <> 'denied'
  LOOP
    IF v_value = 'if_responsible' AND public.is_user_responsible(p_sdr_id, p_closer_id, NULL) THEN
      v_can_see := true;
      EXIT;
    ELSIF v_value = 'unassigned' AND public.has_no_responsible(p_sdr_id, p_closer_id, NULL) THEN
      v_can_see := true;
      EXIT;
    ELSIF v_value = 'team_access' AND public.is_responsible_in_same_org(p_sdr_id, p_closer_id) THEN
      v_can_see := true;
      EXIT;
    ELSIF v_value = 'allowed' THEN
      v_can_see := true;
      EXIT;
    END IF;
  END LOOP;

  RETURN v_can_see;
END;
$$;

COMMENT ON FUNCTION public.can_see_lead_by_team_member_permissions IS 'Usado no RLS: verifica escopos de view em team_member_permissions (if_responsible, unassigned, team_access, allowed). Permite combinar "Se responsável" + "Sem responsável" na tela de permissões.';

-- =====================================================
-- Atualizar políticas: visível se (role OU matriz por usuário)
-- =====================================================

-- LEADS
DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
    )
  );

DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
    )
  );

-- PIPE_CONFIRMACAO
DROP POLICY IF EXISTS "pipe_confirmacao_select_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_select_by_permissions"
  ON public.pipe_confirmacao FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'pipe_confirmacao', sdr_id, closer_id)
    )
  );

DROP POLICY IF EXISTS "pipe_confirmacao_update_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_update_by_permissions"
  ON public.pipe_confirmacao FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'pipe_confirmacao', sdr_id, closer_id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- PIPE_PROPOSTAS (organization_id vem do lead)
DROP POLICY IF EXISTS "pipe_propostas_select_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_select_by_permissions"
  ON public.pipe_propostas FOR SELECT
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
      OR public.can_see_lead_by_team_member_permissions(
        (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1),
        'pipe_propostas',
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  );

DROP POLICY IF EXISTS "pipe_propostas_update_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_update_by_permissions"
  ON public.pipe_propostas FOR UPDATE
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
      OR public.can_see_lead_by_team_member_permissions(
        (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1),
        'pipe_propostas',
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  )
  WITH CHECK (true);

-- PIPE_WHATSAPP
DROP POLICY IF EXISTS "pipe_whatsapp_select_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_select_by_permissions"
  ON public.pipe_whatsapp FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'pipe_whatsapp', sdr_id, NULL)
    )
  );

DROP POLICY IF EXISTS "pipe_whatsapp_update_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_update_by_permissions"
  ON public.pipe_whatsapp FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.user_has_org_permission('see_all_leads')
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'pipe_whatsapp', sdr_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- CAMPANHA_LEADS
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
    )
  );
