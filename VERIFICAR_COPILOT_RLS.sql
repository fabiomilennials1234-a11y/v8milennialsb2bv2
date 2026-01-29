-- ============================================
-- VERIFICAR POLÍTICAS RLS DO COPILOT
-- ============================================
-- Execute este script para verificar se as políticas estão corretas

-- Verificar políticas de copilot_agents
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'copilot_agents'
ORDER BY policyname;

-- Verificar se consegue ver agentes
SELECT 
  '✅ Teste de Acesso' as status,
  id,
  name,
  organization_id,
  is_active,
  is_default
FROM copilot_agents
WHERE organization_id IN (
  SELECT organization_id 
  FROM team_members 
  WHERE user_id = auth.uid()
);

-- Se você ver agentes (ou nenhum erro), as políticas estão funcionando! ✅
