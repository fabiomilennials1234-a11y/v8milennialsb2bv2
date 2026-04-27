-- Migration: Campanhas restritas por organização (multi-tenant)
-- Descrição: Remove políticas que permitiam ver/gerenciar campanhas de qualquer organização.
--            Cada organização passa a ver e criar apenas suas próprias campanhas.
-- Data: 2026-02-17

-- =====================================================
-- PARTE 1: CAMPANHAS
-- =====================================================

-- Remover políticas antigas (is_team_member / has_role admin sem filtro de org)
DROP POLICY IF EXISTS "Campanhas visíveis para team members" ON public.campanhas;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar campanhas" ON public.campanhas;

-- SELECT: usuário só vê campanhas das organizações em que é membro
DROP POLICY IF EXISTS "campanhas_select_organization" ON public.campanhas;
CREATE POLICY "campanhas_select_organization"
  ON public.campanhas FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- INSERT: apenas admins podem criar campanha, e só na sua organização
DROP POLICY IF EXISTS "campanhas_insert_organization_admin" ON public.campanhas;
CREATE POLICY "campanhas_insert_organization_admin"
  ON public.campanhas FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- UPDATE: apenas admins podem atualizar, e só campanhas da sua organização
DROP POLICY IF EXISTS "campanhas_update_organization_admin" ON public.campanhas;
CREATE POLICY "campanhas_update_organization_admin"
  ON public.campanhas FOR UPDATE
  TO authenticated
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- DELETE: apenas admins podem excluir, e só campanhas da sua organização
DROP POLICY IF EXISTS "campanhas_delete_organization_admin" ON public.campanhas;
CREATE POLICY "campanhas_delete_organization_admin"
  ON public.campanhas FOR DELETE
  TO authenticated
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 2: CAMPANHA_STAGES
-- =====================================================

DROP POLICY IF EXISTS "Stages visíveis para team members" ON public.campanha_stages;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar stages" ON public.campanha_stages;

-- SELECT: só stages de campanhas da organização do usuário
DROP POLICY IF EXISTS "campanha_stages_select_organization" ON public.campanha_stages;
CREATE POLICY "campanha_stages_select_organization"
  ON public.campanha_stages FOR SELECT
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- INSERT/UPDATE/DELETE: apenas admins, e só em campanhas da sua organização
DROP POLICY IF EXISTS "campanha_stages_insert_organization_admin" ON public.campanha_stages;
CREATE POLICY "campanha_stages_insert_organization_admin"
  ON public.campanha_stages FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "campanha_stages_update_organization_admin" ON public.campanha_stages;
CREATE POLICY "campanha_stages_update_organization_admin"
  ON public.campanha_stages FOR UPDATE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "campanha_stages_delete_organization_admin" ON public.campanha_stages;
CREATE POLICY "campanha_stages_delete_organization_admin"
  ON public.campanha_stages FOR DELETE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- =====================================================
-- PARTE 3: CAMPANHA_MEMBERS
-- =====================================================

DROP POLICY IF EXISTS "Members visíveis para team members" ON public.campanha_members;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar members" ON public.campanha_members;

-- SELECT: só members de campanhas da organização do usuário
DROP POLICY IF EXISTS "campanha_members_select_organization" ON public.campanha_members;
CREATE POLICY "campanha_members_select_organization"
  ON public.campanha_members FOR SELECT
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- INSERT/UPDATE/DELETE: apenas admins, e só em campanhas da sua organização
DROP POLICY IF EXISTS "campanha_members_insert_organization_admin" ON public.campanha_members;
CREATE POLICY "campanha_members_insert_organization_admin"
  ON public.campanha_members FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "campanha_members_update_organization_admin" ON public.campanha_members;
CREATE POLICY "campanha_members_update_organization_admin"
  ON public.campanha_members FOR UPDATE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "campanha_members_delete_organization_admin" ON public.campanha_members;
CREATE POLICY "campanha_members_delete_organization_admin"
  ON public.campanha_members FOR DELETE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );
