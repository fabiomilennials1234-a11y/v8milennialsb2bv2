-- ============================================================================
-- HOTFIX Fase 2: membros com tela bloqueada + não conseguem desativar copilot
--
-- Incidente 2026-04-24. Root cause do lado do banco:
--
-- 1. `get_user_organization_id()` fazia `LIMIT 1` sem ORDER BY → retornava
--    organização arbitrária para usuários multi-org. A execução podia
--    variar entre chamadas da mesma transação, bagunçando `has_feature_permission`.
--
-- 2. `has_feature_permission(key)` dependia internamente de
--    `get_user_organization_id()`. Em RLS avaliada contra uma row que já
--    carrega `organization_id`, essa indireção introduz inconsistência: o
--    filtro "tenho permissão nesta ORG" pode resolver para uma ORG diferente
--    da row sendo avaliada.
--
-- 3. `can_manage_copilot()` / `can_manage_whatsapp_instances()` herdavam o
--    problema via `has_feature_permission`.
--
-- Solução:
--   A) Tornar `get_user_organization_id()` determinístico (ORDER BY).
--   B) Criar sobrecargas `has_feature_permission(key, org_id)`,
--      `can_manage_copilot(org_id)`, `can_manage_whatsapp_instances(org_id)`
--      que aceitam organização explícita.
--   C) As versões sem parâmetro continuam existindo (chamam a sobrecarga
--      com `get_user_organization_id()`) — não quebra callers existentes.
--   D) Recriar RLS policies críticas de copilot e whatsapp_instances
--      passando `organization_id` da row. Em leads/pipes não é necessário
--      porque a checagem nunca era cross-org ali (organization_id já é
--      filtrado via IN team_members) mas passar a ORG explícita a
--      `has_feature_permission` ainda é correto.
--
-- Idempotente. CREATE OR REPLACE + DROP POLICY IF EXISTS em tudo.
-- ============================================================================


-- ─── A) get_user_organization_id determinístico ────────────────────────────
-- ORDER BY created_at ASC garante a mesma resposta entre chamadas; quando
-- o frontend usar org_switcher, chamadas devem passar org_id explícita.
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
  ORDER BY created_at ASC, id ASC
  LIMIT 1
$$;


-- ─── B) has_feature_permission(key, org_id) — nova canônica ────────────────
-- Avalia a feature contra uma organização explícita. Usado por RLS que
-- passa `organization_id` da row sendo verificada.
CREATE OR REPLACE FUNCTION public.has_feature_permission(
  p_feature_key TEXT,
  p_org_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_member_id UUID;
  v_is_admin BOOLEAN;
  v_enabled BOOLEAN;
  v_default BOOLEAN;
  v_admin_only BOOLEAN;
BEGIN
  -- Master admin tem tudo
  IF public.is_master_user() THEN RETURN true; END IF;

  IF p_org_id IS NULL THEN RETURN false; END IF;

  -- Buscar team_member do usuário atual NA ORG EXPLÍCITA
  SELECT id, (role = 'admin') INTO v_team_member_id, v_is_admin
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  -- Admin da ORG tem acesso a tudo
  IF v_is_admin THEN RETURN true; END IF;

  -- Verificar se feature é admin-only
  SELECT fp.is_admin_only, fp.default_value INTO v_admin_only, v_default
  FROM public.feature_permissions fp WHERE fp.key = p_feature_key;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_admin_only THEN RETURN false; END IF;

  -- Override individual
  SELECT mfp.enabled INTO v_enabled
  FROM public.member_feature_permissions mfp
  WHERE mfp.team_member_id = v_team_member_id
    AND mfp.feature_key = p_feature_key;

  RETURN COALESCE(v_enabled, v_default);
END;
$$;


-- ─── C) has_feature_permission(key) — delega para a sobrecarga ─────────────
CREATE OR REPLACE FUNCTION public.has_feature_permission(p_feature_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_feature_permission(
    p_feature_key,
    public.get_user_organization_id()
  )
$$;


-- ─── D) can_manage_copilot(org_id) sobrecarga ───────────────────────────────
CREATE OR REPLACE FUNCTION public.can_manage_copilot(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;
  -- Admin da própria org
  IF EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
      AND role = 'admin'
      AND is_active = true
  ) THEN
    RETURN true;
  END IF;
  RETURN public.has_feature_permission('copilot.create', p_org_id);
END;
$$;

-- Versão sem parâmetro (compat) — usa get_user_organization_id
CREATE OR REPLACE FUNCTION public.can_manage_copilot()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_copilot(public.get_user_organization_id())
$$;


-- ─── E) can_manage_whatsapp_instances(org_id) sobrecarga ───────────────────
CREATE OR REPLACE FUNCTION public.can_manage_whatsapp_instances(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND organization_id = p_org_id
      AND role = 'admin'
      AND is_active = true
  ) THEN
    RETURN true;
  END IF;
  RETURN public.has_feature_permission('whatsapp.manage_instances', p_org_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_whatsapp_instances()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_whatsapp_instances(public.get_user_organization_id())
$$;


-- ─── F) RLS copilot_agents — passar organization_id da row ─────────────────
DROP POLICY IF EXISTS "members_can_insert_copilot_agents" ON public.copilot_agents;
CREATE POLICY "members_can_insert_copilot_agents"
  ON public.copilot_agents FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND public.can_manage_copilot(organization_id)
  );

DROP POLICY IF EXISTS "members_can_update_copilot_agents" ON public.copilot_agents;
CREATE POLICY "members_can_update_copilot_agents"
  ON public.copilot_agents FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND public.can_manage_copilot(organization_id)
  );

DROP POLICY IF EXISTS "members_can_delete_copilot_agents" ON public.copilot_agents;
CREATE POLICY "members_can_delete_copilot_agents"
  ON public.copilot_agents FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND public.can_manage_copilot(organization_id)
  );


-- ─── G) RLS copilot_agent_faqs — derivar org do agent ──────────────────────
DROP POLICY IF EXISTS "members_can_manage_copilot_faqs" ON public.copilot_agent_faqs;
CREATE POLICY "members_can_manage_copilot_faqs"
  ON public.copilot_agent_faqs FOR ALL
  USING (
    agent_id IN (
      SELECT ca.id FROM public.copilot_agents ca
      WHERE ca.organization_id IN (
        SELECT organization_id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      )
      AND public.can_manage_copilot(ca.organization_id)
    )
  )
  WITH CHECK (
    agent_id IN (
      SELECT ca.id FROM public.copilot_agents ca
      WHERE ca.organization_id IN (
        SELECT organization_id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      )
      AND public.can_manage_copilot(ca.organization_id)
    )
  );


-- ─── H) RLS copilot_agent_kanban_rules — derivar org do agent ──────────────
DROP POLICY IF EXISTS "members_can_manage_copilot_kanban_rules" ON public.copilot_agent_kanban_rules;
CREATE POLICY "members_can_manage_copilot_kanban_rules"
  ON public.copilot_agent_kanban_rules FOR ALL
  USING (
    agent_id IN (
      SELECT ca.id FROM public.copilot_agents ca
      WHERE ca.organization_id IN (
        SELECT organization_id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      )
      AND public.can_manage_copilot(ca.organization_id)
    )
  )
  WITH CHECK (
    agent_id IN (
      SELECT ca.id FROM public.copilot_agents ca
      WHERE ca.organization_id IN (
        SELECT organization_id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      )
      AND public.can_manage_copilot(ca.organization_id)
    )
  );


-- ─── I) RLS whatsapp_instances — passar organization_id da row ─────────────
DROP POLICY IF EXISTS "members_can_insert_whatsapp_instances" ON public.whatsapp_instances;
CREATE POLICY "members_can_insert_whatsapp_instances"
  ON public.whatsapp_instances FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND public.can_manage_whatsapp_instances(organization_id)
  );

DROP POLICY IF EXISTS "members_can_update_whatsapp_instances" ON public.whatsapp_instances;
CREATE POLICY "members_can_update_whatsapp_instances"
  ON public.whatsapp_instances FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND public.can_manage_whatsapp_instances(organization_id)
  );

DROP POLICY IF EXISTS "members_can_delete_whatsapp_instances" ON public.whatsapp_instances;
CREATE POLICY "members_can_delete_whatsapp_instances"
  ON public.whatsapp_instances FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND public.can_manage_whatsapp_instances(organization_id)
  );


-- ─── J) RLS leads — passar organization_id da row para has_feature_permission ──
DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  );

DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
      OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
      OR public.is_user_responsible_in_any_pipe(id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );


-- ─── K) RLS pipe_confirmacao / pipe_whatsapp / pipe_propostas ──────────────
DROP POLICY IF EXISTS "pipe_confirmacao_select_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_select_by_permissions"
  ON public.pipe_confirmacao FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  );

DROP POLICY IF EXISTS "pipe_confirmacao_update_by_permissions" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_update_by_permissions"
  ON public.pipe_confirmacao FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

DROP POLICY IF EXISTS "pipe_whatsapp_select_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_select_by_permissions"
  ON public.pipe_whatsapp FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  );

DROP POLICY IF EXISTS "pipe_whatsapp_update_by_permissions" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_update_by_permissions"
  ON public.pipe_whatsapp FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission('leads.view_all', organization_id)
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- pipe_propostas deriva organization_id da tabela leads via lead_id.
DROP POLICY IF EXISTS "pipe_propostas_select_by_permissions" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_select_by_permissions"
  ON public.pipe_propostas FOR SELECT
  USING (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission(
        'leads.view_all',
        (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1)
      )
      OR public.can_see_lead_by_permissions(
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
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid() AND is_active = true
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission(
        'leads.view_all',
        (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1)
      )
      OR public.can_see_lead_by_permissions(
        (SELECT sdr_id FROM public.leads WHERE id = lead_id LIMIT 1),
        closer_id
      )
    )
  )
  WITH CHECK (true);


-- ─── L) RLS campanha_leads — passar organization_id da campanha ────────────
DROP POLICY IF EXISTS "campanha_leads_select_by_permissions" ON public.campanha_leads;
CREATE POLICY "campanha_leads_select_by_permissions"
  ON public.campanha_leads FOR SELECT
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      )
    )
    AND (
      public.is_user_admin()
      OR public.has_feature_permission(
        'leads.view_all',
        (SELECT organization_id FROM public.campanhas WHERE id = campanha_id LIMIT 1)
      )
      OR public.can_see_lead_by_permissions(sdr_id, NULL)
    )
  );


-- ─── M) RLS lead_history — propagar organization_id do lead (finding M1) ───
-- Security review Fase 2 apontou que essa policy (mig 20260901) usa
-- has_feature_permission sem org_id. Recriar com org explícita do lead.
DROP POLICY IF EXISTS "lead_history_select_by_lead" ON public.lead_history;
CREATE POLICY "lead_history_select_by_lead"
  ON public.lead_history FOR SELECT
  USING (
    lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members
        WHERE user_id = auth.uid() AND is_active = true
      )
      AND (
        public.is_user_admin()
        OR public.has_feature_permission('leads.view_all', organization_id)
        OR public.can_see_lead_by_permissions(sdr_id, closer_id)
        OR public.can_see_lead_by_team_member_permissions(organization_id, 'leads', sdr_id, closer_id)
        OR public.is_user_responsible_in_any_pipe(id)
      )
    )
  );


-- ============================================================================
-- DONE
-- Após aplicar esta migration:
--  - get_user_organization_id() é determinístico (ORDER BY)
--  - has_feature_permission aceita organização explícita
--  - Policies de copilot_agents, whatsapp_instances, leads, pipes e
--    campanha_leads avaliam permissão contra a ORG correta (da row),
--    nunca contra um "primeiro team_member ativo" arbitrário.
--
-- Impacto para membros: ação em row (read/update/delete) da organização X
-- só passa se o membro tem team_member ativo em X com a feature habilitada
-- (ou default). Elimina o cenário de 400/500 em edge function + Lock
-- screen gerado pela dependência multi-org.
-- ============================================================================
