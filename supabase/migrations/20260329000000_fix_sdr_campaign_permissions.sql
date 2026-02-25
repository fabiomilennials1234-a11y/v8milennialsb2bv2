-- =================================================================
-- FIX: SDR não consegue enviar leads para pipe nem criar automações
--
-- Problemas encontrados:
--   1. campanha_pipe_automations INSERT/UPDATE/DELETE exige is_user_admin()
--      → SDR e viewers não conseguem criar/editar automações de pipe
--   2. campanha_leads DELETE exige admin OU viewer
--      → SDR membro da campanha não consegue extrair lead para pipe
--      (useExtractLeadToPipe faz DELETE de campanha_leads após INSERT no pipe)
--
-- Solução:
--   1. campanha_pipe_automations: permitir viewers e membros da campanha
--   2. campanha_leads DELETE: permitir membros da campanha (SDR/closer)
--   3. Helper function is_campanha_member() para reutilizar a verificação
-- =================================================================

-- ============================================
-- 1. HELPER: is_campanha_member(campanha_id)
--    Retorna true se o usuário é membro (SDR ou closer) da campanha
-- ============================================
CREATE OR REPLACE FUNCTION public.is_campanha_member(p_campanha_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campanha_members cm
    JOIN public.team_members tm ON tm.id = cm.team_member_id
      AND tm.user_id = auth.uid()
    WHERE cm.campanha_id = p_campanha_id
  )
$$;

-- ============================================
-- 2. campanha_pipe_automations INSERT: + viewer + member
-- ============================================
DROP POLICY IF EXISTS "campanha_pipe_automations_insert_organization_admin" ON public.campanha_pipe_automations;
DROP POLICY IF EXISTS "campanha_pipe_automations_insert_org" ON public.campanha_pipe_automations;
CREATE POLICY "campanha_pipe_automations_insert_org"
  ON public.campanha_pipe_automations FOR INSERT
  TO authenticated
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.is_campanha_viewer(campanha_id)
      OR public.is_campanha_member(campanha_id)
    )
  );

-- ============================================
-- 3. campanha_pipe_automations UPDATE: + viewer + member
-- ============================================
DROP POLICY IF EXISTS "campanha_pipe_automations_update_organization_admin" ON public.campanha_pipe_automations;
DROP POLICY IF EXISTS "campanha_pipe_automations_update_org" ON public.campanha_pipe_automations;
CREATE POLICY "campanha_pipe_automations_update_org"
  ON public.campanha_pipe_automations FOR UPDATE
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.is_campanha_viewer(campanha_id)
      OR public.is_campanha_member(campanha_id)
    )
  )
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- ============================================
-- 4. campanha_pipe_automations DELETE: + viewer + member
-- ============================================
DROP POLICY IF EXISTS "campanha_pipe_automations_delete_organization_admin" ON public.campanha_pipe_automations;
DROP POLICY IF EXISTS "campanha_pipe_automations_delete_org" ON public.campanha_pipe_automations;
CREATE POLICY "campanha_pipe_automations_delete_org"
  ON public.campanha_pipe_automations FOR DELETE
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.is_campanha_viewer(campanha_id)
      OR public.is_campanha_member(campanha_id)
    )
  );

-- ============================================
-- 5. campanha_leads DELETE: + member (SDR pode extrair lead para pipe)
-- ============================================
DROP POLICY IF EXISTS "campanha_leads_delete_admin_or_viewer" ON public.campanha_leads;
DROP POLICY IF EXISTS "campanha_leads_delete_admin_only" ON public.campanha_leads;
DROP POLICY IF EXISTS "campanha_leads_delete_authorized" ON public.campanha_leads;
CREATE POLICY "campanha_leads_delete_authorized"
  ON public.campanha_leads FOR DELETE
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.is_campanha_viewer(campanha_id)
      OR public.is_campanha_member(campanha_id)
      OR public.is_user_responsible(sdr_id, closer_id, NULL)
    )
  );

-- ============================================
-- 6. campanha_leads UPDATE: garantir que membro pode mover leads
-- ============================================
DROP POLICY IF EXISTS "campanha_leads_update_by_responsibility" ON public.campanha_leads;
DROP POLICY IF EXISTS "campanha_leads_update_authorized" ON public.campanha_leads;
CREATE POLICY "campanha_leads_update_authorized"
  ON public.campanha_leads FOR UPDATE
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.is_user_responsible(sdr_id, closer_id, NULL)
      OR public.has_no_responsible(sdr_id, closer_id, NULL)
      OR public.is_campanha_viewer(campanha_id)
      OR public.is_campanha_member(campanha_id)
    )
  )
  WITH CHECK (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );
