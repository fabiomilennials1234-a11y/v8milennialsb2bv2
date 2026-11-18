-- supabase/tests/setores_fundacao_test.sql
--
-- Setores, fase 1 (20280120000000_setores_fundacao.sql).
--
-- Prova:
--   (a) estrutura, RLS ligada, anon sem acesso
--   (b) org com 2+ setores: cada setor enxerga SÓ o que é dele (leads, funis,
--       cards); lead em dois setores aparece nos dois; lead sem linha = setor padrão
--   (c) supervisor vê e edita o setor inteiro, e só o dele
--   (d) admin da org, gestor e master enxergam tudo
--   (e) org sem setor e org com 1 setor: NADA muda (o regime curto-circuita)
--   (f) admin da org A que é membro da org B continua restrito em B
--       (is_user_admin() é global; o regime usa o papel por org)
--   (g) membro sem setor numa org regulada não vê nada (fail-closed)
--   (h) lead criado por membro herda o setor do criador (INSERT ... RETURNING)
--   (i) integridade entre orgs; setor padrão protegido; modo muda com a contagem
--   (j) backfill: dry-run não grava, apply grava, é idempotente, exige admin
--   (k) PLANTED FAILURE: sem a policy RESTRICTIVE o membro de Y enxerga Z
--
-- Run: node ~/.claude/tools/pgtap-preview/runner.mjs pgtap <este-arquivo> --migration <migration>
-- Roda inteiro dentro de transação revertida.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(53);

-- ---------------------------------------------------------------------------
-- (a) Estrutura
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'sectors',          '(a) sectors existe');
SELECT has_table('public', 'sector_members',   '(a) sector_members existe');
SELECT has_table('public', 'lead_sectors',     '(a) lead_sectors existe');
SELECT has_table('public', 'pipeline_sectors', '(a) pipeline_sectors existe');

SELECT ok(
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c
    WHERE c.oid IN ('public.sectors'::regclass, 'public.sector_members'::regclass,
                    'public.lead_sectors'::regclass, 'public.pipeline_sectors'::regclass)),
  '(a) RLS ligada nas 4 tabelas novas');

SELECT ok(
  NOT has_table_privilege('anon', 'public.sectors', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.lead_sectors', 'SELECT'),
  '(a) anon sem acesso às tabelas de setor');

SELECT ok(
  NOT has_function_privilege('anon', 'public.sectors_backfill(uuid, boolean)', 'EXECUTE'),
  '(a) anon não executa o backfill');

-- ---------------------------------------------------------------------------
-- Fixtures
--   org A (2 setores: Y padrão, Z) | org B (BY padrão, BZ)
--   org S (1 setor SS)            | org N (0 setores)
-- ---------------------------------------------------------------------------
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('5ec70000-0000-0000-0000-00000000000a', 'Org A (setores)', 'org-a-setores-t', 'America/Sao_Paulo'),
  ('5ec70000-0000-0000-0000-00000000000b', 'Org B (setores)', 'org-b-setores-t', 'America/Sao_Paulo'),
  ('5ec70000-0000-0000-0000-00000000000c', 'Org S (1 setor)', 'org-s-setores-t', 'America/Sao_Paulo'),
  ('5ec70000-0000-0000-0000-00000000000d', 'Org N (0 setor)', 'org-n-setores-t', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT
  u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '', '', '', '', '', '', '', ''
FROM (VALUES
  ('5ec70001-0000-0000-0000-000000000001'::uuid, 'admin-a@setores.test'),
  ('5ec70001-0000-0000-0000-000000000002'::uuid, 'sup-b@setores.test'),
  ('5ec70001-0000-0000-0000-000000000003'::uuid, 'sup-c@setores.test'),
  ('5ec70001-0000-0000-0000-000000000004'::uuid, 'mem-y1@setores.test'),
  ('5ec70001-0000-0000-0000-000000000005'::uuid, 'mem-y2@setores.test'),
  ('5ec70001-0000-0000-0000-000000000006'::uuid, 'mem-z1@setores.test'),
  ('5ec70001-0000-0000-0000-000000000007'::uuid, 'mem-sem-setor@setores.test'),
  ('5ec70001-0000-0000-0000-000000000008'::uuid, 'multi-org@setores.test'),
  ('5ec70001-0000-0000-0000-000000000009'::uuid, 'mem-bz@setores.test'),
  ('5ec70001-0000-0000-0000-00000000000a'::uuid, 'mem-s@setores.test'),
  ('5ec70001-0000-0000-0000-00000000000b'::uuid, 'sup-s@setores.test'),
  ('5ec70001-0000-0000-0000-00000000000c'::uuid, 'mem-n@setores.test'),
  ('5ec70001-0000-0000-0000-00000000000d'::uuid, 'gestor@setores.test'),
  ('5ec70001-0000-0000-0000-00000000000e'::uuid, 'master@setores.test')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('5ec70002-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000001', 'Admin A',    'admin',  true),
  ('5ec70002-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000002', 'Sup B',      'member', true),
  ('5ec70002-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000003', 'Sup C',      'member', true),
  ('5ec70002-0000-0000-0000-000000000004', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000004', 'Mem Y1',     'member', true),
  ('5ec70002-0000-0000-0000-000000000005', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000005', 'Mem Y2',     'member', true),
  ('5ec70002-0000-0000-0000-000000000006', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000006', 'Mem Z1',     'member', true),
  ('5ec70002-0000-0000-0000-000000000007', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000007', 'Mem sem setor', 'member', true),
  ('5ec70002-0000-0000-0000-000000000008', '5ec70000-0000-0000-0000-00000000000a', '5ec70001-0000-0000-0000-000000000008', 'Multi (admin em A)', 'admin', true),
  ('5ec70002-0000-0000-0000-000000000018', '5ec70000-0000-0000-0000-00000000000b', '5ec70001-0000-0000-0000-000000000008', 'Multi (member em B)', 'member', true),
  ('5ec70002-0000-0000-0000-000000000009', '5ec70000-0000-0000-0000-00000000000b', '5ec70001-0000-0000-0000-000000000009', 'Mem BZ',     'member', true),
  ('5ec70002-0000-0000-0000-00000000000a', '5ec70000-0000-0000-0000-00000000000c', '5ec70001-0000-0000-0000-00000000000a', 'Mem S',      'member', true),
  ('5ec70002-0000-0000-0000-00000000000b', '5ec70000-0000-0000-0000-00000000000c', '5ec70001-0000-0000-0000-00000000000b', 'Sup S',      'member', true),
  ('5ec70002-0000-0000-0000-00000000000c', '5ec70000-0000-0000-0000-00000000000d', '5ec70001-0000-0000-0000-00000000000c', 'Mem N',      'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('5ec70001-0000-0000-0000-00000000000e', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestores (id, user_id, is_active)
VALUES ('5ec70003-0000-0000-0000-0000000000f1', '5ec70001-0000-0000-0000-00000000000d', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestor_organizations (gestor_id, organization_id)
VALUES ('5ec70003-0000-0000-0000-0000000000f1', '5ec70000-0000-0000-0000-00000000000a')
ON CONFLICT (gestor_id, organization_id) DO NOTHING;

-- Setores (is_default explícito: os triggers estão desligados nesta fase)
INSERT INTO public.sectors (id, organization_id, name, is_default)
VALUES
  ('5ec70004-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a', 'Y',  true),
  ('5ec70004-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a', 'Z',  false),
  ('5ec70004-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000b', 'BY', true),
  ('5ec70004-0000-0000-0000-000000000004', '5ec70000-0000-0000-0000-00000000000b', 'BZ', false),
  ('5ec70004-0000-0000-0000-000000000005', '5ec70000-0000-0000-0000-00000000000c', 'SS', true);

INSERT INTO public.sector_members (sector_id, team_member_id, organization_id, sector_role)
VALUES
  ('5ec70004-0000-0000-0000-000000000001', '5ec70002-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a', 'supervisor'),
  ('5ec70004-0000-0000-0000-000000000002', '5ec70002-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000a', 'supervisor'),
  ('5ec70004-0000-0000-0000-000000000001', '5ec70002-0000-0000-0000-000000000004', '5ec70000-0000-0000-0000-00000000000a', 'member'),
  ('5ec70004-0000-0000-0000-000000000001', '5ec70002-0000-0000-0000-000000000005', '5ec70000-0000-0000-0000-00000000000a', 'member'),
  ('5ec70004-0000-0000-0000-000000000002', '5ec70002-0000-0000-0000-000000000006', '5ec70000-0000-0000-0000-00000000000a', 'member'),
  ('5ec70004-0000-0000-0000-000000000003', '5ec70002-0000-0000-0000-000000000018', '5ec70000-0000-0000-0000-00000000000b', 'member'),
  ('5ec70004-0000-0000-0000-000000000004', '5ec70002-0000-0000-0000-000000000009', '5ec70000-0000-0000-0000-00000000000b', 'member'),
  ('5ec70004-0000-0000-0000-000000000005', '5ec70002-0000-0000-0000-00000000000a', '5ec70000-0000-0000-0000-00000000000c', 'member'),
  ('5ec70004-0000-0000-0000-000000000005', '5ec70002-0000-0000-0000-00000000000b', '5ec70000-0000-0000-0000-00000000000c', 'supervisor');

-- Leads
INSERT INTO public.leads (id, organization_id, name, sdr_id)
VALUES
  ('5ec70005-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a', 'L_Y',    NULL),
  ('5ec70005-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a', 'L_Z',    NULL),
  ('5ec70005-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000a', 'L_both', NULL),
  ('5ec70005-0000-0000-0000-000000000004', '5ec70000-0000-0000-0000-00000000000a', 'L_none', NULL),
  ('5ec70005-0000-0000-0000-000000000005', '5ec70000-0000-0000-0000-00000000000b', 'B_Y',    NULL),
  ('5ec70005-0000-0000-0000-000000000006', '5ec70000-0000-0000-0000-00000000000b', 'B_Z',    NULL),
  ('5ec70005-0000-0000-0000-000000000007', '5ec70000-0000-0000-0000-00000000000c', 'S1',     NULL),
  ('5ec70005-0000-0000-0000-000000000008', '5ec70000-0000-0000-0000-00000000000d', 'N1',     NULL),
  ('5ec70005-0000-0000-0000-000000000009', '5ec70000-0000-0000-0000-00000000000a', 'L_bf',   NULL),
  ('5ec70005-0000-0000-0000-000000000010', '5ec70000-0000-0000-0000-00000000000a', 'L_own',  '5ec70002-0000-0000-0000-000000000006');

INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
VALUES
  ('5ec70005-0000-0000-0000-000000000001', '5ec70004-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a'),
  ('5ec70005-0000-0000-0000-000000000002', '5ec70004-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a'),
  ('5ec70005-0000-0000-0000-000000000003', '5ec70004-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a'),
  ('5ec70005-0000-0000-0000-000000000003', '5ec70004-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a'),
  ('5ec70005-0000-0000-0000-000000000005', '5ec70004-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000b'),
  ('5ec70005-0000-0000-0000-000000000006', '5ec70004-0000-0000-0000-000000000004', '5ec70000-0000-0000-0000-00000000000b');

-- Funis e cards
INSERT INTO public.pipelines (id, organization_id, name, slug)
VALUES
  ('5ec70006-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a', 'PY', 'py-setores-t'),
  ('5ec70006-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a', 'PZ', 'pz-setores-t'),
  ('5ec70006-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000a', 'PN', 'pn-setores-t');

INSERT INTO public.pipeline_sectors (pipeline_id, sector_id, organization_id)
VALUES
  ('5ec70006-0000-0000-0000-000000000001', '5ec70004-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a'),
  ('5ec70006-0000-0000-0000-000000000002', '5ec70004-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a');

INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, lead_id, stage_key)
VALUES
  ('5ec70007-0000-0000-0000-000000000001', '5ec70000-0000-0000-0000-00000000000a', '5ec70006-0000-0000-0000-000000000001', '5ec70005-0000-0000-0000-000000000001', 'novo'),
  ('5ec70007-0000-0000-0000-000000000002', '5ec70000-0000-0000-0000-00000000000a', '5ec70006-0000-0000-0000-000000000002', '5ec70005-0000-0000-0000-000000000002', 'novo'),
  ('5ec70007-0000-0000-0000-000000000003', '5ec70000-0000-0000-0000-00000000000a', '5ec70006-0000-0000-0000-000000000002', '5ec70005-0000-0000-0000-000000000009', 'novo');

SET LOCAL session_replication_role = origin;

-- Leitura "como o ator X" (nomes dos leads/funis/cards da org A)
-- ---------------------------------------------------------------------------
-- (d) Admin da org A: vê tudo
-- ---------------------------------------------------------------------------
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['L_Y','L_Z','L_bf','L_both','L_none','L_own']::text[],
  '(d) admin da org vê os leads de todos os setores');

SELECT is(
  (SELECT count(*)::int FROM public.pipelines
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  3, '(d) admin da org vê todos os funis');

SELECT is(
  (SELECT count(*)::int FROM public.pipeline_entries
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  3, '(d) admin da org vê todos os cards');

-- ---------------------------------------------------------------------------
-- (b) Membro do setor Y
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000004","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['L_Y','L_bf','L_both','L_none','L_own']::text[]
    -- L_bf e L_own ainda não têm linha: caem no setor padrão (Y)
  , '(b) membro de Y vê Y, o compartilhado e o sem-linha (setor padrão), NUNCA o exclusivo de Z');

SELECT is(
  (SELECT count(*)::int FROM public.leads WHERE name = 'L_Z'),
  0, '(b) membro de Y não vê o lead exclusivo de Z');

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.pipelines
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['PN','PY']::text[],
  '(b) membro de Y vê o funil de Y e o sem-linha (padrão), não o de Z');

SELECT is(
  (SELECT array_agg(id::text ORDER BY id) FROM public.pipeline_entries
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['5ec70007-0000-0000-0000-000000000001']::text[],
  '(b) membro de Y vê só os cards dos funis de Y');

-- ---------------------------------------------------------------------------
-- (b) Membro do setor Z
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000006","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['L_Z','L_both']::text[],
  '(b) membro de Z vê Z e o compartilhado; L_own (dele, mas sem linha = setor padrão Y) só aparece depois do backfill por dono');

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.pipelines
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['PZ']::text[],
  '(b) membro de Z vê só o funil de Z');

SELECT is(
  (SELECT array_agg(id::text ORDER BY id) FROM public.pipeline_entries
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['5ec70007-0000-0000-0000-000000000002','5ec70007-0000-0000-0000-000000000003']::text[],
  '(b) membro de Z vê só os cards dos funis de Z');

-- ---------------------------------------------------------------------------
-- (c) Supervisores
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['L_Y','L_bf','L_both','L_none','L_own']::text[],
  '(c) supervisor B vê todos os leads do setor Y e nada exclusivo de Z');

WITH u AS (
  UPDATE public.leads SET name = 'L_Y_editado'
   WHERE id = '5ec70005-0000-0000-0000-000000000001' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1,
  '(c) supervisor B EDITA lead do setor Y (mesmo sem ser dono)');

WITH u AS (
  UPDATE public.leads SET name = 'L_Z_hack'
   WHERE id = '5ec70005-0000-0000-0000-000000000002' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0,
  '(c) supervisor B NÃO edita lead exclusivo de Z');

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000b'),
  0, '(c) supervisor B não vê leads de outra org');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  ARRAY['L_Z','L_both']::text[],
  '(c) supervisor C vê o setor Z e o compartilhado, nada exclusivo de Y');

-- Membro de Y não edita lead de Z
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000004","role":"authenticated"}', true);

WITH u AS (
  UPDATE public.leads SET name = 'L_Z_hack2'
   WHERE id = '5ec70005-0000-0000-0000-000000000002' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0,
  '(b) membro de Y não edita lead exclusivo de Z');

-- ---------------------------------------------------------------------------
-- (d) Gestor de portfólio e master: tudo
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-00000000000d","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  6, '(d) gestor de portfólio vê todos os leads da org que gerencia');

SELECT is(
  (SELECT count(*)::int FROM public.pipelines
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  3, '(d) gestor de portfólio vê todos os funis');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-00000000000e","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  6, '(d) master vê todos os leads');

-- ---------------------------------------------------------------------------
-- (e) Org sem setor e org com 1 setor: nada muda
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-00000000000c","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name) FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000d'),
  ARRAY['N1']::text[],
  '(e) org SEM setores: o membro continua vendo como hoje');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-00000000000a","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name) FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000c'),
  ARRAY['S1']::text[],
  '(e) org com 1 SETOR: o membro vê como hoje (setor = org inteira)');

SELECT is(
  (SELECT array_length(private.sector_scoped_orgs(), 1)),
  NULL::int,
  '(e) org com 1 setor ou 0 setores nunca entra em sector_scoped_orgs()');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-00000000000b","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name) FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000c'),
  ARRAY['S1']::text[],
  '(e) supervisor da org de 1 setor vê todos os leads da org');

-- ---------------------------------------------------------------------------
-- (f) Admin da org A, membro da org B: restrito em B
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000008","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  6, '(f) o mesmo usuário vê tudo na org A, onde é admin');

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000b'),
  ARRAY['B_Y']::text[],
  '(f) e continua restrito ao setor BY na org B (is_user_admin() global não vaza)');

-- ---------------------------------------------------------------------------
-- (g) Membro sem setor em org regulada: fail-closed
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000007","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  0, '(g) membro SEM setor numa org regulada não vê nenhum lead');

SELECT is(
  (SELECT count(*)::int FROM public.pipelines
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  0, '(g) membro SEM setor não vê nenhum funil');

-- ---------------------------------------------------------------------------
-- (h) Lead criado por membro herda o setor do criador
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000006","role":"authenticated"}', true);

WITH i AS (
  INSERT INTO public.leads (organization_id, name)
  VALUES ('5ec70000-0000-0000-0000-00000000000a', 'L_criado_por_Z')
  RETURNING id)
SELECT is((SELECT count(*)::int FROM i), 1,
  '(h) INSERT ... RETURNING de membro de Z funciona (o lead nasce visível para o criador)');

SELECT is(
  (SELECT count(*)::int FROM public.leads WHERE name = 'L_criado_por_Z'),
  1, '(h) o criador (setor Z) enxerga o lead que criou');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000004","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads WHERE name = 'L_criado_por_Z'),
  0, '(h) membro de Y NÃO enxerga o lead criado em Z');

-- ---------------------------------------------------------------------------
-- (j) Backfill — dry-run, apply, idempotência, permissão
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', false) $$,
  '42501', NULL,
  '(j) membro comum não executa o backfill');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is((public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', false)->>'members_to_default_sector')::int, 1,
  '(j) dry-run: 1 membro sem setor iria para o setor padrão');
SELECT is((public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', false)->>'lead_sector_rows_by_funnel')::int, 1,
  '(j) dry-run: 1 lead herdaria setor pelo funil (L_bf no funil de Z)');
SELECT is((public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', false)->>'lead_sector_rows_by_owner')::int, 1,
  '(j) dry-run: 1 lead herdaria setor pelo dono (L_own, dono em Z)');
SELECT is((public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', false)->>'applied')::boolean, false,
  '(j) dry-run não aplica');

SELECT is(
  (SELECT count(*)::int FROM public.lead_sectors
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  5, '(j) dry-run NÃO gravou nada em lead_sectors (4 do fixture + 1 do lead criado em (h))');

SELECT is(
  (public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', true)->>'applied')::boolean,
  true, '(j) apply executa');

SELECT is(
  (SELECT count(*)::int FROM public.lead_sectors
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  7, '(j) apply gravou as 2 linhas novas de lead_sectors');

SELECT is(
  (SELECT count(*)::int FROM public.sector_members
    WHERE team_member_id = '5ec70002-0000-0000-0000-000000000007'),
  1, '(j) apply colocou o membro sem setor no setor padrão');

SELECT is(
  (public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', true)->>'lead_sector_rows_by_funnel')::int
  + (public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', true)->>'lead_sector_rows_by_owner')::int
  + (public.sectors_backfill('5ec70000-0000-0000-0000-00000000000a', true)->>'members_to_default_sector')::int,
  0, '(j) segunda execução é idempotente (nada novo)');

-- ---------------------------------------------------------------------------
-- (i) Integridade e modo
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
     VALUES ('5ec70005-0000-0000-0000-000000000005',
             '5ec70004-0000-0000-0000-000000000001',
             '5ec70000-0000-0000-0000-00000000000b') $$,
  '23514', 'setor de outra organização',
  '(i) não liga lead da org B a setor da org A');

SELECT throws_ok(
  $$ DO $x$ BEGIN
       INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
       VALUES ('5ec70005-0000-0000-0000-000000000005',
               '5ec70004-0000-0000-0000-000000000001',
               '5ec70000-0000-0000-0000-00000000000a');
       SET CONSTRAINTS ALL IMMEDIATE;
     END $x$ $$,
  '23514', 'lead de outra organização',
  '(i) não liga setor da org A a lead da org B (checagem adiada)');

SELECT throws_ok(
  $$ DELETE FROM public.sectors WHERE id = '5ec70004-0000-0000-0000-000000000001' $$,
  '23514', NULL,
  '(i) o setor padrão não pode ser apagado enquanto houver outros setores');

-- Modo muda com a contagem: apagar Z deixa a org A com 1 setor e libera o resto
DELETE FROM public.sectors WHERE id = '5ec70004-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000004","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec70000-0000-0000-0000-00000000000a'),
  7, '(i) org A caiu para 1 setor: o membro de Y volta a ver a org inteira');

-- ---------------------------------------------------------------------------
-- (k) PLANTED FAILURE — prova que a RESTRICTIVE é o que isola
-- ---------------------------------------------------------------------------
-- Reabre a org A com 2 setores e derruba a policy. Sem ela, o membro de Y
-- enxerga o lead exclusivo de Z (via leads.view_all). Com ela (teste (b)), não.
SET LOCAL role postgres;
INSERT INTO public.sectors (id, organization_id, name) VALUES
  ('5ec70004-0000-0000-0000-000000000009', '5ec70000-0000-0000-0000-00000000000a', 'Z2');
INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id)
VALUES ('5ec70005-0000-0000-0000-000000000002', '5ec70004-0000-0000-0000-000000000009',
        '5ec70000-0000-0000-0000-00000000000a')
ON CONFLICT DO NOTHING;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec70001-0000-0000-0000-000000000004","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads WHERE id = '5ec70005-0000-0000-0000-000000000002'),
  0, '(k) COM a RESTRICTIVE o membro de Y não enxerga o lead exclusivo de Z');

SET LOCAL role postgres;
DROP POLICY sector_scope_leads_select ON public.leads;
SET LOCAL role authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.leads WHERE id = '5ec70005-0000-0000-0000-000000000002'),
  1, '(k) PLANTED: sem a RESTRICTIVE o membro de Y enxerga lead exclusivo de Z — (b) é load-bearing');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
