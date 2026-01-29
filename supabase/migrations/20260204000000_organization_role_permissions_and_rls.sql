-- Migration: Permissões por role na organização + RLS por responsabilidade
-- Descrição: Admin configura quais permissões SDR/Closer têm (ver cards sem responsável,
--            ver cards de outros da equipe, informações gerais, ver todos os leads).
--            Pódio permanece visível para todos. Dashboard/central de controle só mostra
--            dados do usuário (admin vê tudo). Sem permissão, usuário vê apenas onde é responsável.
-- Data: 2026-02-04

-- =====================================================
-- PARTE 1: TABELA organization_role_permissions
-- =====================================================

CREATE TABLE IF NOT EXISTS public.organization_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('sdr', 'closer', 'member')),
  permission_key TEXT NOT NULL CHECK (permission_key IN (
    'see_unassigned_cards',
    'see_subordinates_cards',
    'see_general_info',
    'see_all_leads'
  )),
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, role, permission_key)
);

COMMENT ON TABLE public.organization_role_permissions IS 'Permissões por role (sdr, closer, member) por organização. Admin configura no painel; admin sempre tem todas.';

CREATE INDEX IF NOT EXISTS idx_org_role_permissions_org_role
  ON public.organization_role_permissions(organization_id, role);

ALTER TABLE public.organization_role_permissions ENABLE ROW LEVEL SECURITY;

-- Apenas membros da org podem ler; apenas admins podem alterar
CREATE POLICY "org_role_permissions_select_own_org"
  ON public.organization_role_permissions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "org_role_permissions_insert_admin"
  ON public.organization_role_permissions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "org_role_permissions_update_admin"
  ON public.organization_role_permissions FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "org_role_permissions_delete_admin"
  ON public.organization_role_permissions FOR DELETE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Inserir registros default para organizações existentes (todas permissões false)
INSERT INTO public.organization_role_permissions (organization_id, role, permission_key, enabled)
  SELECT o.id, r.role, p.permission_key, false
  FROM public.organizations o
  CROSS JOIN (VALUES ('sdr'), ('closer'), ('member')) AS r(role)
  CROSS JOIN (VALUES ('see_unassigned_cards'), ('see_subordinates_cards'), ('see_general_info'), ('see_all_leads')) AS p(permission_key)
  ON CONFLICT (organization_id, role, permission_key) DO NOTHING;

-- =====================================================
-- PARTE 2: FUNÇÕES DE PERMISSÃO
-- =====================================================

-- Retorna o role do usuário na organização (via team_members)
CREATE OR REPLACE FUNCTION public.get_user_org_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.role::text
  FROM public.team_members tm
  WHERE tm.user_id = auth.uid() AND tm.is_active = true
  LIMIT 1
$$;

-- Verifica se o usuário tem uma permissão habilitada para seu role na org (admin sempre true)
CREATE OR REPLACE FUNCTION public.user_has_org_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT true FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin' LIMIT 1),
    (SELECT orp.enabled
     FROM public.organization_role_permissions orp
     JOIN public.team_members tm ON tm.organization_id = orp.organization_id AND tm.role::text = orp.role
     WHERE tm.user_id = auth.uid() AND tm.is_active = true
       AND orp.permission_key = p_permission_key
     LIMIT 1),
    false
  )
$$;

-- Verifica se o responsável (sdr_id ou closer_id) é outro team_member da mesma org do usuário
CREATE OR REPLACE FUNCTION public.is_responsible_in_same_org(p_sdr_id UUID, p_closer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm_user
    JOIN public.team_members tm_resp ON tm_resp.organization_id = tm_user.organization_id
    WHERE tm_user.user_id = auth.uid()
      AND (tm_resp.id = p_sdr_id OR tm_resp.id = p_closer_id)
      AND tm_resp.id IS NOT NULL
  )
$$;

-- Lead/pipe item visível considerando responsabilidade + permissões (sem ser admin)
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
    OR public.user_has_org_permission('see_all_leads')
$$;

-- =====================================================
-- PARTE 3: SUBSTITUIR RLS LEADS (responsabilidade + permissões)
-- =====================================================

DROP POLICY IF EXISTS "leads_select_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_update_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;

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
    )
  );

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
    )
  );

-- DELETE continua apenas admin
DROP POLICY IF EXISTS "leads_delete_organization" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_admin_only" ON public.leads;
CREATE POLICY "leads_delete_admin_only"
  ON public.leads FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 4: SUBSTITUIR RLS PIPE_CONFIRMACAO
-- =====================================================

DROP POLICY IF EXISTS "pipe_confirmacao_via_lead" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "pipe_confirmacao_select_by_responsibility" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "pipe_confirmacao_update_by_responsibility" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "pipe_confirmacao_delete_admin_only" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "pipe_confirmacao_select_by_permissions" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "pipe_confirmacao_update_by_permissions" ON public.pipe_confirmacao;
DROP POLICY IF EXISTS "pipe_confirmacao_insert_organization" ON public.pipe_confirmacao;

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
    )
  );

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
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "pipe_confirmacao_insert_organization"
  ON public.pipe_confirmacao FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_confirmacao_delete_admin_only" ON public.pipe_confirmacao;
CREATE POLICY "pipe_confirmacao_delete_admin_only"
  ON public.pipe_confirmacao FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 5: SUBSTITUIR RLS PIPE_PROPOSTAS
-- =====================================================

DROP POLICY IF EXISTS "pipe_propostas_via_lead" ON public.pipe_propostas;
DROP POLICY IF EXISTS "pipe_propostas_select_by_responsibility" ON public.pipe_propostas;
DROP POLICY IF EXISTS "pipe_propostas_update_by_responsibility" ON public.pipe_propostas;
DROP POLICY IF EXISTS "pipe_propostas_insert_organization" ON public.pipe_propostas;
DROP POLICY IF EXISTS "pipe_propostas_delete_admin_only" ON public.pipe_propostas;
DROP POLICY IF EXISTS "pipe_propostas_select_by_permissions" ON public.pipe_propostas;
DROP POLICY IF EXISTS "pipe_propostas_update_by_permissions" ON public.pipe_propostas;

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
    )
  );

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
    )
  )
  WITH CHECK (true);

DROP POLICY IF EXISTS "pipe_propostas_insert_organization" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_insert_organization"
  ON public.pipe_propostas FOR INSERT
  WITH CHECK (
    (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_propostas_delete_admin_only" ON public.pipe_propostas;
CREATE POLICY "pipe_propostas_delete_admin_only"
  ON public.pipe_propostas FOR DELETE
  USING (
    public.is_user_admin()
    AND (SELECT organization_id FROM public.leads WHERE id = lead_id LIMIT 1) IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 6: SUBSTITUIR RLS PIPE_WHATSAPP
-- =====================================================

DROP POLICY IF EXISTS "pipe_whatsapp_via_lead" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "pipe_whatsapp_select_by_responsibility" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "pipe_whatsapp_update_by_responsibility" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "pipe_whatsapp_insert_organization" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "pipe_whatsapp_delete_admin_only" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "pipe_whatsapp_select_by_permissions" ON public.pipe_whatsapp;
DROP POLICY IF EXISTS "pipe_whatsapp_update_by_permissions" ON public.pipe_whatsapp;

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
    )
  );

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
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_whatsapp_insert_organization" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_insert_organization"
  ON public.pipe_whatsapp FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "pipe_whatsapp_delete_admin_only" ON public.pipe_whatsapp;
CREATE POLICY "pipe_whatsapp_delete_admin_only"
  ON public.pipe_whatsapp FOR DELETE
  USING (
    public.is_user_admin()
    AND organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

-- =====================================================
-- PARTE 7: CAMPANHA_LEADS (manter alinhado)
-- =====================================================

DROP POLICY IF EXISTS "campanha_leads_select_by_responsibility" ON public.campanha_leads;
DROP POLICY IF EXISTS "campanha_leads_select_organization" ON public.campanha_leads;
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
    )
  );

-- =====================================================
-- RLS para goals/ranking: manter visível para todos da org (pódio compartilhado)
-- Nenhuma alteração em goals, awards, team_members para leitura da org.
-- =====================================================

COMMENT ON FUNCTION public.user_has_org_permission IS 'Usado no RLS: admin sempre true; senão lê organization_role_permissions pelo role do usuário na org.';
COMMENT ON FUNCTION public.can_see_lead_by_permissions IS 'Usado no RLS: lead/pipe visível se usuário é responsável OU tem permissão (unassigned/subordinates/see_all).';
