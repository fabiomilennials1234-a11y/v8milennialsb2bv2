-- supabase/tests/lista_fria_fundacao_test.sql
--
-- Lista Fria · entrega 1 (migration 20271217000000_lista_fria_fundacao.sql).
--
--   (GR) grants: leitura por RLS, escrita só por RPC, worker só service_role
--   (RL) RLS: flag + lista_fria.view; org sem a flag e membro sem permissão não veem
--   (PM) RPC: flag desligada, sem permissão, membro liberado, master
--   (CR) créditos: concessão só master, reserva, saldo insuficiente, devolução da sobra
--   (WK) worker: cobra só contato novo, quem já é lead não consome, para no limite
--   (IM) importação: vira lead marcado, sem funil, fora das métricas, sem webhook
--   (GD) a marca em `leads` só muda pela RPC
--
-- Personas: a1 admin da org A (flag ligada), a2 membro de A sem permissão,
-- a3 membro de A com lista_fria.view/edit, b1 admin da org B (flag desligada),
-- c1 master.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('11f0a000-0000-4000-8000-00000000000a', 'Org LF A', 'org-lf-a', 'America/Sao_Paulo'),
  ('11f0a000-0000-4000-8000-00000000000b', 'Org LF B', 'org-lf-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"lista_fria": true}'::jsonb
 WHERE id = '11f0a000-0000-4000-8000-00000000000a';

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
    ('11f0a000-0000-4000-8000-0000000000a1', 'lf-admin-a@test.local'),
    ('11f0a000-0000-4000-8000-0000000000a2', 'lf-membro-a@test.local'),
    ('11f0a000-0000-4000-8000-0000000000a3', 'lf-operadora-a@test.local'),
    ('11f0a000-0000-4000-8000-0000000000b1', 'lf-admin-b@test.local'),
    ('11f0a000-0000-4000-8000-0000000000c1', 'lf-master@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('11f0a000-0000-4000-8000-0000000001a1', '11f0a000-0000-4000-8000-00000000000a', '11f0a000-0000-4000-8000-0000000000a1', 'Admin A',     'admin',  true),
  ('11f0a000-0000-4000-8000-0000000001a2', '11f0a000-0000-4000-8000-00000000000a', '11f0a000-0000-4000-8000-0000000000a2', 'Membro A',    'member', true),
  ('11f0a000-0000-4000-8000-0000000001a3', '11f0a000-0000-4000-8000-00000000000a', '11f0a000-0000-4000-8000-0000000000a3', 'Operadora A', 'member', true),
  ('11f0a000-0000-4000-8000-0000000001b1', '11f0a000-0000-4000-8000-00000000000b', '11f0a000-0000-4000-8000-0000000000b1', 'Admin B',     'admin',  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('11f0a000-0000-4000-8000-0000000000c1', true);

INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('11f0a000-0000-4000-8000-0000000001a3', '11f0a000-0000-4000-8000-00000000000a', 'lista_fria.view', true),
  ('11f0a000-0000-4000-8000-0000000001a3', '11f0a000-0000-4000-8000-00000000000a', 'lista_fria.edit', true);

-- Um webhook ativo da org A para provar que lead frio não vira evento de saída.
INSERT INTO public.webhooks (id, organization_id, url, events, is_active)
VALUES ('11f0a000-0000-4000-8000-0000000002a1', '11f0a000-0000-4000-8000-00000000000a',
        'https://example.invalid/hook', ARRAY['lead.created'], true)
ON CONFLICT (id) DO NOTHING;

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- ===========================================================================
-- (GR) grants
-- ===========================================================================
SELECT ok(NOT has_table_privilege('authenticated', 'public.lista_fria_buscas', 'INSERT'),
  'GR1: authenticated não escreve em buscas');
SELECT ok(NOT has_table_privilege('authenticated', 'public.lista_fria_resultados', 'UPDATE'),
  'GR2: authenticated não atualiza resultados');
SELECT ok(NOT has_table_privilege('authenticated', 'public.lista_fria_creditos', 'INSERT'),
  'GR3: authenticated não escreve no livro de créditos');
SELECT ok(NOT has_table_privilege('anon', 'public.lista_fria_buscas', 'SELECT'),
  'GR4: anon não lê buscas');
SELECT ok(has_table_privilege('authenticated', 'public.lista_fria_buscas', 'SELECT'),
  'GR5: authenticated lê buscas (a RLS decide o que)');
SELECT ok(NOT has_function_privilege('authenticated',
  'public.lista_fria_worker_registrar(uuid, text, jsonb)', 'EXECUTE'),
  'GR6: worker_registrar não é do authenticated');
SELECT ok(has_function_privilege('service_role',
  'public.lista_fria_worker_registrar(uuid, text, jsonb)', 'EXECUTE'),
  'GR7: worker_registrar é do service_role');
SELECT ok(NOT has_function_privilege('anon', 'public.lista_fria_busca_criar(uuid, text, jsonb, integer)', 'EXECUTE'),
  'GR8: anon não cria busca');

-- ===========================================================================
-- (CR) créditos — preparo como service_role para não depender de permissão
-- ===========================================================================
SET LOCAL role service_role;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

SELECT is(public.lista_fria_creditos_conceder('11f0a000-0000-4000-8000-00000000000a', 100, 'teste'), 100,
  'CR1: concessão devolve o saldo novo');

SET LOCAL role authenticated;
SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000a1');
SELECT throws_ok(
  $$SELECT public.lista_fria_creditos_conceder('11f0a000-0000-4000-8000-00000000000a', 10)$$,
  '42501', NULL, 'CR2: admin da org não libera crédito, só master');

-- ===========================================================================
-- (PM) permissões
-- ===========================================================================
SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000a2');
SELECT throws_ok(
  $$SELECT public.lista_fria_saldo('11f0a000-0000-4000-8000-00000000000a')$$,
  '42501', NULL, 'PM1: membro sem lista_fria.view não vê o saldo');

SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000b1');
SELECT throws_ok(
  $$SELECT public.lista_fria_busca_criar('11f0a000-0000-4000-8000-00000000000b', 'maps',
      '{"nicho":"Dentistas","cidade":"São Paulo - SP"}'::jsonb, 10)$$,
  '42501', NULL, 'PM2: org sem a flag não cria busca (nem o admin)');

SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000a3');
SELECT is(public.lista_fria_saldo('11f0a000-0000-4000-8000-00000000000a'), 100,
  'PM3: membro liberado vê o saldo');

SELECT throws_ok(
  $$SELECT public.lista_fria_busca_criar('11f0a000-0000-4000-8000-00000000000a', 'maps',
      '{"nicho":"Dentistas","cidade":"São Paulo - SP"}'::jsonb, 500)$$,
  'PT422', NULL, 'CR3: saldo insuficiente recusa a busca');

SELECT throws_ok(
  $$SELECT public.lista_fria_busca_criar('11f0a000-0000-4000-8000-00000000000a', 'instagram',
      '{"url":"https://www.instagram.com/p/abc123/"}'::jsonb, 10)$$,
  'PT422', NULL, 'PM4: URL de post não vale como conta');

CREATE TEMP TABLE _b (id uuid);
GRANT ALL ON _b TO authenticated;
INSERT INTO _b SELECT public.lista_fria_busca_criar('11f0a000-0000-4000-8000-00000000000a', 'maps',
  '{"nicho":"Dentistas","cidade":"São Paulo - SP"}'::jsonb, 3);

SELECT is(public.lista_fria_saldo('11f0a000-0000-4000-8000-00000000000a'), 97,
  'CR4: criar a busca reserva os créditos (100 - 3)');

SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000a3');
INSERT INTO _b SELECT public.lista_fria_busca_criar('11f0a000-0000-4000-8000-00000000000a', 'instagram',
  '{"url":"@Clinica.Odonto_Vida?hl=pt"}'::jsonb, 2);
SELECT is((SELECT instagram_handle FROM public.lista_fria_buscas
            WHERE id = (SELECT id FROM _b OFFSET 1 LIMIT 1)), 'clinica.odonto_vida',
  'PM5: o handle sai normalizado da URL/@');

-- ===========================================================================
-- (RL) RLS
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.lista_fria_buscas), 2,
  'RL1: membro liberado vê as duas buscas da org');
SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000a2');
SELECT is((SELECT count(*)::int FROM public.lista_fria_buscas), 0,
  'RL2: membro sem permissão não vê busca');
SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000b1');
SELECT is((SELECT count(*)::int FROM public.lista_fria_buscas), 0,
  'RL3: org vizinha (sem flag) não vê busca da org A');
SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000c1');
SELECT is((SELECT count(*)::int FROM public.lista_fria_buscas), 2,
  'RL4: master vê (a flag está ligada na org)');

-- ===========================================================================
-- (WK) worker — como service_role
-- ===========================================================================
SET LOCAL role service_role;
SELECT set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);

-- Já existe um lead com este telefone na org A.
SET LOCAL session_replication_role = replica;
INSERT INTO public.leads (id, organization_id, name, phone)
VALUES ('11f0a000-0000-4000-8000-0000000003a1', '11f0a000-0000-4000-8000-00000000000a',
        'Lead Antigo', '5511999990001');
SET LOCAL session_replication_role = origin;

-- As duas buscas nasceram na mesma transação (mesmo now()): fixa a ordem da fila.
UPDATE public.lista_fria_buscas SET created_at = created_at - interval '1 minute' WHERE fonte = 'maps';

SELECT is((SELECT count(*)::int FROM public.lista_fria_worker_reivindicar('w1')), 1,
  'WK1: o worker pega a busca mais antiga');
SELECT is((SELECT count(*)::int FROM public.lista_fria_worker_reivindicar('w2')), 1,
  'WK2: o segundo worker pega a outra, nunca a mesma');
SELECT is((SELECT count(*)::int FROM public.lista_fria_worker_reivindicar('w3')), 0,
  'WK3: fila vazia devolve nada');

SELECT is(
  (public.lista_fria_worker_registrar(
     (SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 'w1',
     jsonb_build_array(
       jsonb_build_object('ref_externa', 'p1', 'nome', 'Clínica Um', 'telefone', '(11) 3814-2207', 'email', 'um@x.com.br'),
       jsonb_build_object('ref_externa', 'p2', 'nome', 'Lead Antigo SA', 'telefone', '11999990001'),
       jsonb_build_object('ref_externa', 'p3', 'nome', 'Sem Contato'),
       jsonb_build_object('ref_externa', 'p4', 'nome', 'Clínica Dois', 'email', 'dois@x.com.br'),
       jsonb_build_object('ref_externa', 'p5', 'nome', 'Clínica Três', 'telefone', '1120959999'),
       jsonb_build_object('ref_externa', 'p6', 'nome', 'Passou do limite', 'telefone', '11988887777')
     )) ->> 'aceitos')::int, 3,
  'WK4: cobra só os 3 contatos novos e válidos; sem contato e já-lead não consomem');

SELECT is((SELECT creditos_usados FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 3,
  'WK5: usados = 3, no limite');
SELECT is((SELECT ja_leads FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 1,
  'WK6: o telefone que já é lead conta como ja_leads');
SELECT ok((SELECT ja_e_lead FROM public.lista_fria_resultados WHERE ref_externa = 'p2'),
  'WK7: o resultado do telefone repetido entra marcado ja_e_lead');
SELECT is((SELECT count(*)::int FROM public.lista_fria_resultados WHERE ref_externa = 'p6'), 0,
  'WK8: o que passou do limite não é gravado');
SELECT is((SELECT telefone FROM public.lista_fria_resultados WHERE ref_externa = 'p5'), '551120959999',
  'WK9: telefone sem DDI ganha o 55');

SELECT is(public.lista_fria_worker_progresso(
  (SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 'w1', 'ia', 50, 10, 6, 3, 4), 'executando',
  'WK10: progresso devolve o status');

SELECT public.lista_fria_worker_encerrar((SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 'w1', 'concluida');
SELECT public.lista_fria_worker_encerrar((SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 'w1', 'concluida');
SELECT is((SELECT status FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 'concluida',
  'WK11: busca concluída');

-- A outra busca (limite 2) usa 0: encerrar devolve os 2, uma vez só.
SELECT public.lista_fria_worker_encerrar((SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w2'), 'w2', 'concluida');
SELECT public.lista_fria_worker_encerrar((SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w2'), 'w2', 'concluida');
SELECT is(private.lista_fria_saldo_da_org('11f0a000-0000-4000-8000-00000000000a'), 97,
  'CR5: saldo = 100 - 3 usados (a sobra de 2 voltou uma vez só)');

-- ===========================================================================
-- (IM) importação
-- ===========================================================================
SET LOCAL role authenticated;
SELECT pg_temp.as_user('11f0a000-0000-4000-8000-0000000000a3');

SELECT is(public.lista_fria_resultados_selecionar(
  (SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'),
  ARRAY[(SELECT id FROM public.lista_fria_resultados WHERE ref_externa = 'p5')], false), 1,
  'IM1: desmarcar um resultado na revisão');

SELECT is(
  (public.lista_fria_importar((SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 200) ->> 'importados')::int, 2,
  'IM2: importa só os 2 selecionados e novos (p5 desmarcado, p2 já é lead)');

SELECT is((SELECT count(*)::int FROM public.leads
            WHERE organization_id = '11f0a000-0000-4000-8000-00000000000a' AND lista_fria_busca_id IS NOT NULL), 2,
  'IM3: viraram 2 leads marcados da Lista fria');
SELECT is((SELECT count(*)::int FROM public.leads
            WHERE lista_fria_busca_id IS NOT NULL AND excluded_from_metrics), 2,
  'IM4: ficam fora das métricas');
SELECT is((SELECT count(*)::int FROM public.pipeline_entries pe
            JOIN public.leads l ON l.id = pe.lead_id WHERE l.lista_fria_busca_id IS NOT NULL), 0,
  'IM5: nenhum card em funil');
SELECT is((SELECT count(*)::int FROM public.webhook_deliveries
            WHERE webhook_id = '11f0a000-0000-4000-8000-0000000002a1'), 0,
  'IM6: lead frio não gera webhook lead.created');
SELECT is((SELECT origin FROM public.leads WHERE lista_fria_busca_id IS NOT NULL ORDER BY created_at LIMIT 1), 'lista_fria',
  'IM7: origem Lista fria');

SELECT is(
  (public.lista_fria_importar((SELECT id FROM public.lista_fria_buscas WHERE worker_id = 'w1'), 200) ->> 'importados')::int, 0,
  'IM8: importar de novo não duplica');

-- ===========================================================================
-- (GD) a marca só muda pela RPC
-- ===========================================================================
SELECT throws_ok(
  $$UPDATE public.leads SET lista_fria_busca_id = NULL
     WHERE organization_id = '11f0a000-0000-4000-8000-00000000000a' AND lista_fria_busca_id IS NOT NULL$$,
  '42501', NULL, 'GD1: o usuário não tira um lead da seção pela API');
SELECT throws_ok(
  $$UPDATE public.leads SET lista_fria_busca_id = (SELECT id FROM public.lista_fria_buscas LIMIT 1)
     WHERE id = '11f0a000-0000-4000-8000-0000000003a1'$$,
  '42501', NULL, 'GD2: o usuário não empurra um lead comum para a seção');

SELECT * FROM finish();
ROLLBACK;
