-- ============================================
-- SOLUÇÃO EMERGENCIAL: POLÍTICA PERMISSIVA TEMPORÁRIA
-- ============================================
-- Execute este script se ainda estiver com erros 500
-- Esta é uma solução temporária para debug

-- PASSO 1: Remover TODAS as políticas existentes
DROP POLICY IF EXISTS "Users can see their own team member" ON team_members;
DROP POLICY IF EXISTS "Users can see team members from same organization" ON team_members;
DROP POLICY IF EXISTS "Admins can see all team members" ON team_members;
DROP POLICY IF EXISTS "Users can see team members from their organization" ON team_members;
DROP POLICY IF EXISTS "Team members visíveis para autenticados" ON team_members;
DROP POLICY IF EXISTS "Apenas admins podem gerenciar team members" ON team_members;

-- PASSO 2: Criar política MUITO PERMISSIVA (TEMPORÁRIA - APENAS PARA DEBUG)
-- Isso permite que qualquer usuário autenticado veja qualquer team_member
CREATE POLICY "TEMPORARY: All authenticated users can see all team members"
  ON team_members FOR SELECT
  TO authenticated
  USING (true);

-- PASSO 3: Verificar se funcionou
SELECT 
  '✅ Teste' as status,
  id,
  name,
  user_id,
  organization_id
FROM team_members 
WHERE user_id = auth.uid();

-- Se você ver seu team_member, a política está funcionando!
-- Depois que funcionar, podemos criar políticas mais restritivas.
