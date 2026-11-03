-- supabase/tests/lista_fria_importar_e_disparar_test.sql
--
-- Lista Fria · "Importar e Disparar" (migration 20271224000000, ADR-0048).
--
--   (GR) grants: pedido lido por RLS, escrito só pelo service_role
--   (PR) lista_fria_disparo_preparar: o que ele recusa e o que ele abre
--   (UQ) um pedido ativo por busca; pedido travado não prende a busca
--
-- Personas: a1 admin da org A (flag ligada), a2 membro de A sem permissão,
-- b1 admin da org B (flag desligada).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('22f0a000-0000-4000-8000-00000000000a', 'Org DF A', 'org-df-a', 'America/Sao_Paulo'),
  ('22f0a000-0000-4000-8000-00000000000b', 'Org DF B', 'org-df-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"lista_fria": true}'::jsonb
 WHERE id = '22f0a000-0000-4000-8000-00000000000a';

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(),
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('22f0a000-0000-4000-8000-0000000000a1', 'df-admin-a@test.local'),
    ('22f0a000-0000-4000-8000-0000000000a2', 'df-membro-a@test.local'),
    ('22f0a000-0000-4000-8000-0000000000b1', 'df-admin-b@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('22f0a000-0000-4000-8000-0000000001a1', '22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000000a1', 'Admin A',  'admin',  true),
  ('22f0a000-0000-4000-8000-0000000001a2', '22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000000a2', 'Membro A', 'member', true),
  ('22f0a000-0000-4000-8000-0000000001b1', '22f0a000-0000-4000-8000-00000000000b', '22f0a000-0000-4000-8000-0000000000b1', 'Admin B',  'admin',  true)
ON CONFLICT (id) DO NOTHING;

-- Funil e etapas da org A: uma de trabalho, uma ganha, uma perdida, uma desligada.
INSERT INTO public.pipelines (id, organization_id, name, slug, is_active) VALUES
  ('22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-00000000000a', 'Prospecção', 'prospeccao-df', true),
  ('22f0a000-0000-4000-8000-0000000003a2', '22f0a000-0000-4000-8000-00000000000a', 'Desligado',  'desligado-df',  false),
  ('22f0a000-0000-4000-8000-0000000003b1', '22f0a000-0000-4000-8000-00000000000b', 'Outra org',  'outra-org-df',  true);

INSERT INTO public.pipeline_stages
  (id, organization_id, pipeline_id, stage_key, name, position, is_active, is_final_positive, is_final_negative) VALUES
  ('22f0a000-0000-4000-8000-0000000004a1', '22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000003a1', 'novo',    'Novo',    1, true,  false, false),
  ('22f0a000-0000-4000-8000-0000000004a2', '22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000003a1', 'ganho',   'Ganho',   2, true,  true,  false),
  ('22f0a000-0000-4000-8000-0000000004a3', '22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000003a1', 'perdido', 'Perdido', 3, true,  false, true),
  ('22f0a000-0000-4000-8000-0000000004a4', '22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000003a1', 'velho',   'Velho',   4, false, false, false),
  ('22f0a000-0000-4000-8000-0000000004b1', '22f0a000-0000-4000-8000-00000000000b', '22f0a000-0000-4000-8000-0000000003b1', 'novo',    'Novo',    1, true,  false, false);

-- Números da org A: comum, oficial, reservado à cobrança. E um da org B.
INSERT INTO public.whatsapp_instances (id, organization_id, instance_name, provider, reserved_for) VALUES
  ('22f0a000-0000-4000-8000-0000000005a1', '22f0a000-0000-4000-8000-00000000000a', 'comum',    'uazapi',    NULL),
  ('22f0a000-0000-4000-8000-0000000005a2', '22f0a000-0000-4000-8000-00000000000a', 'oficial',  'notificame', NULL),
  ('22f0a000-0000-4000-8000-0000000005a3', '22f0a000-0000-4000-8000-00000000000a', 'cobranca', 'uazapi',    'collections'),
  ('22f0a000-0000-4000-8000-0000000005b1', '22f0a000-0000-4000-8000-00000000000b', 'de-b',     'uazapi',    NULL);

-- Buscas da org A: uma concluída (3 selecionados novos, 1 já é lead), uma ainda rodando.
INSERT INTO public.lista_fria_buscas (id, organization_id, fonte, nicho, cidade, status, creditos_limite, finished_at) VALUES
  ('22f0a000-0000-4000-8000-0000000006a1', '22f0a000-0000-4000-8000-00000000000a', 'maps', 'Contabilidade', 'Florianópolis', 'concluida',  10, now()),
  ('22f0a000-0000-4000-8000-0000000006a2', '22f0a000-0000-4000-8000-00000000000a', 'maps', 'Dentistas',     'Florianópolis', 'executando', 10, NULL),
  ('22f0a000-0000-4000-8000-0000000006a3', '22f0a000-0000-4000-8000-00000000000a', 'maps', 'Vazia',         'Florianópolis', 'concluida',  10, now());

INSERT INTO public.lista_fria_resultados (organization_id, busca_id, ref_externa, nome, telefone, ja_e_lead, selecionado) VALUES
  ('22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000006a1', 'r1', 'Um',   '48999990001', false, true),
  ('22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000006a1', 'r2', 'Dois', '48999990002', false, true),
  ('22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000006a1', 'r3', 'Três', '48999990003', false, true),
  ('22f0a000-0000-4000-8000-00000000000a', '22f0a000-0000-4000-8000-0000000006a1', 'r4', 'Já é', '48999990004', true,  false);

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(NOT has_table_privilege('authenticated', 'public.lista_fria_disparos', 'INSERT'),
  'GR1: authenticated não cria pedido direto na tabela');
SELECT ok(NOT has_table_privilege('authenticated', 'public.lista_fria_disparos', 'UPDATE'),
  'GR2: authenticated não altera pedido');
SELECT ok(has_table_privilege('authenticated', 'public.lista_fria_disparos', 'SELECT'),
  'GR3: authenticated lê pedidos (a RLS decide quais)');
SELECT ok(NOT has_table_privilege('anon', 'public.lista_fria_disparos', 'SELECT'),
  'GR4: anon não lê pedidos');
SELECT ok(NOT has_function_privilege('anon',
  'public.lista_fria_disparo_preparar(uuid, uuid, uuid, text, uuid[], integer, integer)', 'EXECUTE'),
  'GR5: anon não prepara disparo');

-- ===========================================================================
-- (PR) preparo
-- ===========================================================================
SET LOCAL role authenticated;

-- Sem permissão: membro de A sem lista_fria.edit.
SELECT pg_temp.as_user('22f0a000-0000-4000-8000-0000000000a2');
SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi {{nome}}', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  '42501', NULL, 'PR1: membro sem lista_fria.edit não prepara disparo');

-- Org B (flag desligada) não alcança a busca da org A.
SELECT pg_temp.as_user('22f0a000-0000-4000-8000-0000000000b1');
SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi {{nome}}', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  NULL, NULL, 'PR2: admin de outra org não prepara disparo na busca alheia');

-- A partir daqui: admin da org A.
SELECT pg_temp.as_user('22f0a000-0000-4000-8000-0000000000a1');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a2',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR3: busca ainda rodando não dispara');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a2', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR4: funil desligado é recusado');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003b1', '22f0a000-0000-4000-8000-0000000004b1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR5: funil de outra org é recusado');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a2',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR6: etapa de ganho é recusada');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a3',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR7: etapa de perda é recusada');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a4',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR8: etapa desligada é recusada');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      '   ', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR9: mensagem em branco é recusada');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 1000, 30000)$$,
  'PT422', NULL, 'PR10: intervalo abaixo de 3 s é recusado');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 30000, 5000)$$,
  'PT422', NULL, 'PR11: intervalo com máximo menor que o mínimo é recusado');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a2']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR12: número do canal oficial é recusado (exige template)');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a3']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR13: número reservado à cobrança é recusado');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005b1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR14: número de outra org é recusado');

SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a3',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT422', NULL, 'PR15: busca sem contato selecionado não abre pedido');

SELECT is((SELECT count(*)::int FROM public.lista_fria_disparos), 0,
  'PR16: nenhuma recusa deixou pedido para trás');

-- O caminho feliz: 3 selecionados novos (o "já é lead" fica de fora).
SELECT is(
  (public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi {{primeiro_nome}}', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000) ->> 'total')::int,
  3, 'PR17: abre o pedido para os 3 contatos novos e selecionados');

SELECT is((SELECT status FROM public.lista_fria_disparos), 'importando',
  'PR18: o pedido nasce em "importando"');
SELECT is((SELECT criado_por FROM public.lista_fria_disparos), '22f0a000-0000-4000-8000-0000000000a1'::uuid,
  'PR19: guarda quem pediu');

-- ===========================================================================
-- (UQ) um pedido ativo por busca
-- ===========================================================================
SELECT throws_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'PT409', NULL, 'UQ1: segundo pedido enquanto o primeiro está ativo é recusado');

-- Pedido travado há mais de 15 minutos não prende a busca.
SET LOCAL role postgres;
UPDATE public.lista_fria_disparos SET ultimo_sinal_em = now() - interval '20 minutes';
SET LOCAL role authenticated;
SELECT pg_temp.as_user('22f0a000-0000-4000-8000-0000000000a1');

SELECT lives_ok(
  $$SELECT public.lista_fria_disparo_preparar('22f0a000-0000-4000-8000-0000000006a1',
      '22f0a000-0000-4000-8000-0000000003a1', '22f0a000-0000-4000-8000-0000000004a1',
      'Oi', ARRAY['22f0a000-0000-4000-8000-0000000005a1']::uuid[], 5000, 30000)$$,
  'UQ2: pedido travado é dado como abandonado e libera um novo');

SET LOCAL role postgres;
SELECT is((SELECT count(*)::int FROM public.lista_fria_disparos WHERE status = 'falhou' AND erro = 'abandonado'), 1,
  'UQ3: o travado ficou registrado como falhou/abandonado');
SELECT is((SELECT count(*)::int FROM public.lista_fria_disparos WHERE status = 'importando'), 1,
  'UQ4: há exatamente um pedido ativo');

SELECT * FROM finish();
ROLLBACK;
