-- supabase/tests/prod-only/setores_regime_estrito_prod_test.sql
--
-- Setores x regime dono estrito (strict_lead_owner_access) — SÓ roda com as
-- definições de PROD por baixo. NÃO entra no run.sh do CI: o regime estrito
-- (private.strict_*, jrtex_*, riofix_*, ~70 policies) não está em main.
--
-- Como rodar (runner pgTAP; o prelúdio vem de uma extração SOMENTE LEITURA de
-- prod com os policies de leads/pipelines/pipeline_entries e o fecho das
-- funções private.*/public.* que elas chamam):
--   node ~/.claude/tools/pgtap-preview/runner.mjs pgtap <este-arquivo> \
--        --migration <prod_prelude.sql> --migration <migration-de-setores-sem-BEGIN/COMMIT>
--
-- Prova:
--   (a) o prelúdio de prod está ativo junto com as policies de setor
--   (b) org ESTRITA com 2 setores: membro vê só o que é dono E é do setor
--   (c) GAP CONHECIDO: o supervisor NÃO vê o lead do setor dele quando não é
--       dono, porque strict_owner_* (RESTRICTIVE) exige posse
--   (d) CORREÇÃO da fase 2, prototipada aqui: strict_lead_is_owned passa a aceitar
--       o supervisor do setor do lead. Efeito: supervisor vê/edita o setor
--       inteiro e só ele; membro e outro setor ficam como estavam.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- (a) ----------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads'
             AND policyname = 'strict_owner_leads_select')
  AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads'
             AND policyname = 'sector_scope_leads_select'),
  '(a) policies do regime estrito de prod E de setores coexistem em leads');

-- Fixtures: org X estrita, 2 setores (Y padrão, Z)
SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone, feature_flags)
VALUES ('5ec7a000-0000-0000-0000-00000000000a', 'Org X estrita', 'org-x-estrita-setores-t',
        'America/Sao_Paulo', '{"strict_lead_owner_access": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
FROM (VALUES
  ('5ec7a001-0000-0000-0000-000000000001'::uuid, 'admin-x@setores.test'),
  ('5ec7a001-0000-0000-0000-000000000002'::uuid, 'sup-x@setores.test'),
  ('5ec7a001-0000-0000-0000-000000000003'::uuid, 'mem-x-y@setores.test'),
  ('5ec7a001-0000-0000-0000-000000000004'::uuid, 'mem-x-z@setores.test')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('5ec7a002-0000-0000-0000-000000000001', '5ec7a000-0000-0000-0000-00000000000a', '5ec7a001-0000-0000-0000-000000000001', 'Admin X',  'admin',  true),
  ('5ec7a002-0000-0000-0000-000000000002', '5ec7a000-0000-0000-0000-00000000000a', '5ec7a001-0000-0000-0000-000000000002', 'Sup X',    'member', true),
  ('5ec7a002-0000-0000-0000-000000000003', '5ec7a000-0000-0000-0000-00000000000a', '5ec7a001-0000-0000-0000-000000000003', 'Mem X Y',  'member', true),
  ('5ec7a002-0000-0000-0000-000000000004', '5ec7a000-0000-0000-0000-00000000000a', '5ec7a001-0000-0000-0000-000000000004', 'Mem X Z',  'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.sectors (id, organization_id, name, is_default) VALUES
  ('5ec7a003-0000-0000-0000-000000000001', '5ec7a000-0000-0000-0000-00000000000a', 'XY', true),
  ('5ec7a003-0000-0000-0000-000000000002', '5ec7a000-0000-0000-0000-00000000000a', 'XZ', false);

INSERT INTO public.sector_members (sector_id, team_member_id, organization_id, sector_role) VALUES
  ('5ec7a003-0000-0000-0000-000000000001', '5ec7a002-0000-0000-0000-000000000002', '5ec7a000-0000-0000-0000-00000000000a', 'supervisor'),
  ('5ec7a003-0000-0000-0000-000000000001', '5ec7a002-0000-0000-0000-000000000003', '5ec7a000-0000-0000-0000-00000000000a', 'member'),
  ('5ec7a003-0000-0000-0000-000000000002', '5ec7a002-0000-0000-0000-000000000004', '5ec7a000-0000-0000-0000-00000000000a', 'member');

-- LY1: do setor Y e DE POSSE do membro de Y | LY2: do setor Y, sem dono do membro
-- LZ1: do setor Z, de posse do membro de Z
INSERT INTO public.leads (id, organization_id, name, sdr_id) VALUES
  ('5ec7a004-0000-0000-0000-000000000001', '5ec7a000-0000-0000-0000-00000000000a', 'LY1', '5ec7a002-0000-0000-0000-000000000003'),
  ('5ec7a004-0000-0000-0000-000000000002', '5ec7a000-0000-0000-0000-00000000000a', 'LY2', NULL),
  ('5ec7a004-0000-0000-0000-000000000003', '5ec7a000-0000-0000-0000-00000000000a', 'LZ1', '5ec7a002-0000-0000-0000-000000000004');

INSERT INTO public.lead_sectors (lead_id, sector_id, organization_id) VALUES
  ('5ec7a004-0000-0000-0000-000000000001', '5ec7a003-0000-0000-0000-000000000001', '5ec7a000-0000-0000-0000-00000000000a'),
  ('5ec7a004-0000-0000-0000-000000000002', '5ec7a003-0000-0000-0000-000000000001', '5ec7a000-0000-0000-0000-00000000000a'),
  ('5ec7a004-0000-0000-0000-000000000003', '5ec7a003-0000-0000-0000-000000000002', '5ec7a000-0000-0000-0000-00000000000a');

SET LOCAL session_replication_role = origin;
SET LOCAL role authenticated;

-- (b) membro de Y na org estrita ---------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec7a001-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec7a000-0000-0000-0000-00000000000a'),
  ARRAY['LY1']::text[],
  '(b) org estrita + setores: o membro de Y vê só o que é dele E do setor dele');

-- (c) GAP: supervisor sob o regime estrito -------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec7a001-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec7a000-0000-0000-0000-00000000000a'),
  0,
  '(c) GAP CONHECIDO: o supervisor de Y NÃO vê o setor dele numa org estrita (strict_owner_* exige posse)');

-- admin continua fora do regime
SET LOCAL role postgres;
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec7a001-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.leads
    WHERE organization_id = '5ec7a000-0000-0000-0000-00000000000a'),
  3, '(b) admin da org estrita continua vendo tudo');

-- (d) Correção da fase 2, prototipada: o supervisor do setor do lead "possui" o lead.
-- Reescreve strict_lead_is_owned = <corpo original> OR <supervisor do setor do lead>.
SET LOCAL role postgres;
DO $fix$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_proc p
   WHERE p.pronamespace = 'private'::regnamespace AND p.proname = 'strict_lead_is_owned';
  -- corpo original: BEGIN RETURN ( ... ); END
  v_src := regexp_replace(v_src, '^\s*BEGIN\s+RETURN\s*\(',
    'BEGIN RETURN ((p_org = ANY ((SELECT private.sector_supervisor_orgs())::uuid[]) AND private.lead_in_sectors(p_org, p_lead, (SELECT private.my_supervised_sector_ids()))) OR (');
  v_src := regexp_replace(v_src, '\)\s*;\s*END\s*;?\s*$', ')); END');
  EXECUTE 'CREATE OR REPLACE FUNCTION private.strict_lead_is_owned(p_org uuid, p_lead uuid) '
       || 'RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '''' AS '
       || quote_literal(v_src);
END
$fix$;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"5ec7a001-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec7a000-0000-0000-0000-00000000000a'),
  ARRAY['LY1','LY2']::text[],
  '(d) com a correção: o supervisor de Y vê o setor Y inteiro (inclusive lead de outro dono) e nada de Z');

WITH u AS (
  UPDATE public.leads SET name = 'LY2_editado'
   WHERE id = '5ec7a004-0000-0000-0000-000000000002' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 1,
  '(d) com a correção: o supervisor de Y EDITA lead do setor Y sem ser dono');

WITH u AS (
  UPDATE public.leads SET name = 'LZ1_hack'
   WHERE id = '5ec7a004-0000-0000-0000-000000000003' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0,
  '(d) com a correção: o supervisor de Y continua sem editar lead de Z');

SELECT set_config('request.jwt.claims',
  '{"sub":"5ec7a001-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT is(
  (SELECT array_agg(name ORDER BY name COLLATE "C") FROM public.leads
    WHERE organization_id = '5ec7a000-0000-0000-0000-00000000000a'),
  ARRAY['LY1']::text[],
  '(d) com a correção: o MEMBRO de Y continua vendo só o que é dele (a correção só abre para supervisor)');

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
