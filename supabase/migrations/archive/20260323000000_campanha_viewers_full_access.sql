-- =================================================================
-- CAMPANHA VIEWERS: Acesso completo para usuários com visualização
--
-- Problema:
--   Usuários listados em campanha_allowed_viewers conseguem VER
--   leads da campanha (SELECT), mas NÃO conseguem:
--   - Mover leads entre etapas (UPDATE campanha_leads)
--   - Deletar leads da campanha (DELETE campanha_leads)
--   - Editar configurações da campanha (UPDATE campanhas)
--   - Gerenciar etapas (INSERT/UPDATE/DELETE campanha_stages)
--
-- Solução:
--   1. Criar function helper is_campanha_viewer(campanha_id)
--   2. Adicionar OR is_campanha_viewer() nas policies afetadas
--
-- Tabelas afetadas:
--   - campanha_leads (UPDATE, DELETE)
--   - campanhas (UPDATE)
--   - campanha_stages (INSERT, UPDATE, DELETE)
--
-- NÃO afetadas (já funcionam):
--   - campanha_leads SELECT (já tem viewer check)
--   - campanha_leads INSERT (org membership, sem admin)
--   - campanhas SELECT (já tem viewer check)
--   - campanhas INSERT/DELETE (permanece admin-only)
--   - campanha_dispatch_rules (org membership)
--   - campanha_dispatch_rule_steps (org membership)
-- =================================================================

-- ============================================
-- 1. HELPER FUNCTION: is_campanha_viewer()
-- ============================================
CREATE OR REPLACE FUNCTION public.is_campanha_viewer(p_campanha_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campanha_allowed_viewers av
    JOIN public.team_members tm ON tm.id = av.team_member_id
      AND tm.user_id = auth.uid()
    WHERE av.campanha_id = p_campanha_id
  )
$$;

-- ============================================
-- 2. campanha_leads UPDATE: + viewer
-- ============================================
DROP POLICY IF EXISTS "campanha_leads_update_by_responsibility" ON public.campanha_leads;
CREATE POLICY "campanha_leads_update_by_responsibility"
  ON public.campanha_leads FOR UPDATE
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND (
      public.is_user_admin()
      OR public.is_user_responsible(sdr_id, NULL, NULL)
      OR public.has_no_responsible(sdr_id, NULL, NULL)
      OR public.is_campanha_viewer(campanha_id)
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
-- 3. campanha_leads DELETE: + viewer
-- ============================================
DROP POLICY IF EXISTS "campanha_leads_delete_admin_only" ON public.campanha_leads;
CREATE POLICY "campanha_leads_delete_admin_or_viewer"
  ON public.campanha_leads FOR DELETE
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
    )
  );

-- ============================================
-- 4. campanhas UPDATE: + viewer
-- ============================================
DROP POLICY IF EXISTS "campanhas_update_organization_admin" ON public.campanhas;
CREATE POLICY "campanhas_update_organization_admin_or_viewer"
  ON public.campanhas FOR UPDATE TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR public.is_campanha_viewer(id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- 5. campanha_stages INSERT: + viewer
-- ============================================
DROP POLICY IF EXISTS "campanha_stages_insert_organization_admin" ON public.campanha_stages;
CREATE POLICY "campanha_stages_insert_admin_or_viewer"
  ON public.campanha_stages FOR INSERT TO authenticated
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
    )
  );

-- ============================================
-- 6. campanha_stages UPDATE: + viewer
-- ============================================
DROP POLICY IF EXISTS "campanha_stages_update_organization_admin" ON public.campanha_stages;
CREATE POLICY "campanha_stages_update_admin_or_viewer"
  ON public.campanha_stages FOR UPDATE TO authenticated
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
    )
  );

-- ============================================
-- 7. campanha_stages DELETE: + viewer
-- ============================================
DROP POLICY IF EXISTS "campanha_stages_delete_organization_admin" ON public.campanha_stages;
CREATE POLICY "campanha_stages_delete_admin_or_viewer"
  ON public.campanha_stages FOR DELETE TO authenticated
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
    )
  );
