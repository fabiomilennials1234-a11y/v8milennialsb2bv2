-- =================================================================
-- FIX: Permissao configuravel para excluir leads e registros de pipe
--
-- Adiciona 'can_delete_leads' como permission_key configuravel
-- no sistema de permissoes existente (organization_role_permissions
-- + team_member_org_permissions).
--
-- Admin/master sempre podem deletar. SDR/Closer podem se tiverem
-- a permissao 'can_delete_leads' habilitada.
-- =================================================================

-- ============================================
-- 1. GARANTIR is_user_admin() ATUALIZADA
-- ============================================
CREATE OR REPLACE FUNCTION public.is_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  OR EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
  )
$$;

-- ============================================
-- 2. ADICIONAR 'can_delete_leads' AO CHECK CONSTRAINT
-- ============================================

-- organization_role_permissions
ALTER TABLE public.organization_role_permissions
  DROP CONSTRAINT IF EXISTS organization_role_permissions_permission_key_check;
ALTER TABLE public.organization_role_permissions
  ADD CONSTRAINT organization_role_permissions_permission_key_check
  CHECK (permission_key IN (
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads',
    'can_delete_leads'
  ));

-- team_member_org_permissions
ALTER TABLE public.team_member_org_permissions
  DROP CONSTRAINT IF EXISTS team_member_org_permissions_permission_key_check;
ALTER TABLE public.team_member_org_permissions
  ADD CONSTRAINT team_member_org_permissions_permission_key_check
  CHECK (permission_key IN (
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads',
    'can_delete_leads'
  ));

-- ============================================
-- 3. FUNCAO AUXILIAR: can_delete_lead
--    Admin/master sempre true. Senao checa permissao.
-- ============================================
CREATE OR REPLACE FUNCTION public.can_delete_lead()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_user_admin()
    OR public.is_master_user()
    OR public.user_has_org_permission('can_delete_leads')
$$;

-- ============================================
-- 4. POLICIES DE DELETE — usando can_delete_lead()
-- ============================================

-- pipe_propostas
DROP POLICY IF EXISTS "pipe_propostas_delete_admin_only" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_delete_configurable"
  ON public.pipe_propostas FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- leads
DROP POLICY IF EXISTS "leads_delete_admin_only" ON public.leads;
CREATE POLICY "leads_delete_configurable"
  ON public.leads FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- pipe_whatsapp
DROP POLICY IF EXISTS "pipe_whatsapp_delete_admin_only" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_delete_configurable"
  ON public.pipe_whatsapp FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- pipe_confirmacao
DROP POLICY IF EXISTS "pipe_confirmacao_delete_admin_only" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_delete_configurable"
  ON public.pipe_confirmacao FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================
-- 5. TABELAS RELACIONADAS (cascade delete)
-- ============================================

-- lead_tags
DROP POLICY IF EXISTS "lead_tags_delete_admin" ON public.lead_tags;
CREATE POLICY "lead_tags_delete_configurable"
  ON public.lead_tags FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- lead_history
DROP POLICY IF EXISTS "lead_history_delete_admin" ON public.lead_history;
CREATE POLICY "lead_history_delete_configurable"
  ON public.lead_history FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- follow_ups
DROP POLICY IF EXISTS "follow_ups_delete_admin" ON public.follow_ups;
CREATE POLICY "follow_ups_delete_configurable"
  ON public.follow_ups FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- lead_custom_field_values
DROP POLICY IF EXISTS "lead_custom_field_values_delete_admin" ON public.lead_custom_field_values;
CREATE POLICY "lead_custom_field_values_delete_configurable"
  ON public.lead_custom_field_values FOR DELETE TO authenticated
  USING (
    public.can_delete_lead()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );
