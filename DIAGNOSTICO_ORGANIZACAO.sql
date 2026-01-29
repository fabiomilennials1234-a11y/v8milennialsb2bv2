-- ============================================
-- DIAGNÓSTICO: Verificar Estado Atual
-- ============================================
-- Execute este script PRIMEIRO para ver o estado atual

-- 1. Verificar se existe organização
SELECT 
  'Organizações' as tipo,
  COUNT(*) as total,
  STRING_AGG(name, ', ') as nomes
FROM public.organizations;

-- 2. Verificar usuários e suas roles
SELECT 
  'Usuários e Roles' as tipo,
  u.id as user_id,
  u.email,
  ur.role,
  u.created_at
FROM auth.users u
LEFT JOIN public.user_roles ur ON u.id = ur.user_id
ORDER BY u.created_at ASC;

-- 3. Verificar team_members e suas organizações
SELECT 
  'Team Members' as tipo,
  tm.id as team_member_id,
  tm.name,
  tm.role,
  tm.user_id,
  tm.organization_id,
  u.email,
  o.name as organization_name
FROM public.team_members tm
LEFT JOIN auth.users u ON tm.user_id = u.id
LEFT JOIN public.organizations o ON tm.organization_id = o.id
ORDER BY tm.created_at ASC;

-- 4. Verificar se há team_members SEM organização
SELECT 
  '⚠️ Team Members SEM Organização' as alerta,
  tm.id,
  tm.name,
  tm.role,
  u.email
FROM public.team_members tm
LEFT JOIN auth.users u ON tm.user_id = u.id
WHERE tm.organization_id IS NULL;

-- 5. Verificar se há usuários SEM team_member
SELECT 
  '⚠️ Usuários SEM Team Member' as alerta,
  u.id,
  u.email,
  ur.role
FROM auth.users u
LEFT JOIN public.team_members tm ON u.id = tm.user_id
LEFT JOIN public.user_roles ur ON u.id = ur.user_id
WHERE tm.id IS NULL
ORDER BY u.created_at ASC;
