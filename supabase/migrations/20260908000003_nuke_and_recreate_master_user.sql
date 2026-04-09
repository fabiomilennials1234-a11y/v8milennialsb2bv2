-- Nuclear: delete SQL-created user, recreate via GoTrue Admin API
-- Use email match directly to avoid type cast issues
-- Date: 2026-04-08

DELETE FROM public.master_users WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'd.agullalozano@gmail.com');
DELETE FROM public.profiles WHERE id IN (SELECT id FROM auth.users WHERE email = 'd.agullalozano@gmail.com');
DELETE FROM auth.identities WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'd.agullalozano@gmail.com');
DELETE FROM auth.sessions WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'd.agullalozano@gmail.com');
DELETE FROM auth.mfa_factors WHERE user_id IN (SELECT id FROM auth.users WHERE email = 'd.agullalozano@gmail.com');
DELETE FROM auth.users WHERE email = 'd.agullalozano@gmail.com';
