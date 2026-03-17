-- ============================================================
-- Permissões granulares para Copilot e WhatsApp
--
-- Objetivo: permitir que members com a feature habilitada pelo admin
-- possam criar/editar/ativar agentes Copilot e gerenciar instâncias WhatsApp.
--
-- Mudanças:
-- 1. Novas funções: can_manage_copilot(), can_manage_whatsapp_instances()
-- 2. RLS copilot_agents/faqs/kanban_rules: substitui is_admin_or_closer()
-- 3. RLS whatsapp_instances: fecha gap de segurança (antes qualquer membro podia)
-- 4. RLS whatsapp_instance_allowed_members: substitui is_admin_or_closer()
-- 5. feature_permissions: whatsapp.manage_instances e whatsapp.archive → is_admin_only = false
-- ============================================================

-- ─── 1. Funções de permissão ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_manage_copilot()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF public.is_user_admin() THEN RETURN true; END IF;
  RETURN public.has_feature_permission('copilot.create');
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_whatsapp_instances()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF public.is_user_admin() THEN RETURN true; END IF;
  RETURN public.has_feature_permission('whatsapp.manage_instances');
END;
$$;

-- ─── 2. RLS copilot_agents ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins and closers can insert agents" ON public.copilot_agents;
DROP POLICY IF EXISTS "members_can_insert_copilot_agents" ON public.copilot_agents;
CREATE POLICY "members_can_insert_copilot_agents"
  ON public.copilot_agents FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.can_manage_copilot()
  );

DROP POLICY IF EXISTS "Admins and closers can update agents from their organization" ON public.copilot_agents;
DROP POLICY IF EXISTS "members_can_update_copilot_agents" ON public.copilot_agents;
CREATE POLICY "members_can_update_copilot_agents"
  ON public.copilot_agents FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.can_manage_copilot()
  );

DROP POLICY IF EXISTS "Admins and closers can delete agents from their organization" ON public.copilot_agents;
DROP POLICY IF EXISTS "members_can_delete_copilot_agents" ON public.copilot_agents;
CREATE POLICY "members_can_delete_copilot_agents"
  ON public.copilot_agents FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.can_manage_copilot()
  );

-- ─── 3. RLS copilot_agent_faqs ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins and closers can manage FAQs" ON public.copilot_agent_faqs;
DROP POLICY IF EXISTS "members_can_manage_copilot_faqs" ON public.copilot_agent_faqs;
CREATE POLICY "members_can_manage_copilot_faqs"
  ON public.copilot_agent_faqs FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.can_manage_copilot()
  )
  WITH CHECK (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.can_manage_copilot()
  );

-- ─── 4. RLS copilot_agent_kanban_rules ──────────────────────────────────────

DROP POLICY IF EXISTS "Admins and closers can manage Kanban rules" ON public.copilot_agent_kanban_rules;
DROP POLICY IF EXISTS "members_can_manage_copilot_kanban_rules" ON public.copilot_agent_kanban_rules;
CREATE POLICY "members_can_manage_copilot_kanban_rules"
  ON public.copilot_agent_kanban_rules FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.can_manage_copilot()
  )
  WITH CHECK (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.can_manage_copilot()
  );

-- ─── 5. RLS whatsapp_instances ──────────────────────────────────────────────
-- Antes: qualquer membro da org podia INSERT/UPDATE/DELETE (gap de segurança).
-- Agora: somente quem tem can_manage_whatsapp_instances().
-- SELECT mantido sem mudança: qualquer membro pode listar instâncias.

DROP POLICY IF EXISTS "Users can insert WhatsApp instances in their organization" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "members_can_insert_whatsapp_instances" ON public.whatsapp_instances;
CREATE POLICY "members_can_insert_whatsapp_instances"
  ON public.whatsapp_instances FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.can_manage_whatsapp_instances()
  );

DROP POLICY IF EXISTS "Users can update WhatsApp instances in their organization" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "members_can_update_whatsapp_instances" ON public.whatsapp_instances;
CREATE POLICY "members_can_update_whatsapp_instances"
  ON public.whatsapp_instances FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.can_manage_whatsapp_instances()
  );

DROP POLICY IF EXISTS "Users can delete WhatsApp instances in their organization" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "members_can_delete_whatsapp_instances" ON public.whatsapp_instances;
CREATE POLICY "members_can_delete_whatsapp_instances"
  ON public.whatsapp_instances FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.can_manage_whatsapp_instances()
  );

-- ─── 6. RLS whatsapp_instance_allowed_members ───────────────────────────────

DROP POLICY IF EXISTS "allowed_members_insert_admin_or_closer" ON public.whatsapp_instance_allowed_members;
DROP POLICY IF EXISTS "members_can_insert_allowed_members" ON public.whatsapp_instance_allowed_members;
CREATE POLICY "members_can_insert_allowed_members"
  ON public.whatsapp_instance_allowed_members FOR INSERT
  WITH CHECK (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      WHERE tm.user_id = auth.uid()
    )
    AND public.can_manage_whatsapp_instances()
  );

DROP POLICY IF EXISTS "allowed_members_update_admin_or_closer" ON public.whatsapp_instance_allowed_members;
DROP POLICY IF EXISTS "members_can_update_allowed_members" ON public.whatsapp_instance_allowed_members;
CREATE POLICY "members_can_update_allowed_members"
  ON public.whatsapp_instance_allowed_members FOR UPDATE
  USING (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      WHERE tm.user_id = auth.uid()
    )
    AND public.can_manage_whatsapp_instances()
  );

DROP POLICY IF EXISTS "allowed_members_delete_admin_or_closer" ON public.whatsapp_instance_allowed_members;
DROP POLICY IF EXISTS "members_can_delete_allowed_members" ON public.whatsapp_instance_allowed_members;
CREATE POLICY "members_can_delete_allowed_members"
  ON public.whatsapp_instance_allowed_members FOR DELETE
  USING (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      WHERE tm.user_id = auth.uid()
    )
    AND public.can_manage_whatsapp_instances()
  );

-- ─── 7. Desbloquear whatsapp.manage_instances e whatsapp.archive ─────────────
-- is_admin_only = true impede que admin conceda a feature a members.
-- Alterando para false permite que admin configure isso em Equipe → Permissões.

UPDATE public.feature_permissions
SET is_admin_only = false
WHERE key IN ('whatsapp.manage_instances', 'whatsapp.archive');
