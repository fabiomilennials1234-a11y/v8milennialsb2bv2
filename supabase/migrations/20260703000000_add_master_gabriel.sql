-- ============================================================
-- ADICIONAR MASTER: gabrielgipp04@gmail.com
-- Acesso total a todas as organizações
-- ============================================================

-- ETAPA 1: Garantir profile existe
INSERT INTO public.profiles (id, full_name)
SELECT id, 'Gabriel'
FROM auth.users WHERE lower(email) = lower('gabrielgipp04@gmail.com')
ON CONFLICT (id) DO UPDATE SET full_name = 'Gabriel';

-- ETAPA 2: Role admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users WHERE lower(email) = lower('gabrielgipp04@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- ETAPA 3: Inserir como master_user com acesso total
INSERT INTO public.master_users (user_id, notes, permissions)
SELECT
  id,
  'Master - Gabriel (acesso total a todas as organizações)',
  '{"all": true}'::jsonb
FROM auth.users
WHERE lower(email) = lower('gabrielgipp04@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
  is_active = true,
  permissions = '{"all": true}'::jsonb,
  notes = 'Master - Gabriel (acesso total a todas as organizações)',
  updated_at = NOW();

-- ETAPA 4: Adicionar como team_member em TODAS as organizações existentes (role admin)
INSERT INTO public.team_members (user_id, name, role, organization_id, is_active)
SELECT
  u.id,
  'Gabriel',
  'admin'::public.app_role,
  o.id,
  true
FROM auth.users u
CROSS JOIN public.organizations o
WHERE lower(u.email) = lower('gabrielgipp04@gmail.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = u.id AND tm.organization_id = o.id
  );
