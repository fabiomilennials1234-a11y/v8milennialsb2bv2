-- Fix: auth.identities provider_id must be user UUID, not email
-- GoTrue expects provider_id = user.id for email provider
-- Date: 2026-04-08

DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'd.agullalozano@gmail.com';

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Delete malformed identity
  DELETE FROM auth.identities
  WHERE user_id = v_user_id AND provider = 'email';

  -- Recreate with correct provider_id (must be user UUID)
  INSERT INTO auth.identities (
    id,
    user_id,
    provider_id,
    provider,
    identity_data,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_user_id,
    v_user_id::text,
    'email',
    jsonb_build_object(
      'sub', v_user_id::text,
      'email', 'd.agullalozano@gmail.com',
      'email_verified', true,
      'phone_verified', false
    ),
    now(),
    now(),
    now()
  );

  RAISE NOTICE 'Identity fixed for user: %', v_user_id;
END $$;
