-- mapa_uf_espelho_rls_test.sql
--
-- Mapa de clientes: o drawer (get_leads_by_uf) e as contagens do mapa
-- (get_uf_heatmap) só valem sobre os leads que quem chama vê na /leads —
-- 20280111000700_mapa_uf_so_o_que_a_rls_deixa_ver.sql.
--
-- O invariante, ator a ator: os ids do drawer são os ids que a RLS de
-- public.leads entrega ao mesmo papel (set_eq). Cada ramo da policy de SELECT
-- tem um ator que só passa por ele — se alguém mudar a policy sem mudar o
-- espelho, o ator do ramo mudado cai aqui.
--
-- Fixtures — 2 orgs, 10 atores:
--   RESTRITO  membro ativo da A, sem leads.view_all/view_unassigned/view_subordinates
--   VIEWALL   membro ativo da A, com leads.view_all
--   OUTRO     membro ativo da A, dono dos leads que o RESTRITO não vê
--   SEMDONO   membro ativo da A, só com leads.view_unassigned
--   SUBORD    membro ativo da A, só com leads.view_subordinates
--   FUNIL     membro ativo da A, sem permissão, responsável por 1 card de funil
--   ADMIN     admin ativo da A
--   MASTER    master_users ativo, sem team_members
--   GESTOR    gestor ativo com binding na A, sem team_members
--   FORA      membro ativo da B
-- Leads da A em SC: 4 do RESTRITO (sdr, closer, pré-venda, venda), 1 do OUTRO
-- com o RESTRITO de co-dono, 1 só do OUTRO (com card do FUNIL), 1 sem
-- responsável e 1 do RESTRITO na lixeira. Em MG: 65 do OUTRO (teto). Sem UF:
-- 1 do RESTRITO e 1 do OUTRO. Na B: 1 em SC, da FORA.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(30);

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone)
VALUES
  ('1f0d0011-aaaa-4000-8000-000000000a01', 'Org A (espelho)', 'org-a-espelho-rls', 'America/Sao_Paulo'),
  ('1f0d0011-bbbb-4000-8000-000000000b01', 'Org B (espelho)', 'org-b-espelho-rls', 'America/Sao_Paulo')
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
  ('1f0d0012-0000-4000-8000-0000000000a1'::uuid, 'restrito-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a2'::uuid, 'viewall-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a3'::uuid, 'outro-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a4'::uuid, 'admin-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a5'::uuid, 'master-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a6'::uuid, 'gestor-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a7'::uuid, 'semdono-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a8'::uuid, 'subord-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000a9'::uuid, 'funil-espelho@test.local'),
  ('1f0d0012-0000-4000-8000-0000000000b1'::uuid, 'fora-espelho@test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active)
VALUES
  ('1f0d0013-0000-4000-8000-0000000000a1', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a1', 'Restrito', 'member', true),
  ('1f0d0013-0000-4000-8000-0000000000a2', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a2', 'View all', 'member', true),
  ('1f0d0013-0000-4000-8000-0000000000a3', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a3', 'Outro', 'member', true),
  ('1f0d0013-0000-4000-8000-0000000000a4', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a4', 'Admin', 'admin', true),
  ('1f0d0013-0000-4000-8000-0000000000a7', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a7', 'Sem dono', 'member', true),
  ('1f0d0013-0000-4000-8000-0000000000a8', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a8', 'Subordinados', 'member', true),
  ('1f0d0013-0000-4000-8000-0000000000a9', '1f0d0011-aaaa-4000-8000-000000000a01',
   '1f0d0012-0000-4000-8000-0000000000a9', 'Funil', 'member', true),
  ('1f0d0013-0000-4000-8000-0000000000b1', '1f0d0011-bbbb-4000-8000-000000000b01',
   '1f0d0012-0000-4000-8000-0000000000b1', 'Fora', 'member', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('1f0d0012-0000-4000-8000-0000000000a5', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestores (id, user_id, is_active)
VALUES ('1f0d0014-0000-4000-8000-0000000000a6', '1f0d0012-0000-4000-8000-0000000000a6', true)
ON CONFLICT (user_id) DO UPDATE SET is_active = true;

INSERT INTO public.gestor_organizations (gestor_id, organization_id)
VALUES ('1f0d0014-0000-4000-8000-0000000000a6', '1f0d0011-aaaa-4000-8000-000000000a01')
ON CONFLICT (gestor_id, organization_id) DO NOTHING;

-- Catálogo como em prod (20270818120000: as três nascem true). Os overrides
-- abaixo decidem quem vê o quê: cada um ganha só a sua.
INSERT INTO public.feature_permissions
  (key, module, name, description, is_admin_only, default_value, sort_order)
VALUES ('leads.view_all', 'Leads', 'Ver todos os leads', 'fixture', false, true, 0),
       ('leads.view_subordinates', 'Leads', 'Ver leads de subordinados', 'fixture', false, true, 0),
       ('leads.view_unassigned', 'Leads', 'Ver leads sem responsável', 'fixture', false, true, 0)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
SELECT tm.id, tm.organization_id, k.key,
       (tm.id = '1f0d0013-0000-4000-8000-0000000000a2' AND k.key = 'leads.view_all')
       OR (tm.id = '1f0d0013-0000-4000-8000-0000000000a7' AND k.key = 'leads.view_unassigned')
       OR (tm.id = '1f0d0013-0000-4000-8000-0000000000a8' AND k.key = 'leads.view_subordinates')
FROM public.team_members tm,
     unnest(ARRAY['leads.view_all', 'leads.view_subordinates', 'leads.view_unassigned']) AS k(key)
WHERE tm.id IN ('1f0d0013-0000-4000-8000-0000000000a1', '1f0d0013-0000-4000-8000-0000000000a2',
                '1f0d0013-0000-4000-8000-0000000000a3', '1f0d0013-0000-4000-8000-0000000000a7',
                '1f0d0013-0000-4000-8000-0000000000a8', '1f0d0013-0000-4000-8000-0000000000a9',
                '1f0d0013-0000-4000-8000-0000000000b1');

INSERT INTO public.leads
  (id, organization_id, name, uf, uf_source, sdr_id, closer_id, pre_sale_responsible_id, sale_responsible_id, deleted_at)
VALUES
  -- SC, do RESTRITO por cada uma das 4 colunas de responsável
  ('1f0d0015-0000-4000-8000-000000000001', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC sdr',      'SC', 'ddd', '1f0d0013-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL),
  ('1f0d0015-0000-4000-8000-000000000002', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC closer',   'SC', 'ddd', NULL, '1f0d0013-0000-4000-8000-0000000000a1', NULL, NULL, NULL),
  ('1f0d0015-0000-4000-8000-000000000003', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC pré',      'SC', 'ddd', '1f0d0013-0000-4000-8000-0000000000a3', NULL, '1f0d0013-0000-4000-8000-0000000000a1', NULL, NULL),
  ('1f0d0015-0000-4000-8000-000000000004', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC venda',    'SC', 'ddd', '1f0d0013-0000-4000-8000-0000000000a3', NULL, NULL, '1f0d0013-0000-4000-8000-0000000000a1', NULL),
  -- SC, do OUTRO, com o RESTRITO de co-dono
  ('1f0d0015-0000-4000-8000-000000000005', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC co-dono',  'SC', 'ddd', NULL, NULL, NULL, '1f0d0013-0000-4000-8000-0000000000a3', NULL),
  -- SC, só do OUTRO (o FUNIL tem o card dele)
  ('1f0d0015-0000-4000-8000-000000000006', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC do outro', 'SC', 'ddd', '1f0d0013-0000-4000-8000-0000000000a3', NULL, NULL, NULL, NULL),
  -- SC, sem responsável
  ('1f0d0015-0000-4000-8000-000000000007', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC sem dono', 'SC', 'ddd', NULL, NULL, NULL, NULL, NULL),
  -- SC, do RESTRITO, na lixeira
  ('1f0d0015-0000-4000-8000-000000000008', '1f0d0011-aaaa-4000-8000-000000000a01', 'SC lixeira',  'SC', 'ddd', '1f0d0013-0000-4000-8000-0000000000a1', NULL, NULL, NULL, now()),
  -- sem UF: um do RESTRITO, um do OUTRO
  ('1f0d0015-0000-4000-8000-000000000009', '1f0d0011-aaaa-4000-8000-000000000a01', 'Sem UF meu',   NULL, NULL, '1f0d0013-0000-4000-8000-0000000000a1', NULL, NULL, NULL, NULL),
  ('1f0d0015-0000-4000-8000-000000000010', '1f0d0011-aaaa-4000-8000-000000000a01', 'Sem UF outro', NULL, NULL, '1f0d0013-0000-4000-8000-0000000000a3', NULL, NULL, NULL, NULL),
  -- B: SC da FORA
  ('1f0d0015-0000-4000-8000-0000000000b1', '1f0d0011-bbbb-4000-8000-000000000b01', 'SC da B',      'SC', 'ddd', '1f0d0013-0000-4000-8000-0000000000b1', NULL, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- MG: 65 do OUTRO — passa do teto de 60.
INSERT INTO public.leads (id, organization_id, name, uf, uf_source, sdr_id)
SELECT md5('espelho-mg-' || g)::uuid, '1f0d0011-aaaa-4000-8000-000000000a01', 'MG ' || g, 'MG', 'ddd',
       '1f0d0013-0000-4000-8000-0000000000a3'
FROM generate_series(1, 65) AS g
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_owners (organization_id, lead_id, team_member_id, role, is_primary, source)
VALUES ('1f0d0011-aaaa-4000-8000-000000000a01', '1f0d0015-0000-4000-8000-000000000005',
        '1f0d0013-0000-4000-8000-0000000000a1', 'co', false, 'manual');

-- O card do lead 'SC do outro' num funil, com o FUNIL de responsável.
INSERT INTO public.pipelines (id, organization_id, name, slug, type, is_active)
VALUES ('1f0d0016-0000-4000-8000-000000000001', '1f0d0011-aaaa-4000-8000-000000000a01', 'Funil espelho', 'funil-espelho-rls', 'custom', true);
INSERT INTO public.pipeline_stages (id, organization_id, pipeline_id, pipeline_type, stage_key, name, position, stage_role, is_active)
VALUES ('1f0d0017-0000-4000-8000-000000000001', '1f0d0011-aaaa-4000-8000-000000000a01', '1f0d0016-0000-4000-8000-000000000001',
        'funil-espelho-rls', 'novo', 'Novo', 1, 'open', true);
INSERT INTO public.pipeline_entries (id, organization_id, pipeline_id, stage_id, stage_key, lead_id, assigned_to, metadata)
VALUES ('1f0d0018-0000-4000-8000-000000000001', '1f0d0011-aaaa-4000-8000-000000000a01', '1f0d0016-0000-4000-8000-000000000001',
        '1f0d0017-0000-4000-8000-000000000001', 'novo', '1f0d0015-0000-4000-8000-000000000006',
        '1f0d0013-0000-4000-8000-0000000000a9', '{}'::jsonb);

SET LOCAL session_replication_role = origin;

-- Resumo do mapa de uma org, como texto estável: "SC:5|sem:1".
CREATE OR REPLACE FUNCTION pg_temp.resumo(p_org uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(trim(uf) || ':' || leads_count, ',' ORDER BY uf), '(vazio)')
         || '|sem:' || coalesce(max(unmapped_count)::text, '-')
  FROM public.get_uf_heatmap(p_org)
$$;

-- ── Contrato ──────────────────────────────────────────────────────────────
SELECT ok((SELECT bool_and(prosecdef) FROM pg_proc
            WHERE oid IN ('public.get_leads_by_uf(character,integer,uuid)'::regprocedure,
                          'public.get_uf_heatmap(uuid)'::regprocedure)),
  'C1: as duas continuam SECURITY DEFINER (leem private.* em prod)');
SELECT ok(position('Só o que quem chama vê na /leads (20280111000700)' IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) > 0
      AND position('Só o que quem chama vê na /leads (20280111000700)' IN pg_get_functiondef('public.get_uf_heatmap(uuid)'::regprocedure)) > 0,
  'C2: as duas têm o espelho da RLS');
SELECT ok(position('LIMIT LEAST(COALESCE(p_limit, 60), 60);' IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) > 0
      AND position('LIMIT p_limit;' IN pg_get_functiondef('public.get_leads_by_uf(character,integer,uuid)'::regprocedure)) = 0,
  'C3: o drawer tem teto de 60');
SELECT ok(NOT has_function_privilege('anon', 'public.get_leads_by_uf(character,integer,uuid)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.get_uf_heatmap(uuid)', 'EXECUTE'),
  'C4: anon não executa nenhuma das duas');
SELECT ok(has_function_privilege('authenticated', 'public.get_leads_by_uf(character,integer,uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.get_uf_heatmap(uuid)', 'EXECUTE'),
  'C5: authenticated continua executando as duas');

SET LOCAL role authenticated;

-- ── Membro SEM leads.view_all ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'R1: membro sem view_all — o drawer devolve exatamente o que a RLS deixa ele ver');
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  ARRAY['1f0d0015-0000-4000-8000-000000000001', '1f0d0015-0000-4000-8000-000000000002',
        '1f0d0015-0000-4000-8000-000000000003', '1f0d0015-0000-4000-8000-000000000004',
        '1f0d0015-0000-4000-8000-000000000005']::uuid[],
  'R2: só os seus — as 4 colunas de responsável e o de que é co-dono (antes: os 7 da UF)');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('MG', 1000, '1f0d0011-aaaa-4000-8000-000000000a01')), 0,
  'R3: p_limit alto não abre os 65 leads do colega');
SELECT is(pg_temp.resumo('1f0d0011-aaaa-4000-8000-000000000a01'), 'SC:5|sem:1',
  'R4: o mapa dele conta só o que ele vê (sem MG, 1 sem UF)');

-- ── Ramo "sem responsável" (leads.view_unassigned) ────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a7","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'U1: só view_unassigned — drawer igual à RLS');
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  ARRAY['1f0d0015-0000-4000-8000-000000000005', '1f0d0015-0000-4000-8000-000000000007']::uuid[],
  'U2: e vê exatamente os sem SDR e sem closer');

-- ── Ramo "subordinados" (leads.view_subordinates) ─────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a8","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'B1: só view_subordinates — drawer igual à RLS');
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  ARRAY['1f0d0015-0000-4000-8000-000000000001', '1f0d0015-0000-4000-8000-000000000002',
        '1f0d0015-0000-4000-8000-000000000003', '1f0d0015-0000-4000-8000-000000000004',
        '1f0d0015-0000-4000-8000-000000000006']::uuid[],
  'B2: e vê os de SDR/closer da org');

-- ── Ramo "funil" (card com ele de responsável) ────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a9","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'P1: responsável por card de funil — drawer igual à RLS');
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  ARRAY['1f0d0015-0000-4000-8000-000000000006']::uuid[],
  'P2: e vê só o lead do card dele');

-- ── Membro COM leads.view_all ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'V1: membro com view_all — drawer igual à RLS');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01')), 7,
  'V2: e vê os 7 da UF (o da lixeira, não)');

-- ── Admin ─────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a4","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'A1: admin — drawer igual à RLS');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01')), 7,
  'A2: admin vê todos os 7');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('MG', 1000, '1f0d0011-aaaa-4000-8000-000000000a01')), 60,
  'A3: teto — p_limit 1000 devolve 60 dos 65');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('MG', NULL, '1f0d0011-aaaa-4000-8000-000000000a01')), 60,
  'A4: teto — p_limit NULL (antes: LIMIT ALL) devolve 60');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('MG', 5, '1f0d0011-aaaa-4000-8000-000000000a01')), 5,
  'A5: limite menor que o teto continua valendo');
SELECT is(pg_temp.resumo('1f0d0011-aaaa-4000-8000-000000000a01'), 'MG:65,SC:7|sem:2',
  'A6: o mapa do admin conta a base inteira');

-- ── Master (sem team_members) ─────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a5","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'MA1: master — drawer igual à RLS');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01')), 7,
  'MA2: master vê todos os 7');

-- ── Gestor de portfólio (sem team_members) ────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  $$ SELECT id FROM public.leads WHERE organization_id = '1f0d0011-aaaa-4000-8000-000000000a01' AND uf = 'SC' AND deleted_at IS NULL $$,
  'G1: gestor — drawer igual à RLS');
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01')), 7,
  'G2: gestor vê todos os 7 da org que gerencia');

-- ── Membro de OUTRA org ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"1f0d0012-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok($$ SELECT * FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01') $$,
  'P0001', 'access_denied', 'F1: outra org é negada (assert_org_access)');
SELECT set_eq(
  $$ SELECT id FROM public.get_leads_by_uf('SC', 60, '1f0d0011-bbbb-4000-8000-000000000b01') $$,
  ARRAY['1f0d0015-0000-4000-8000-0000000000b1']::uuid[],
  'F2: e na própria org vê o que é seu');

-- ── Backend (service_role) ────────────────────────────────────────────────
SET LOCAL role service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is((SELECT count(*)::int FROM public.get_leads_by_uf('SC', 60, '1f0d0011-aaaa-4000-8000-000000000a01')), 7,
  'S1: service_role vê como BYPASSRLS (não recebe vazio em silêncio)');

SELECT * FROM finish();
ROLLBACK;
