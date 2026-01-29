-- ============================================
-- SECURITY FIX: Corrigir políticas RLS
-- ============================================
-- Data: 2026-01-30
-- Descrição: Corrige políticas RLS conflitantes e adiciona proteção multi-tenant
-- ============================================

-- ============================================
-- 1. REMOVER POLÍTICAS ANTIGAS CONFLITANTES
-- ============================================

-- Leads
DROP POLICY IF EXISTS "Team members podem gerenciar leads" ON leads;
DROP POLICY IF EXISTS "Leads visíveis para autenticados" ON leads;
DROP POLICY IF EXISTS "Team members podem ver leads" ON leads;
DROP POLICY IF EXISTS "Team members podem criar leads" ON leads;
DROP POLICY IF EXISTS "Team members podem atualizar leads" ON leads;
DROP POLICY IF EXISTS "Team members podem deletar leads" ON leads;

-- Team members
DROP POLICY IF EXISTS "Team members visíveis para autenticados" ON team_members;
DROP POLICY IF EXISTS "Users can see team members from their organization" ON team_members;

-- Profiles
DROP POLICY IF EXISTS "Profiles são visíveis para usuários autenticados" ON profiles;
DROP POLICY IF EXISTS "Profiles visíveis para autenticados" ON profiles;

-- Tags
DROP POLICY IF EXISTS "Tags visíveis para autenticados" ON tags;
DROP POLICY IF EXISTS "Team members podem gerenciar tags" ON tags;

-- Awards
DROP POLICY IF EXISTS "Awards visíveis para autenticados" ON awards;
DROP POLICY IF EXISTS "Team members podem gerenciar awards" ON awards;

-- ============================================
-- 2. CRIAR FUNÇÃO AUXILIAR SEGURA
-- ============================================

-- Função para obter organization_id do usuário atual
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
  LIMIT 1
$$;

-- Função para verificar se usuário pertence a uma organização
CREATE OR REPLACE FUNCTION public.user_belongs_to_organization(_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.team_members 
    WHERE user_id = auth.uid() 
    AND organization_id = _org_id
    AND is_active = true
  )
$$;

-- ============================================
-- 3. POLÍTICAS PARA LEADS (Multi-tenant)
-- ============================================

-- SELECT: Usuário pode ver leads da sua organização
CREATE POLICY "leads_select_organization"
  ON leads FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND
    organization_id = public.get_user_organization_id()
  );

-- INSERT: Usuário pode criar leads apenas na sua organização
CREATE POLICY "leads_insert_organization"
  ON leads FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NOT NULL AND
    organization_id = public.get_user_organization_id()
  );

-- UPDATE: Usuário pode atualizar leads da sua organização
CREATE POLICY "leads_update_organization"
  ON leads FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NOT NULL AND
    organization_id = public.get_user_organization_id()
  )
  WITH CHECK (
    organization_id IS NOT NULL AND
    organization_id = public.get_user_organization_id()
  );

-- DELETE: Usuário pode deletar leads da sua organização
CREATE POLICY "leads_delete_organization"
  ON leads FOR DELETE
  TO authenticated
  USING (
    organization_id IS NOT NULL AND
    organization_id = public.get_user_organization_id()
  );

-- ============================================
-- 4. POLÍTICAS PARA TEAM_MEMBERS
-- ============================================

-- SELECT próprio registro (sempre permitido)
CREATE POLICY "team_members_select_own"
  ON team_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- SELECT membros da mesma organização
CREATE POLICY "team_members_select_organization"
  ON team_members FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND
    organization_id = public.get_user_organization_id()
  );

-- ============================================
-- 5. POLÍTICAS PARA PROFILES (Restritivo)
-- ============================================

-- SELECT: Usuário pode ver apenas perfis da sua organização
CREATE POLICY "profiles_select_organization"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT user_id 
      FROM public.team_members 
      WHERE organization_id = public.get_user_organization_id()
    )
  );

-- UPDATE: Usuário pode atualizar apenas próprio perfil
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================
-- 6. POLÍTICAS PARA TAGS (Multi-tenant)
-- ============================================

-- Adicionar organization_id à tabela tags se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'tags' 
    AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE public.tags ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;
END $$;

-- SELECT: Tags da organização
CREATE POLICY "tags_select_organization"
  ON tags FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL OR -- Tags globais (legacy)
    organization_id = public.get_user_organization_id()
  );

-- INSERT: Criar tags na organização
CREATE POLICY "tags_insert_organization"
  ON tags FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

-- UPDATE: Atualizar tags da organização
CREATE POLICY "tags_update_organization"
  ON tags FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

-- DELETE: Deletar tags da organização
CREATE POLICY "tags_delete_organization"
  ON tags FOR DELETE
  TO authenticated
  USING (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

-- ============================================
-- 7. POLÍTICAS PARA AWARDS (Multi-tenant)
-- ============================================

-- Adicionar organization_id à tabela awards se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'awards' 
    AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE public.awards ADD COLUMN organization_id UUID REFERENCES public.organizations(id);
  END IF;
END $$;

-- SELECT: Awards da organização
CREATE POLICY "awards_select_organization"
  ON awards FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

-- INSERT/UPDATE/DELETE similar
CREATE POLICY "awards_insert_organization"
  ON awards FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

CREATE POLICY "awards_update_organization"
  ON awards FOR UPDATE
  TO authenticated
  USING (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

CREATE POLICY "awards_delete_organization"
  ON awards FOR DELETE
  TO authenticated
  USING (
    organization_id IS NULL OR
    organization_id = public.get_user_organization_id()
  );

-- ============================================
-- 8. POLÍTICAS PARA PIPE_* (Multi-tenant via lead)
-- ============================================

-- pipe_confirmacao
DROP POLICY IF EXISTS "Team members podem gerenciar confirmacoes" ON pipe_confirmacao;

CREATE POLICY "pipe_confirmacao_via_lead"
  ON pipe_confirmacao FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = pipe_confirmacao.lead_id 
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- pipe_propostas
DROP POLICY IF EXISTS "Team members podem gerenciar propostas" ON pipe_propostas;

CREATE POLICY "pipe_propostas_via_lead"
  ON pipe_propostas FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = pipe_propostas.lead_id 
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- pipe_whatsapp
DROP POLICY IF EXISTS "Team members podem gerenciar whatsapp" ON pipe_whatsapp;

CREATE POLICY "pipe_whatsapp_via_lead"
  ON pipe_whatsapp FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = pipe_whatsapp.lead_id 
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ============================================
-- 9. POLÍTICAS PARA FOLLOW_UPS (Multi-tenant via lead)
-- ============================================

DROP POLICY IF EXISTS "Team members podem gerenciar follow_ups" ON follow_ups;

CREATE POLICY "follow_ups_via_lead"
  ON follow_ups FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = follow_ups.lead_id 
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ============================================
-- 10. POLÍTICAS PARA LEAD_HISTORY (Multi-tenant via lead)
-- ============================================

DROP POLICY IF EXISTS "Lead history visível para autenticados" ON lead_history;

CREATE POLICY "lead_history_via_lead"
  ON lead_history FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = lead_history.lead_id 
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ============================================
-- 11. POLÍTICAS PARA LEAD_TAGS (Multi-tenant via lead)
-- ============================================

DROP POLICY IF EXISTS "Lead tags visíveis para autenticados" ON lead_tags;

CREATE POLICY "lead_tags_via_lead"
  ON lead_tags FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads 
      WHERE leads.id = lead_tags.lead_id 
      AND leads.organization_id = public.get_user_organization_id()
    )
  );

-- ============================================
-- 12. GARANTIR RLS ESTÁ ATIVO EM TODAS AS TABELAS
-- ============================================

ALTER TABLE IF EXISTS leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pipe_confirmacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pipe_propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pipe_whatsapp ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lead_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS organizations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 13. POLÍTICA PARA ORGANIZATIONS
-- ============================================

DROP POLICY IF EXISTS "Organizations visíveis para membros" ON organizations;

CREATE POLICY "organizations_select_member"
  ON organizations FOR SELECT
  TO authenticated
  USING (
    id = public.get_user_organization_id()
  );

-- ============================================
-- FIM DA MIGRAÇÃO DE SEGURANÇA
-- ============================================

-- Log de sucesso
DO $$
BEGIN
  RAISE NOTICE 'Security migration completed successfully';
  RAISE NOTICE 'RLS policies have been updated for multi-tenant isolation';
END $$;
