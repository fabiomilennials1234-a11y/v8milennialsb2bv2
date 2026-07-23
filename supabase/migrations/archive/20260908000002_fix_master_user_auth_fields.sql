-- Fix: GoTrue expects NULL tokens, not empty strings
-- confirmed_at is generated, skip it
-- Date: 2026-04-08

UPDATE auth.users
SET
  confirmation_token = NULL,
  recovery_token = NULL,
  email_change_token_new = NULL,
  email_change_token_current = NULL,
  email_change = NULL,
  phone = NULL,
  phone_change = NULL,
  phone_change_token = NULL,
  reauthentication_token = NULL,
  is_sso_user = false,
  is_super_admin = false,
  email_confirmed_at = now()
WHERE email = 'd.agullalozano@gmail.com';
