-- ============================================================
-- Seed data for integration tests
-- Run: supabase db reset (applies migrations + seed)
-- ============================================================

-- Test organization
INSERT INTO organizations (id, name, slug, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Test Organization',
  'test-org',
  now()
) ON CONFLICT (id) DO NOTHING;

-- Test users (auth.users) — using Supabase's raw_user_meta_data
-- Master user
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'master@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Master User"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Admin user
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'admin@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Admin User"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- SDR user
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role)
VALUES (
  '00000000-0000-0000-0000-000000000030',
  'sdr@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "SDR User"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Team members
INSERT INTO team_members (id, user_id, organization_id, role, name, email, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'admin', 'Master User', 'master@test.com', now()),
  ('00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'admin', 'Admin User', 'admin@test.com', now()),
  ('00000000-0000-0000-0000-000000000130', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000001', 'sdr', 'SDR User', 'sdr@test.com', now())
ON CONFLICT (id) DO NOTHING;

-- Test leads
INSERT INTO leads (id, name, company, phone, email, organization_id, created_at)
VALUES
  ('00000000-0000-0000-0000-000000001001', 'Lead Alpha', 'Alpha Corp', '+5511999990001', 'alpha@test.com', '00000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000001002', 'Lead Beta', 'Beta Inc', '+5511999990002', 'beta@test.com', '00000000-0000-0000-0000-000000000001', now()),
  ('00000000-0000-0000-0000-000000001003', 'Lead Gamma', 'Gamma Ltd', '+5511999990003', 'gamma@test.com', '00000000-0000-0000-0000-000000000001', now())
ON CONFLICT (id) DO NOTHING;
