-- ============================================================
-- CRIAR USUÁRIO MASTER: marcelo.montemezzo19@gmail.com
-- Senha: Milennials123456.
-- Acesso total a todas as organizações
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_user_id UUID;
  v_count INT;
BEGIN
  -- 1. Buscar ou criar user
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('marcelo.montemezzo19@gmail.com');

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Usuário marcelo.montemezzo19@gmail.com NÃO encontrado em auth.users. Criando...';

    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_confirm_status,
      phone_change, phone_change_token, reauthentication_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'marcelo.montemezzo19@gmail.com',
      extensions.crypt('Milennials123456.', extensions.gen_salt('bf')),
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "Marcelo", "role": "master"}'::jsonb,
      NOW(), NOW(), '', '',
      '', '', 0, '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      'marcelo.montemezzo19@gmail.com',
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', 'marcelo.montemezzo19@gmail.com',
        'email_verified', true,
        'provider', 'email'
      ),
      'email', NOW(), NOW(), NOW()
    );
  ELSE
    RAISE NOTICE 'Usuário encontrado: %', v_user_id;
  END IF;

  -- 2. Profile
  INSERT INTO public.profiles (id, full_name)
  VALUES (v_user_id, 'Marcelo')
  ON CONFLICT (id) DO UPDATE SET full_name = 'Marcelo';

  -- 3. Role admin
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 4. Master user (inserir ou reativar)
  INSERT INTO public.master_users (user_id, notes, permissions, is_active)
  VALUES (
    v_user_id,
    'Master - Marcelo (acesso total a todas as organizações)',
    '{"all": true}'::jsonb,
    true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = true,
    permissions = '{"all": true}'::jsonb,
    notes = 'Master - Marcelo (acesso total - reativado)',
    updated_at = NOW();

  -- 5. Verificar inserção
  SELECT COUNT(*) INTO v_count
  FROM public.master_users
  WHERE user_id = v_user_id AND is_active = true;

  RAISE NOTICE 'Master users ativos para Marcelo: %', v_count;

  -- 6. Team member em todas as orgs
  INSERT INTO public.team_members (user_id, name, role, organization_id, is_active)
  SELECT
    v_user_id,
    'Marcelo',
    'admin'::public.app_role,
    o.id,
    true
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = v_user_id AND tm.organization_id = o.id
  );

END $$;
