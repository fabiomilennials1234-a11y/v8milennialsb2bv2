-- ============================================
-- SOLUÇÃO DEFINITIVA: CORRIGIR POLÍTICAS RLS
-- ============================================
-- Execute este script no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor
--
-- Este script corrige o problema de políticas RLS circulares
-- que impedem o frontend de buscar o team_member

-- ============================================
-- PASSO 1: Remover TODAS as políticas problemáticas
-- ============================================
DROP POLICY IF EXISTS "Users can see team members from their organization" ON team_members;
DROP POLICY IF EXISTS "Team members visíveis para autenticados" ON team_members;
DROP POLICY IF EXISTS "Users can see their own team member" ON team_members;
DROP POLICY IF EXISTS "Users can see team members from same organization" ON team_members;

-- ============================================
-- PASSO 2: Criar política que permite ver PRÓPRIO team_member
-- (SEM depender de organization_id - resolve o loop circular)
-- ============================================
CREATE POLICY "Users can see their own team member"
  ON team_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================
-- PASSO 3: Criar política para ver outros da mesma organização
-- (Só funciona DEPOIS de ter o próprio team_member)
-- ============================================
CREATE POLICY "Users can see team members from same organization"
  ON team_members FOR SELECT
  TO authenticated
  USING (
    organization_id IS NOT NULL AND
    organization_id IN (
      SELECT organization_id 
      FROM team_members 
      WHERE user_id = auth.uid() AND organization_id IS NOT NULL
    )
  );

-- ============================================
-- PASSO 4: Garantir que admins podem ver todos
-- ============================================
CREATE POLICY "Admins can see all team members"
  ON team_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 
      FROM public.user_roles 
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- ============================================
-- PASSO 5: Verificar se funcionou
-- ============================================
SELECT 
  '✅ Teste de Acesso' as status,
  id,
  name,
  user_id,
  organization_id,
  role
FROM team_members 
WHERE user_id = auth.uid();

-- Se você ver seu team_member com organization_id preenchido, está funcionando! ✅

-- ============================================
-- PASSO 6: Verificar todas as políticas criadas
-- ============================================
SELECT 
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'team_members'
ORDER BY policyname;

-- Você deve ver 3 políticas:
-- 1. "Users can see their own team member"
-- 2. "Users can see team members from same organization"
-- 3. "Admins can see all team members"
