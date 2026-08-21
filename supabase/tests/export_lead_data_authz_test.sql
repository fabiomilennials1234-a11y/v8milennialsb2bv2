-- supabase/tests/export_lead_data_authz_test.sql
--
-- SCRUM-326 — quem pode exportar o lead, e quem não pode mais.
--
-- O cartão nomeava o grant de `anon`. Medido em prod, o grant estava lá pelos
-- DOIS caminhos (PUBLIC implícito + nominal), mas anon nunca extraiu nada: o
-- corpo resolve `auth.uid()`, que para anon é NULL. O dano real era outro, e é
-- o que os blocos (AT) e (XO) abaixo travam:
--
--   (GR) os grants: anon FORA pelos dois caminhos; `authenticated` DENTRO,
--        porque `useExportLeadData` chama do navegador do admin logado.
--        Revogar authenticated "para seguir a rubric" apagaria a exportação.
--   (AT) admin DESATIVADO não exporta. Eram 15 em prod, todos podendo ler
--        lead, conversas, mensagens e consentimentos da carteira que
--        administravam. É o motivo desta migration.
--   (XO) admin de OUTRA org não exporta — o escopo é da org DO LEAD.
--   (MO) admin de DUAS orgs exporta das DUAS. Antes o `LIMIT 1` sorteava uma e
--        a outra devolvia NULL calado, que na tela vira "lead não existe".
--   (CP) o corpo continua usando a helper ESTREITA. Trocar por
--        get_my_admin_organization_ids() alargaria para gestor de portfólio
--        sem que o diff parecesse errado.
--
-- Roda inteiro em transação revertida — não muta o banco.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;
SET LOCAL session_replication_role = replica;

-- ===========================================================================
-- Fixtures: duas orgs, quatro papéis
-- ===========================================================================
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('32600000-0000-4000-8000-00000000000a', 'Org EX A', 'org-ex-a', 'America/Sao_Paulo'),
  ('32600000-0000-4000-8000-00000000000b', 'Org EX B', 'org-ex-b', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, raw_user_meta_data,
  created_at, updated_at, instance_id, aud, role,
  confirmation_token, recovery_token, email_change_token_new,
  email_change_token_current, reauthentication_token, phone_change_token,
  email_change, phone_change
) VALUES
  ('3260115e-0000-4000-8000-000000000001', 'admin-ativo@test.local',   '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', ''),
  ('3260115e-0000-4000-8000-000000000002', 'admin-inativo@test.local', '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', ''),
  ('3260115e-0000-4000-8000-000000000003', 'admin-org-b@test.local',   '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', ''),
  ('3260115e-0000-4000-8000-000000000004', 'admin-multi@test.local',   '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- 'member'/'admin' são do enum app_role. `membro` estoura 22P02.
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('32601ea9-0000-4000-8000-000000000001', '32600000-0000-4000-8000-00000000000a', '3260115e-0000-4000-8000-000000000001', 'Admin Ativo A',   'admin', true),
  -- O PERSONAGEM DESTA MIGRATION: admin de verdade, desativado, login vivo.
  ('32601ea9-0000-4000-8000-000000000002', '32600000-0000-4000-8000-00000000000a', '3260115e-0000-4000-8000-000000000002', 'Admin Inativo A', 'admin', false),
  ('32601ea9-0000-4000-8000-000000000003', '32600000-0000-4000-8000-00000000000b', '3260115e-0000-4000-8000-000000000003', 'Admin B',         'admin', true),
  -- Admin das DUAS orgs — o caso que o LIMIT 1 quebrava.
  ('32601ea9-0000-4000-8000-000000000041', '32600000-0000-4000-8000-00000000000a', '3260115e-0000-4000-8000-000000000004', 'Admin Multi A',   'admin', true),
  ('32601ea9-0000-4000-8000-000000000042', '32600000-0000-4000-8000-00000000000b', '3260115e-0000-4000-8000-000000000004', 'Admin Multi B',   'admin', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.leads (id, organization_id, name, origin, created_at) VALUES
  ('3260ead1-0000-4000-8000-00000000000a', '32600000-0000-4000-8000-00000000000a', 'Lead da org A', 'meta_ads', now()),
  ('3260ead1-0000-4000-8000-00000000000b', '32600000-0000-4000-8000-00000000000b', 'Lead da org B', 'meta_ads', now())
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- (GR) Os grants
-- ===========================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'public.export_lead_data(uuid)'::regprocedure, 'EXECUTE'),
  'GR1: anon NÃO executa — e tinha grant pelos DOIS caminhos, PUBLIC e nominal');

SELECT ok(
  has_function_privilege('authenticated', 'public.export_lead_data(uuid)'::regprocedure, 'EXECUTE'),
  'GR2: authenticated CONTINUA executando — useExportLeadData chama do navegador do admin');

SELECT ok(
  has_function_privilege('service_role', 'public.export_lead_data(uuid)'::regprocedure, 'EXECUTE'),
  'GR3: service_role executa');

-- ===========================================================================
-- (CP) O corpo
-- ===========================================================================
SELECT ok(
  (SELECT position('get_my_team_admin_organization_ids' IN p.prosrc) > 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'export_lead_data'),
  'CP1: usa a helper ESTREITA (role admin + is_active), não a que inclui gestor de portfólio');

SELECT ok(
  (SELECT position('LIMIT 1' IN p.prosrc) = 0
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'export_lead_data'),
  'CP2: o LIMIT 1 que sorteava a org NÃO voltou');

-- ===========================================================================
-- (AT) Admin ativo exporta; admin DESATIVADO não
-- ===========================================================================
SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"3260115e-0000-4000-8000-000000000001","role":"authenticated"}', true);

SELECT isnt(
  public.export_lead_data('3260ead1-0000-4000-8000-00000000000a'), NULL,
  'AT1: admin ATIVO da org do lead exporta');

SELECT is(
  public.export_lead_data('3260ead1-0000-4000-8000-00000000000a') #>> '{lead,name}',
  'Lead da org A', 'AT2: e o que volta é o lead certo');

SELECT set_config('request.jwt.claims',
  '{"sub":"3260115e-0000-4000-8000-000000000002","role":"authenticated"}', true);

SELECT throws_ok($$
  SELECT public.export_lead_data('3260ead1-0000-4000-8000-00000000000a')
$$, 'Unauthorized: admin role required',
  'AT3: admin DESATIVADO é recusado — eram 15 assim em prod, todos exportando PII');

-- ===========================================================================
-- (XO) Admin de outra org
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"3260115e-0000-4000-8000-000000000003","role":"authenticated"}', true);

SELECT throws_ok($$
  SELECT public.export_lead_data('3260ead1-0000-4000-8000-00000000000a')
$$, 'Unauthorized: admin role required',
  'XO1: admin da org B não exporta lead da org A');

SELECT isnt(
  public.export_lead_data('3260ead1-0000-4000-8000-00000000000b'), NULL,
  'XO2: e continua exportando o da própria org');

-- ===========================================================================
-- (MO) Admin de DUAS orgs — o que o LIMIT 1 quebrava
-- ===========================================================================
SELECT set_config('request.jwt.claims',
  '{"sub":"3260115e-0000-4000-8000-000000000004","role":"authenticated"}', true);

SELECT isnt(
  public.export_lead_data('3260ead1-0000-4000-8000-00000000000a'), NULL,
  'MO1: admin das duas orgs exporta o lead da org A');

SELECT isnt(
  public.export_lead_data('3260ead1-0000-4000-8000-00000000000b'), NULL,
  'MO2: E TAMBÉM o da org B — antes uma das duas devolvia NULL em silêncio');

-- ===========================================================================
-- (LD) Lead inexistente não vira oráculo de id
-- ===========================================================================
SELECT throws_ok($$
  SELECT public.export_lead_data('3260ead1-0000-4000-8000-0000000000ff')
$$, 'Unauthorized: admin role required',
  'LD1: id inexistente responde Unauthorized, não "não achei" — não confirma existência');

SELECT * FROM finish();
ROLLBACK;
