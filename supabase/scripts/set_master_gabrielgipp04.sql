-- ============================================
-- Script: Definir gabrielgipp04@gmail.com como Master
-- ============================================
-- O que este script faz:
-- 1. Busca seu usuário pelo email no Auth
-- 2. Garante uma organização (usa a primeira ou cria uma)
-- 3. Cria/atualiza seu perfil (profiles)
-- 4. Vincula você à organização em team_members (admin, ativo)
-- 5. Garante role admin em user_roles
-- 6. Insere ou reativa você em master_users (acesso master)
--
-- Como usar:
-- 1. Abra https://supabase.com/dashboard e selecione seu projeto
-- 2. No menu: SQL Editor → New query
-- 3. Cole todo o conteúdo deste arquivo na query
-- 4. Clique em Run (ou Ctrl+Enter)
-- 5. Se aparecer "Sucesso" no resultado, faça logout no app e entre de novo
-- ============================================

DO $$
DECLARE
  v_user_id   UUID;
  v_org_id    UUID;
  v_user_name TEXT;
BEGIN
  -- 1) Buscar usuário pelo email
  SELECT id, COALESCE(raw_user_meta_data->>'full_name', split_part(email, '@', 1))
  INTO v_user_id, v_user_name
  FROM auth.users
  WHERE email = 'gabrielgipp04@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário com email gabrielgipp04@gmail.com não encontrado. Crie a conta pelo app (Cadastro) ou em Authentication → Users no Dashboard e rode este script de novo.';
  END IF;

  -- 2) Usar primeira organização ou criar uma
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at LIMIT 1;

  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name, slug, subscription_status, subscription_plan, subscription_expires_at)
    VALUES (
      'Organização Principal',
      'org-principal-' || substr(gen_random_uuid()::text, 1, 8),
      'active',
      'pro',
      NOW() + INTERVAL '1 year'
    )
    RETURNING id INTO v_org_id;
  END IF;

  -- 3) Perfil (profiles)
  INSERT INTO public.profiles (id, full_name)
  VALUES (v_user_id, v_user_name)
  ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);

  -- 4) Vincular em team_members: atualizar se já existir, senão inserir
  UPDATE public.team_members
  SET organization_id = v_org_id, is_active = true, name = v_user_name, role = 'admin', email = 'gabrielgipp04@gmail.com', updated_at = NOW()
  WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.team_members (user_id, organization_id, name, role, is_active, email)
    VALUES (v_user_id, v_org_id, v_user_name, 'admin', true, 'gabrielgipp04@gmail.com');
  END IF;

  -- Se existir linha com organization_id NULL, preencher
  UPDATE public.team_members
  SET organization_id = v_org_id, is_active = true, updated_at = NOW()
  WHERE user_id = v_user_id AND organization_id IS NULL;

  -- 5) Role admin
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 6) Master
  INSERT INTO public.master_users (user_id, notes, permissions, is_active)
  VALUES (v_user_id, 'Master definido via script set_master_gabrielgipp04.sql', '{"all": true}'::jsonb, true)
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = true,
    notes = COALESCE(EXCLUDED.notes, master_users.notes),
    permissions = '{"all": true}'::jsonb,
    updated_at = NOW();

  RAISE NOTICE 'Sucesso: gabrielgipp04@gmail.com foi definido como master e vinculado à organização. Faça logout no app e entre de novo.';
END $$;
