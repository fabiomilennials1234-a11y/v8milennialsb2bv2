-- ============================================================
-- Seed data for integration tests
-- Run: supabase db reset (applies migrations + seed)
-- ============================================================

-- Disable seat limit trigger for all seed data
DO $$ BEGIN
  ALTER TABLE team_members DISABLE TRIGGER trg_enforce_seat_limit;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL;
END $$;

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
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  'master@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Master User"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Admin user
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000020',
  'admin@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Admin User"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- SDR user
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000030',
  'sdr@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "SDR User"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Auth identities for all seed users (required for signInWithPassword to work)
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000010', '{"sub":"00000000-0000-0000-0000-000000000010","email":"master@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000010', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000020', '{"sub":"00000000-0000-0000-0000-000000000020","email":"admin@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000020', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000030', '{"sub":"00000000-0000-0000-0000-000000000030","email":"sdr@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000030', now(), now(), now())
ON CONFLICT DO NOTHING;

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


-- ============================================================
-- EXPANDED SEED DATA — RLS integration tests
-- Added: 2026-04-01
-- ADDITIVE ONLY — do not modify any data above this line
-- ============================================================

-- Temporarily disable seat limit trigger for test data insertion
ALTER TABLE team_members DISABLE TRIGGER trg_enforce_seat_limit;

-- ────────────────────────────────────────────────────────────
-- 1. Organization B
-- ────────────────────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  'Test Organization B',
  'test-org-b',
  now()
) ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. New auth.users
-- ────────────────────────────────────────────────────────────

-- Member One (Org A member)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000040',
  'member1@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Member One"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Member Two (Org A member)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000050',
  'member2@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Member Two"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Admin B (Org B admin)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000060',
  'adminb@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Admin B"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Member B (Org B member)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at, instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, reauthentication_token, phone_change_token, email_change, phone_change)
VALUES (
  '00000000-0000-0000-0000-000000000070',
  'memberb@test.com',
  crypt('Test123!@#', gen_salt('bf')),
  now(),
  '{"full_name": "Member B"}'::jsonb,
  now(), now(),
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '', '', '', '', '', '', '', ''
) ON CONFLICT (id) DO NOTHING;

-- Auth identities for new users
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000040', '{"sub":"00000000-0000-0000-0000-000000000040","email":"member1@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000040', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000050', '{"sub":"00000000-0000-0000-0000-000000000050","email":"member2@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000050', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000060', '{"sub":"00000000-0000-0000-0000-000000000060","email":"adminb@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000060', now(), now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000070', '{"sub":"00000000-0000-0000-0000-000000000070","email":"memberb@test.com"}'::jsonb, 'email', '00000000-0000-0000-0000-000000000070', now(), now(), now())
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. New team_members
-- ────────────────────────────────────────────────────────────
INSERT INTO team_members (id, user_id, organization_id, role, name, email, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000140', '00000000-0000-0000-0000-000000000040', '00000000-0000-0000-0000-000000000001', 'member', 'Member One', 'member1@test.com', now()),
  ('00000000-0000-0000-0000-000000000150', '00000000-0000-0000-0000-000000000050', '00000000-0000-0000-0000-000000000001', 'member', 'Member Two', 'member2@test.com', now()),
  ('00000000-0000-0000-0000-000000000160', '00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000002', 'admin', 'Admin B', 'adminb@test.com', now()),
  ('00000000-0000-0000-0000-000000000170', '00000000-0000-0000-0000-000000000070', '00000000-0000-0000-0000-000000000002', 'member', 'Member B', 'memberb@test.com', now())
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. master_users entry
-- ────────────────────────────────────────────────────────────
INSERT INTO master_users (id, user_id, permissions, is_active, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000210',
  '00000000-0000-0000-0000-000000000010',
  '{"all": true}'::jsonb,
  true,
  now()
) ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 5. Update existing leads with assignments
-- ────────────────────────────────────────────────────────────
UPDATE leads SET sdr_id = '00000000-0000-0000-0000-000000000140'
WHERE id = '00000000-0000-0000-0000-000000001001';

UPDATE leads SET closer_id = '00000000-0000-0000-0000-000000000150'
WHERE id = '00000000-0000-0000-0000-000000001002';

-- Lead Gamma (1003) stays unassigned — no update needed

-- ────────────────────────────────────────────────────────────
-- 6. New lead with both assignments (Org A)
-- ────────────────────────────────────────────────────────────
INSERT INTO leads (id, name, company, phone, email, organization_id, sdr_id, closer_id, created_at)
VALUES (
  '00000000-0000-0000-0000-000000001004',
  'Lead Delta',
  'Delta LLC',
  '+5511999990004',
  'delta@test.com',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000140',
  '00000000-0000-0000-0000-000000000150',
  now()
) ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 7. Org B leads
-- ────────────────────────────────────────────────────────────
INSERT INTO leads (id, name, company, phone, email, organization_id, created_at)
VALUES
  ('00000000-0000-0000-0000-000000002001', 'Lead OrgB-1', 'OrgB Corp', '+5511999990101', 'orgb1@test.com', '00000000-0000-0000-0000-000000000002', now()),
  ('00000000-0000-0000-0000-000000002002', 'Lead OrgB-2', 'OrgB Inc', '+5511999990102', 'orgb2@test.com', '00000000-0000-0000-0000-000000000002', now())
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8a. organization_role_permissions (Org A, role 'member')
-- ────────────────────────────────────────────────────────────
INSERT INTO organization_role_permissions (organization_id, role, permission_key, enabled)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_unassigned_cards',   false),
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_subordinates_cards', false),
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_general_info',       true),
  ('00000000-0000-0000-0000-000000000001', 'member', 'see_all_leads',          false),
  ('00000000-0000-0000-0000-000000000001', 'member', 'can_delete_leads',       false)
ON CONFLICT (organization_id, role, permission_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8b. feature_permissions (global catalog — idempotent)
-- ────────────────────────────────────────────────────────────
INSERT INTO feature_permissions (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES
  ('leads.view_all',     'Leads',      'Ver leads de todos',    'Vê leads atribuídos a outros membros', false, false, 70),
  ('leads.create',       'Leads',      'Criar lead',            'Cria novos leads manualmente',         false, true,  20),
  ('leads.delete',       'Leads',      'Excluir lead',          'Exclui leads permanentemente',         false, false, 40),
  ('workflows.edit',     'Automações', 'Editar automação',      'Edita workflows existentes',           true,  true,  30),
  ('workflows.create',   'Automações', 'Criar automação',       'Cria novos workflows de automação',    true,  true,  20),
  ('copilot.create',     'Copilot',    'Criar agente IA',       'Cria novos agentes de IA',             false, true,  20),
  ('team.view',          'Equipe',     'Ver equipe',            'Acessa a página da equipe',            true,  true,  10)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8c. member_feature_permissions (Member Two gets leads.view_all=true)
-- ────────────────────────────────────────────────────────────
INSERT INTO member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
VALUES (
  '00000000-0000-0000-0000-000000000150',
  '00000000-0000-0000-0000-000000000001',
  'leads.view_all',
  true
) ON CONFLICT (team_member_id, feature_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 8d. team_member_permissions (Member One: leads/delete = 'denied')
-- ────────────────────────────────────────────────────────────
INSERT INTO team_member_permissions (team_member_id, resource_key, action_key, value)
VALUES (
  '00000000-0000-0000-0000-000000000140',
  'leads',
  'delete',
  'denied'
) ON CONFLICT (team_member_id, resource_key, action_key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 9. pipe_whatsapp entries
-- ────────────────────────────────────────────────────────────
INSERT INTO pipe_whatsapp (lead_id, organization_id, status, created_at)
VALUES
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000000001', 'novo', now()),
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000002', 'novo', now())
ON CONFLICT DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 10. Tags
-- ────────────────────────────────────────────────────────────
INSERT INTO tags (name, organization_id, created_at)
VALUES
  ('Tag Org A', '00000000-0000-0000-0000-000000000001', now()),
  ('Tag Org B', '00000000-0000-0000-0000-000000000002', now())
ON CONFLICT DO NOTHING;

-- Re-enable seat limit trigger
ALTER TABLE team_members ENABLE TRIGGER trg_enforce_seat_limit;
