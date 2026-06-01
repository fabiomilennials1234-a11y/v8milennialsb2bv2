-- supabase/tests/sensitive_access_log_test.sql
--
-- ISSUE #651 — pgTAP coverage for the sensitive-read audit foundation.
--
-- Run:
--   supabase test db            # runs every *_test.sql under supabase/tests/
-- or directly against a local stack:
--   psql "$DATABASE_URL" -f supabase/tests/sensitive_access_log_test.sql
-- or with pg_prove:
--   pg_prove -d "$DATABASE_URL" supabase/tests/sensitive_access_log_test.sql
--
-- Asserts:
--   (a) anon/PUBLIC cannot EXECUTE public.log_sensitive_access
--   (b) the table denies UPDATE and DELETE (no policy => blocked under RLS)
--   (c) an org-admin SELECTs only their OWN org's rows
-- Plus a red-fixture demonstration that a forged cross-org row is invisible.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- ---------------------------------------------------------------------------
-- Structural sanity
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'sensitive_access_log',
  'sensitive_access_log table exists');

SELECT has_function('public', 'log_sensitive_access',
  ARRAY['text', 'text', 'uuid', 'uuid', 'jsonb'],
  'log_sensitive_access(text,text,uuid,uuid,jsonb) exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.sensitive_access_log'::regclass),
  'RLS is ENABLED on sensitive_access_log');

-- ---------------------------------------------------------------------------
-- (a) anon / PUBLIC cannot EXECUTE the inserter
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.log_sensitive_access(text,text,uuid,uuid,jsonb)', 'EXECUTE'),
  '(a) anon CANNOT execute log_sensitive_access');

SELECT ok(
  NOT has_function_privilege('public',
    'public.log_sensitive_access(text,text,uuid,uuid,jsonb)', 'EXECUTE'),
  '(a) PUBLIC role CANNOT execute log_sensitive_access');

SELECT ok(
  has_function_privilege('authenticated',
    'public.log_sensitive_access(text,text,uuid,uuid,jsonb)', 'EXECUTE'),
  '(a) authenticated CAN execute log_sensitive_access (positive control)');

-- ---------------------------------------------------------------------------
-- Fixtures: two orgs + two admin users, one row in each org.
-- We seed via service-role context (RLS off) so we control both orgs' data.
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;  -- table owner / privileged seed context
-- Disable triggers + FK timing during seed (proven repo pattern in
-- tests/sql/validate_pipe_closer_rls.sql) so fixtures load deterministically.
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A (#651 test)', 'org-a-651-test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Org B (#651 test)', 'org-b-651-test')
ON CONFLICT (id) DO NOTHING;

-- Auth users to stand in as org admins. Full column set (Supabase auth.users
-- has many NOT NULL text columns) — mirrors supabase/seed.sql exactly.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('a1a1a1a1-0000-0000-0000-0000000000a1', 'admin-a-651@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', ''),
  ('b1b1b1b1-0000-0000-0000-0000000000b1', 'admin-b-651@test.local',
   '', now(), '{}'::jsonb, now(), now(),
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Admin membership in each org.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('a2a2a2a2-0000-0000-0000-0000000000a2',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'a1a1a1a1-0000-0000-0000-0000000000a1', 'Admin A', 'admin', true),
  ('b2b2b2b2-0000-0000-0000-0000000000b2',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'b1b1b1b1-0000-0000-0000-0000000000b1', 'Admin B', 'admin', true)
ON CONFLICT (id) DO NOTHING;

-- One audit row per org.
INSERT INTO public.sensitive_access_log
  (id, organization_id, actor_user_id, action, target_type, target_id, metadata)
VALUES
  ('c1c1c1c1-0000-0000-0000-0000000000c1',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'a1a1a1a1-0000-0000-0000-0000000000a1',
   'portfolio.read', 'organization',
   'aaaaaaaa-0000-0000-0000-000000000001', '{"seed":"A"}'::jsonb),
  ('c2c2c2c2-0000-0000-0000-0000000000c2',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'b1b1b1b1-0000-0000-0000-0000000000b1',
   'portfolio.read', 'organization',
   'bbbbbbbb-0000-0000-0000-000000000002', '{"seed":"B"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Restore normal trigger behavior before exercising RLS.
SET LOCAL session_replication_role = origin;

-- ---------------------------------------------------------------------------
-- (c) org-admin sees ONLY their own org's rows
-- ---------------------------------------------------------------------------
-- Impersonate Admin A as a JWT-authenticated user (matches the repo's proven
-- json_build_object('sub', ..., 'role','authenticated') claim shape).
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a1a1a1a1-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.sensitive_access_log
     WHERE organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  '(c) Admin A sees their OWN org row');

SELECT is(
  (SELECT count(*)::int FROM public.sensitive_access_log
     WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  '(c) red-fixture: Admin A sees ZERO of Org B rows (cross-tenant blocked)');

SELECT is(
  (SELECT count(*)::int FROM public.sensitive_access_log),
  1,
  '(c) Admin A total visible rows = 1 (own org only)');

-- ---------------------------------------------------------------------------
-- (b) table denies UPDATE and DELETE for org-admins (append-only).
-- Two layers enforce this: (i) authenticated holds only SELECT (no UPDATE/
-- DELETE grant), and (ii) no RLS policy permits those verbs. The privilege
-- layer trips first => the statement RAISES rather than silently no-op'ing,
-- which is the strongest "immutable" signal. We assert the throw, then prove
-- the row is untouched.
SELECT throws_ok(
  $$ UPDATE public.sensitive_access_log
       SET action = 'tampered'
     WHERE id = 'c1c1c1c1-0000-0000-0000-0000000000c1' $$,
  '42501',  -- insufficient_privilege
  NULL,
  '(b) org-admin UPDATE is DENIED (insufficient_privilege)');

SELECT throws_ok(
  $$ DELETE FROM public.sensitive_access_log
     WHERE id = 'c1c1c1c1-0000-0000-0000-0000000000c1' $$,
  '42501',  -- insufficient_privilege
  NULL,
  '(b) org-admin DELETE is DENIED (insufficient_privilege)');

SELECT is(
  (SELECT action FROM public.sensitive_access_log
     WHERE id = 'c1c1c1c1-0000-0000-0000-0000000000c1'),
  'portfolio.read',
  '(b) row is unchanged after denied UPDATE/DELETE (append-only)');

SELECT * FROM finish();

ROLLBACK;
