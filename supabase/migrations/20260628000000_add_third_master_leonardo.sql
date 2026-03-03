-- ============================================================
-- CRIAR USUÁRIO MASTER: leonardomilennials@gmail.com
-- Senha: Milennials123456.
-- Role: ceo (acesso total ao dashboard)
-- ============================================================

-- ETAPA 1: Criar o usuário em auth.users
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('leonardomilennials@gmail.com');

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'leonardomilennials@gmail.com',
      crypt('Milennials123456.', gen_salt('bf')),
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"name": "Leonardo", "role": "ceo"}'::jsonb,
      NOW(), NOW(), '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      'leonardomilennials@gmail.com',
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', 'leonardomilennials@gmail.com',
        'email_verified', true,
        'provider', 'email'
      ),
      'email', NOW(), NOW(), NOW()
    );
  END IF;
END $$;

-- ETAPA 2: Profile e role CEO
INSERT INTO public.profiles (user_id, name, email)
SELECT id, 'Leonardo', 'leonardomilennials@gmail.com'
FROM auth.users WHERE lower(email) = lower('leonardomilennials@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET name = 'Leonardo', email = 'leonardomilennials@gmail.com';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'ceo'::public.user_role
FROM auth.users WHERE lower(email) = lower('leonardomilennials@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;
