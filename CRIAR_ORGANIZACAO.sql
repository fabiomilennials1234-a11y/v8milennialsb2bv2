-- ============================================
-- SCRIPT PARA CRIAR ORGANIZAÇÃO E VINCULAR USUÁRIO
-- ============================================
-- Execute este script no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor

-- PASSO 1: Criar organização padrão
-- Substitua 'Minha Empresa' e 'minha-empresa' pelos valores desejados
INSERT INTO public.organizations (name, slug, subscription_status, subscription_plan)
VALUES ('Minha Empresa', 'minha-empresa', 'active', 'pro')
RETURNING id, name, slug;

-- ⚠️ IMPORTANTE: Copie o ID retornado acima e use no próximo comando

-- PASSO 2: Encontrar seu USER_ID
-- Execute este comando para encontrar seu user_id pelo email
SELECT id, email, created_at 
FROM auth.users 
ORDER BY created_at DESC 
LIMIT 5;

-- ⚠️ IMPORTANTE: Copie o ID do usuário que você criou

-- PASSO 3: Vincular seu team_member à organização
-- Substitua 'ORGANIZATION_ID_AQUI' pelo ID retornado no PASSO 1
-- Substitua 'SEU_USER_ID_AQUI' pelo ID retornado no PASSO 2
UPDATE public.team_members
SET organization_id = 'ORGANIZATION_ID_AQUI'
WHERE user_id = 'SEU_USER_ID_AQUI';

-- PASSO 4: Verificar se funcionou
-- Substitua 'SEU_USER_ID_AQUI' pelo seu user_id
SELECT 
  tm.name,
  tm.role,
  o.name as organization_name,
  o.slug,
  tm.organization_id
FROM public.team_members tm
LEFT JOIN public.organizations o ON tm.organization_id = o.id
WHERE tm.user_id = 'SEU_USER_ID_AQUI';

-- Se você ver organization_name e organization_id preenchidos, está tudo certo! ✅
