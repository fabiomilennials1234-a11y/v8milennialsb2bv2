-- ============================================================================
-- FIX: RLS de leads usa sistema de permissões legado (organization_role_permissions)
-- enquanto a UI usa o sistema novo (member_feature_permissions / has_feature_permission).
--
-- CAUSA RAIZ: Quando admin desabilita "Ver leads de todos" (leads.view_all) na UI,
-- ele atualiza member_feature_permissions. Mas o RLS ainda checa
-- user_has_org_permission('see_all_leads') do sistema antigo, que pode retornar true.
--
-- FIX: Substituir user_has_org_permission('see_all_leads') por
-- has_feature_permission('leads.view_all') em todas as policies RLS.
-- ============================================================================

-- ============================================================
-- 1) ATUALIZAR can_see_lead_by_permissions para usar novo sistema
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_see_lead_by_permissions(p_sdr_id UUID, p_closer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_user_responsible(p_sdr_id, p_closer_id, NULL)
    OR (public.has_no_responsible(p_sdr_id, p_closer_id, NULL) AND public.user_has_org_permission('see_unassigned_cards'))
    OR (public.is_responsible_in_same_org(p_sdr_id, p_closer_id) AND public.user_has_org_permission('see_subordinates_cards'))
    OR public.has_feature_permission('leads.view_all')
$$;

COMMENT ON FUNCTION public.can_see_lead_by_permissions IS 'Lead visível se: responsável direto, card sem responsável (com perm), equipe (com perm), ou leads.view_all ativo. Usa has_feature_permission (sistema novo).';

-- ============================================================
-- 2) LEADS: SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  );

-- ============================================================
-- 3) LEADS: UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
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
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 4) PIPE_CONFIRMACAO: SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "pipe_confirmacao_select_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_select_by_permissions"
  ON public.pipe_confirmacao FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  );

-- ============================================================
-- 5) PIPE_CONFIRMACAO: UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "pipe_confirmacao_update_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_update_by_permissions"
  ON public.pipe_confirmacao FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 6) PIPE_PROPOSTAS: SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "pipe_propostas_select_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_select_by_permissions"
  ON public.pipe_propostas FOR SELECT
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  );

-- ============================================================
-- 7) PIPE_PROPOSTAS: UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "pipe_propostas_update_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_update_by_permissions"
  ON public.pipe_propostas FOR UPDATE
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  )
  WITH CHECK (true);

-- ============================================================
-- 8) PIPE_WHATSAPP: SELECT policy
-- ============================================================
DROP POLICY IF EXISTS "pipe_whatsapp_select_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_select_by_permissions"
  ON public.pipe_whatsapp FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  );

-- ============================================================
-- 9) PIPE_WHATSAPP: UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "pipe_whatsapp_update_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_update_by_permissions"
  ON public.pipe_whatsapp FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 10) CAMPANHA_LEADS: SELECT policy
-- ============================================================
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
      OR public.has_feature_permission('leads.view_all')
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  );

-- ============================================================
-- DONE: Todas as policies de leads/pipes agora usam
-- has_feature_permission('leads.view_all') em vez de
-- user_has_org_permission('see_all_leads').
-- ============================================================
