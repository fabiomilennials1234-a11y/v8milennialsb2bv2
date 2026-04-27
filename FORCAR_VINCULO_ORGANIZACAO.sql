-- ============================================
-- SCRIPT FORÇADO: Vincular TODOS à Organização
-- ============================================
-- Este script FORÇA a criação/vinculação sem verificar nada
-- Execute APÓS o diagnóstico

-- PASSO 1: Criar organização (forçar)
INSERT INTO public.organizations (id, name, slug, subscription_status, subscription_plan)
VALUES (
  '00000000-0000-0000-0000-000000000001'::UUID,
  'Organização Principal',
  'organizacao-principal',
  'active',
  'enterprise'
)
ON CONFLICT (slug) DO UPDATE 
SET name = EXCLUDED.name,
    subscription_status = EXCLUDED.subscription_status,
    subscription_plan = EXCLUDED.subscription_plan;

-- PASSO 2: Pegar ID da organização
DO $$
DECLARE
  org_id UUID;
  user_record RECORD;
  tm_record RECORD;
BEGIN
  -- Pegar organização
  SELECT id INTO org_id 
  FROM public.organizations 
  WHERE slug = 'organizacao-principal' 
  LIMIT 1;
  
  RAISE NOTICE 'Organização ID: %', org_id;
  
  -- Para CADA usuário autenticado:
  FOR user_record IN 
    SELECT id, email, raw_user_meta_data
    FROM auth.users
    ORDER BY created_at ASC
  LOOP
    RAISE NOTICE 'Processando usuário: % (%)', user_record.email, user_record.id;
    
    -- Verificar se tem team_member
    SELECT * INTO tm_record
    FROM public.team_members
    WHERE user_id = user_record.id
    LIMIT 1;
    
    IF tm_record IS NULL THEN
      -- Criar team_member
      INSERT INTO public.team_members (
        user_id,
        name,
        role,
        is_active,
        organization_id
      )
      VALUES (
        user_record.id,
        COALESCE(user_record.raw_user_meta_data->>'full_name', 'Usuário'),
        'admin',
        true,
        org_id
      )
      ON CONFLICT DO NOTHING;
      
      RAISE NOTICE '  ✅ Team member CRIADO';
    ELSE
      -- Atualizar team_member existente
      UPDATE public.team_members
      SET 
        organization_id = org_id,
        is_active = true
      WHERE id = tm_record.id;
      
      RAISE NOTICE '  ✅ Team member ATUALIZADO';
    END IF;
    
    -- Garantir role admin
    INSERT INTO public.user_roles (user_id, role)
    VALUES (user_record.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
    
    RAISE NOTICE '  ✅ Role admin garantida';
  END LOOP;
  
  RAISE NOTICE '✅ Processo concluído!';
END $$;

-- PASSO 3: Verificação Final
SELECT 
  '✅ VERIFICAÇÃO FINAL' as status,
  u.email,
  tm.name as team_member_name,
  tm.role as team_member_role,
  tm.organization_id,
  o.name as organization_name,
  CASE 
    WHEN tm.organization_id IS NOT NULL THEN '✅ VINCULADO'
    ELSE '❌ SEM ORGANIZAÇÃO'
  END as status_vinculo
FROM auth.users u
INNER JOIN public.team_members tm ON u.id = tm.user_id
LEFT JOIN public.organizations o ON tm.organization_id = o.id
ORDER BY u.created_at ASC;

-- Se TODOS mostrarem "✅ VINCULADO", está funcionando!
