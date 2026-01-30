-- ============================================
-- SCRIPT AUTOMÁTICO: CRIAR ORGANIZAÇÃO E VINCULAR USUÁRIO
-- ============================================
-- Execute este script no SQL Editor do Supabase
-- https://supabase.com/dashboard/project/SEU_PROJECT_ID/editor
--
-- ⚠️ IMPORTANTE: Substitua 'seu-email@exemplo.com' pelo email que você usou para criar a conta

-- PASSO 1: Criar organização (se não existir)
INSERT INTO public.organizations (name, slug, subscription_status, subscription_plan)
VALUES ('Minha Empresa', 'minha-empresa', 'active', 'pro')
ON CONFLICT (slug) DO NOTHING
RETURNING id, name, slug;

-- PASSO 2: Vincular TODOS os team_members à organização criada
-- Isso pega a organização mais recente e vincula todos os team_members que não têm organization_id
UPDATE public.team_members
SET organization_id = (
  SELECT id FROM public.organizations 
  WHERE slug = 'minha-empresa' 
  ORDER BY created_at DESC 
  LIMIT 1
)
WHERE organization_id IS NULL;

-- PASSO 3: Verificar se funcionou
-- Mostra todos os team_members e suas organizações
SELECT 
  tm.id,
  tm.name,
  tm.role,
  u.email,
  o.name as organization_name,
  o.slug,
  tm.organization_id
FROM public.team_members tm
LEFT JOIN auth.users u ON tm.user_id = u.id
LEFT JOIN public.organizations o ON tm.organization_id = o.id
ORDER BY tm.created_at DESC;

-- Se você ver organization_name e organization_id preenchidos, está tudo certo! ✅
-- Agora você pode criar leads normalmente no frontend.
