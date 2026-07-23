-- ============================================================
-- CRIAR OUTBOUNDER: maycosguerreiro@gmail.com
-- Acesso limitado à área master: apenas organizações outbound
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_user_id UUID;
  v_count INT;
BEGIN
  -- 1. Verificar se já existe
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower('maycosguerreiro@gmail.com');

  IF v_user_id IS NULL THEN
    RAISE NOTICE 'Criando usuário maycosguerreiro@gmail.com...';

    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'maycosguerreiro@gmail.com',
      extensions.crypt('Milennials123456', extensions.gen_salt('bf')),
      NOW(),
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      '{"full_name": "Maycos Guerreiro", "role": "outbounder"}'::jsonb,
      NOW(), NOW(), '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_user_id,
      'maycosguerreiro@gmail.com',
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', 'maycosguerreiro@gmail.com',
        'email_verified', true,
        'provider', 'email'
      ),
      'email', NOW(), NOW(), NOW()
    );
  ELSE
    RAISE NOTICE 'Usuário já existe: %', v_user_id;
  END IF;

  -- 2. Profile
  INSERT INTO public.profiles (id, full_name)
  VALUES (v_user_id, 'Maycos Guerreiro')
  ON CONFLICT (id) DO UPDATE SET full_name = 'Maycos Guerreiro';

  -- 3. Role admin (necessário para RLS)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 4. Master user com permissões limitadas (apenas outbound)
  INSERT INTO public.master_users (user_id, notes, permissions, is_active)
  VALUES (
    v_user_id,
    'Outbounder - Maycos Guerreiro (acesso apenas a orgs outbound)',
    '{
      "all": false,
      "organizations": true,
      "users": true,
      "outbound_only": true
    }'::jsonb,
    true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_active = true,
    permissions = '{
      "all": false,
      "organizations": true,
      "users": true,
      "outbound_only": true
    }'::jsonb,
    notes = 'Outbounder - Maycos Guerreiro (acesso apenas a orgs outbound)',
    updated_at = NOW();

  -- 5. Team member em todas as orgs OUTBOUND existentes
  INSERT INTO public.team_members (user_id, name, role, organization_id, is_active, email)
  SELECT
    v_user_id,
    'Maycos Guerreiro',
    'agency'::public.app_role,
    o.id,
    true,
    'maycosguerreiro@gmail.com'
  FROM public.organizations o
  WHERE o.org_type = 'outbound'
    AND NOT EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = v_user_id AND tm.organization_id = o.id
    );

  -- 6. Verificação
  SELECT COUNT(*) INTO v_count
  FROM public.master_users
  WHERE user_id = v_user_id AND is_active = true;

  RAISE NOTICE 'Master users ativos para Maycos: %', v_count;
END $$;
