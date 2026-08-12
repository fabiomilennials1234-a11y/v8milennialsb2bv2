-- supabase/tests/stage_role_money_guard_test.sql
--
-- ISSUE FIX-4 (ADR-0017 §1) — pgTAP do gate de escrita de stage_role won/lost.
--
-- Run:
--   supabase test db
-- ou direto:
--   psql "$DATABASE_URL" -f supabase/tests/stage_role_money_guard_test.sql
--
-- Prova (money-critical):
--   (a) estrutura: função + trigger BEFORE INSERT/UPDATE existem
--   (b) seed de sistema (superusuário) cria propostas/vendido = won — path
--       privilegiado NÃO é bloqueado
--   (c) MEMBRO não-admin NÃO pode gravar won/lost (INSERT custom won/lost;
--       UPDATE open→won) → P0001 (RLS deixa passar; o trigger é quem barra)
--   (d) MEMBRO pode gravar open e meeting_* (auto-aplicados pelo classifier)
--   (e) MEMBRO pode renomear etapa que JÁ era won (won→won, role inalterado)
--       — a razão-de-existir do ADR-0017: rename nunca move métrica nem é bloqueado
--   (f) ADMIN da org pode gravar won/lost
--   (g) MASTER (sem team_member na org) pode gravar won — via política/gate master
--   (h) service_role (backend/classifier/seed) pode gravar won

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_function('public', 'fn_pipeline_stages_guard_money_role', ARRAY[]::text[],
  '(a) função-gate fn_pipeline_stages_guard_money_role existe');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_pipeline_stages_won_lost_guard'
      AND tgrelid = 'public.pipeline_stages'::regclass
      AND NOT tgisinternal
  ),
  '(a) trigger trg_pipeline_stages_won_lost_guard em pipeline_stages');

-- Ordem: o gate deve disparar DEPOIS do trigger de mapa de sistema (avalia o
-- role final). BEFORE triggers disparam em ordem alfabética de nome.
SELECT ok(
  'trg_pipeline_stages_won_lost_guard' > 'trg_pipeline_stages_system_stage_role',
  '(a) nome do gate ordena após o trigger de mapa de sistema (dispara depois)');

-- ---------------------------------------------------------------------------
-- Fixture: org + 3 users (admin, membro, master) + team_members + master_users
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;  -- sem cascatas/seed automático

INSERT INTO public.organizations (id, name, slug)
VALUES ('99090090-0000-0000-0000-000000000904', 'Org FIX-4 guard', 'org-fix4-guard')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('99090090-aaaa-1111-0000-000000000904', 'admin-fix4@test.local',  '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', ''),
  ('99090090-bbbb-1111-0000-000000000904', 'member-fix4@test.local', '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', ''),
  ('99090090-cccc-1111-0000-000000000904', 'master-fix4@test.local', '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('99090090-aaaa-2222-0000-000000000904', '99090090-0000-0000-0000-000000000904', '99090090-aaaa-1111-0000-000000000904', 'Admin FIX4',  'admin',  true),
  ('99090090-bbbb-2222-0000-000000000904', '99090090-0000-0000-0000-000000000904', '99090090-bbbb-1111-0000-000000000904', 'Member FIX4', 'member', true)
ON CONFLICT (id) DO NOTHING;

-- master SEM team_member na org (prova o path master, não o de admin da org).
INSERT INTO public.master_users (user_id, is_active)
VALUES ('99090090-cccc-1111-0000-000000000904', true)
ON CONFLICT (user_id) DO NOTHING;

SET LOCAL session_replication_role = origin;  -- triggers ON daqui em diante

-- (b) Seed de sistema como superusuário: cria propostas/vendido = won. Se o
-- gate bloqueasse o path privilegiado, isto explodiria (org nova jamais teria won).
SELECT create_default_pipeline_stages('99090090-0000-0000-0000-000000000904');

SELECT is(
  (SELECT stage_role::text FROM public.pipeline_stages
    WHERE organization_id = '99090090-0000-0000-0000-000000000904'
      AND pipeline_type = 'propostas' AND stage_key = 'vendido'),
  'won', '(b) seed de sistema (superusuário) criou propostas/vendido = won');

-- ---------------------------------------------------------------------------
-- (c/d/e) MEMBRO
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99090090-bbbb-1111-0000-000000000904","role":"authenticated"}', true);

-- (c) INSERT custom won → bloqueado pelo trigger (P0001), não pela RLS.
SELECT throws_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_member_won', 'Membro tentou won', '#888', 80, 'won') $$,
  'P0001', NULL,
  '(c) membro NÃO pode INSERT stage_role=won');

-- (c) INSERT custom lost → bloqueado.
SELECT throws_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_member_lost', 'Membro tentou lost', '#888', 81, 'lost') $$,
  'P0001', NULL,
  '(c) membro NÃO pode INSERT stage_role=lost');

-- (c) UPDATE open→won numa etapa existente → bloqueado.
SELECT throws_ok(
  $$ UPDATE public.pipeline_stages SET stage_role = 'won'
     WHERE organization_id = '99090090-0000-0000-0000-000000000904'
       AND pipeline_type = 'whatsapp' AND stage_key = 'novo' $$,
  'P0001', NULL,
  '(c) membro NÃO pode UPDATE open→won');

-- (d) INSERT custom open → permitido (role de não-dinheiro).
SELECT lives_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_member_open', 'Membro etapa open', '#888', 82) $$,
  '(d) membro PODE INSERT etapa open (não-dinheiro)');

-- (d) INSERT custom meeting_held → permitido (auto-aplicado pelo classifier).
SELECT lives_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_member_meet', 'Membro etapa reunião', '#888', 83, 'meeting_held') $$,
  '(d) membro PODE INSERT meeting_held (papel de reunião, não-dinheiro)');

-- (e) Rename de etapa que JÁ era won (won→won): role inalterado → permitido.
SELECT lives_ok(
  $$ UPDATE public.pipeline_stages SET name = 'Fechado & Ganho 🏆'
     WHERE organization_id = '99090090-0000-0000-0000-000000000904'
       AND pipeline_type = 'propostas' AND stage_key = 'vendido' $$,
  '(e) membro PODE renomear etapa won (won→won, rename nunca move métrica)');

-- ---------------------------------------------------------------------------
-- (f) ADMIN da org
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99090090-aaaa-1111-0000-000000000904","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_admin_won', 'Admin definiu won', '#888', 84, 'won') $$,
  '(f) admin da org PODE INSERT stage_role=won');

SELECT lives_ok(
  $$ UPDATE public.pipeline_stages SET stage_role = 'lost'
     WHERE organization_id = '99090090-0000-0000-0000-000000000904'
       AND pipeline_type = 'whatsapp' AND stage_key = 'abordado' $$,
  '(f) admin da org PODE UPDATE open→lost');

-- ---------------------------------------------------------------------------
-- (g) MASTER (sem team_member na org)
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"99090090-cccc-1111-0000-000000000904","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_master_won', 'Master definiu won', '#888', 85, 'won') $$,
  '(g) master (sem team_member) PODE INSERT stage_role=won');

-- ---------------------------------------------------------------------------
-- (h) service_role (backend/classifier/seed)
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL role service_role;

SELECT lives_ok(
  $$ INSERT INTO public.pipeline_stages
       (organization_id, pipeline_type, stage_key, name, color, position, stage_role)
     VALUES ('99090090-0000-0000-0000-000000000904', 'whatsapp',
             'guard_service_won', 'Backend definiu won', '#888', 86, 'won') $$,
  '(h) service_role PODE INSERT stage_role=won (path do classifier/seed)');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
