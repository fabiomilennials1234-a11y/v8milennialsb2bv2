-- ============================================
-- SCRIPT COMPLETO: CRIAR ORGANIZAÇÃO E VINCULAR ADMIN
-- ============================================
-- Execute este script no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor
--
-- Este script:
-- 1. Cria uma organização padrão
-- 2. Encontra o usuário admin pelo email OU pelo primeiro usuário com role admin
-- 3. Vincula o team_member do admin à organização
-- 4. Verifica se tudo está funcionando

-- ============================================
-- PASSO 1: Criar Organização Padrão
-- ============================================
DO $$
DECLARE
  org_id UUID;
  admin_user_id UUID;
  admin_team_member_id UUID;
BEGIN
  -- Criar organização (ou usar existente)
  INSERT INTO public.organizations (name, slug, subscription_status, subscription_plan)
  VALUES ('Organização Principal', 'organizacao-principal', 'active', 'enterprise')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO org_id;
  
  -- Se não retornou ID, buscar organização existente
  IF org_id IS NULL THEN
    SELECT id INTO org_id FROM public.organizations WHERE slug = 'organizacao-principal' LIMIT 1;
  END IF;
  
  RAISE NOTICE 'Organização ID: %', org_id;
  
  -- ============================================
  -- PASSO 2: Encontrar Usuário Admin
  -- ============================================
  -- Primeiro, tentar encontrar por role admin
  SELECT u.id INTO admin_user_id
  FROM auth.users u
  INNER JOIN public.user_roles ur ON u.id = ur.user_id
  WHERE ur.role = 'admin'
  ORDER BY u.created_at ASC
  LIMIT 1;
  
  -- Se não encontrou, pegar o primeiro usuário
  IF admin_user_id IS NULL THEN
    SELECT id INTO admin_user_id
    FROM auth.users
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;
  
  RAISE NOTICE 'Admin User ID: %', admin_user_id;
  
  -- ============================================
  -- PASSO 3: Encontrar ou Criar Team Member
  -- ============================================
  SELECT id INTO admin_team_member_id
  FROM public.team_members
  WHERE user_id = admin_user_id
  LIMIT 1;
  
  -- Se não existe team_member, criar um
  IF admin_team_member_id IS NULL THEN
    INSERT INTO public.team_members (user_id, name, role, is_active, organization_id)
    VALUES (
      admin_user_id,
      COALESCE((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = admin_user_id), 'Admin'),
      'admin',
      true,
      org_id
    )
    RETURNING id INTO admin_team_member_id;
    
    RAISE NOTICE 'Team Member criado: %', admin_team_member_id;
  ELSE
    -- Atualizar team_member existente com organization_id
    UPDATE public.team_members
    SET organization_id = org_id
    WHERE id = admin_team_member_id;
    
    RAISE NOTICE 'Team Member atualizado: %', admin_team_member_id;
  END IF;
  
  -- ============================================
  -- PASSO 4: Garantir Role Admin
  -- ============================================
  INSERT INTO public.user_roles (user_id, role)
  VALUES (admin_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  
  RAISE NOTICE 'Role admin garantida para usuário: %', admin_user_id;
  
END $$;

-- ============================================
-- PASSO 5: Verificação Completa
-- ============================================
SELECT 
  '✅ VERIFICAÇÃO' as status,
  u.email,
  u.id as user_id,
  ur.role,
  tm.id as team_member_id,
  tm.name as team_member_name,
  tm.role as team_member_role,
  tm.organization_id,
  o.name as organization_name,
  o.slug as organization_slug,
  CASE 
    WHEN tm.organization_id IS NOT NULL THEN '✅ VINCULADO'
    ELSE '❌ SEM ORGANIZAÇÃO'
  END as status_vinculo
FROM auth.users u
LEFT JOIN public.user_roles ur ON u.id = ur.user_id AND ur.role = 'admin'
LEFT JOIN public.team_members tm ON u.id = tm.user_id
LEFT JOIN public.organizations o ON tm.organization_id = o.id
WHERE ur.role = 'admin' OR tm.id IS NOT NULL
ORDER BY u.created_at ASC;

-- ============================================
-- PASSO 6: Verificar Políticas RLS
-- ============================================
-- Esta query mostra se há políticas que podem estar bloqueando
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename IN ('leads', 'team_members', 'organizations')
ORDER BY tablename, policyname;

-- ============================================
-- FIM DO SCRIPT
-- ============================================
-- Se você viu "✅ VINCULADO" na verificação, está tudo certo!
-- Recarregue a página do frontend e tente criar um lead.
