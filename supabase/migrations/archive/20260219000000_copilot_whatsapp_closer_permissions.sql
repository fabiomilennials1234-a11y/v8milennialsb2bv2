-- Description: Permite que Closers criem copilots, configurem agentes e gerenciem instâncias WhatsApp
-- Admin e Closer têm as mesmas permissões para: criar/editar/deletar copilots, FAQs, kanban rules, followup rules

-- Helper: condição para admin OU closer
CREATE OR REPLACE FUNCTION public.is_admin_or_closer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role IN ('admin', 'closer')
  );
$$;

-- =====================================================
-- copilot_agents: substituir policies admin-only por admin-or-closer
-- =====================================================

DROP POLICY IF EXISTS "Admins can insert agents" ON public.copilot_agents;
DROP POLICY IF EXISTS "Admins and closers can insert agents" ON public.copilot_agents;
CREATE POLICY "Admins and closers can insert agents"
  ON public.copilot_agents FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

DROP POLICY IF EXISTS "Admins can update agents from their organization" ON public.copilot_agents;
DROP POLICY IF EXISTS "Admins and closers can update agents from their organization" ON public.copilot_agents;
CREATE POLICY "Admins and closers can update agents from their organization"
  ON public.copilot_agents FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

DROP POLICY IF EXISTS "Admins can delete agents from their organization" ON public.copilot_agents;
DROP POLICY IF EXISTS "Admins and closers can delete agents from their organization" ON public.copilot_agents;
CREATE POLICY "Admins and closers can delete agents from their organization"
  ON public.copilot_agents FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND public.is_admin_or_closer()
  );

-- =====================================================
-- copilot_agent_faqs: substituir policy admin-only
-- =====================================================

DROP POLICY IF EXISTS "Admins can manage FAQs" ON public.copilot_agent_faqs;
DROP POLICY IF EXISTS "Admins and closers can manage FAQs" ON public.copilot_agent_faqs;
CREATE POLICY "Admins and closers can manage FAQs"
  ON public.copilot_agent_faqs FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.is_admin_or_closer()
  )
  WITH CHECK (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.is_admin_or_closer()
  );

-- =====================================================
-- copilot_agent_kanban_rules: substituir policy admin-only
-- =====================================================

DROP POLICY IF EXISTS "Admins can manage Kanban rules" ON public.copilot_agent_kanban_rules;
DROP POLICY IF EXISTS "Admins and closers can manage Kanban rules" ON public.copilot_agent_kanban_rules;
CREATE POLICY "Admins and closers can manage Kanban rules"
  ON public.copilot_agent_kanban_rules FOR ALL
  USING (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.is_admin_or_closer()
  )
  WITH CHECK (
    agent_id IN (
      SELECT id FROM public.copilot_agents
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
    AND public.is_admin_or_closer()
  );

-- Nota: copilot_agent_followup_rules já permite org members (migration 20260210)
