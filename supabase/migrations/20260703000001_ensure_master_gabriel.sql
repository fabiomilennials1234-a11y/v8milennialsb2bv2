-- ============================================================
-- GARANTIR MASTER: gabrielgipp04@gmail.com
-- Re-inserir/reativar caso a migration anterior não tenha encontrado o user
-- ============================================================

DO $$
DECLARE
  v_user_id UUID;
  v_count INT;
BEGIN
  -- 1. Buscar user_id
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('gabrielgipp04@gmail.com');

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Usuário gabrielgipp04@gmail.com NÃO encontrado em auth.users. Criando...';

    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'gabrielgipp04@gmail.com',
      crypt('TempPass123!', gen_salt('bf')),
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "Gabriel", "role": "master"}'::jsonb,
      NOW(), NOW(), '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      'gabrielgipp04@gmail.com',
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', 'gabrielgipp04@gmail.com',
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
  VALUES (v_user_id, 'Gabriel')
  ON CONFLICT (id) DO UPDATE SET full_name = 'Gabriel';

  -- 3. Role admin
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 4. Master user (inserir ou reativar)
  INSERT INTO public.master_users (user_id, notes, permissions, is_active)
  VALUES (
    v_user_id,
    'Master - Gabriel (acesso total a todas as organizações)',
    '{"all": true}'::jsonb,
    true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = true,
    permissions = '{"all": true}'::jsonb,
    notes = 'Master - Gabriel (acesso total - reativado)',
    updated_at = NOW();

  -- 5. Verificar inserção
  SELECT COUNT(*) INTO v_count
  FROM public.master_users
  WHERE user_id = v_user_id AND is_active = true;

  RAISE NOTICE 'Master users ativos para Gabriel: %', v_count;

  -- 6. Team member em todas as orgs
  INSERT INTO public.team_members (user_id, name, role, organization_id, is_active)
  SELECT
    v_user_id,
    'Gabriel',
    'admin'::public.app_role,
    o.id,
    true
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = v_user_id AND tm.organization_id = o.id
  );

END $$;
