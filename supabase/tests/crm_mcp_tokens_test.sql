-- supabase/tests/crm_mcp_tokens_test.sql
--
-- crm-mcp v1 (migrations 20280124013100_crm_mcp_tokens.sql e
-- 20280124013200_crm_mcp_lifecycle.sql), no banco REAL:
--
--   (GR) grants: anon sem nada, hash ilegível, resolver só pelo papel dedicado
--   (IN) emissão: só o dono, só membro de org liberada, nunca master/admin-por-outro
--   (RL) visibilidade: dono, admin da org e master; vizinho não
--   (UP) revogação: mão única, motivo carimbado por quem revoga, validade imutável
--   (AU) resolver: hermético, veredito por fato, recusas registradas, multi-org
--   (RT) limite de uso: estoura o do token sem queimar o da org
--   (LC) ciclo de vida: desligar revoga, faxina revoga sem uso e limpa contadores
--
-- Personas: a1 admin de A · a2 membro de A · a3 membro de A (será desligada) ·
-- b1 admin de B (flag desligada) · m1 master que também é membro de A ·
-- u2 membro de A e de C (multi-org; A é a org MAIS ANTIGA dele).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

-- ===========================================================================
-- Fixtures
-- ===========================================================================
SET LOCAL session_replication_role = replica;

INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('3c0e0000-0000-4000-8000-00000000000a', 'Org MCP A', 'org-mcp-a', 'America/Sao_Paulo'),
  ('3c0e0000-0000-4000-8000-00000000000b', 'Org MCP B', 'org-mcp-b', 'America/Sao_Paulo'),
  ('3c0e0000-0000-4000-8000-00000000000c', 'Org MCP C', 'org-mcp-c', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) || '{"crm_mcp": true}'::jsonb
 WHERE id IN ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-00000000000c');

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
    ('3c0e0000-0000-4000-8000-0000000000a1', 'mcp-admin-a@test.local'),
    ('3c0e0000-0000-4000-8000-0000000000a2', 'mcp-membro-a@test.local'),
    ('3c0e0000-0000-4000-8000-0000000000a3', 'mcp-sai-a@test.local'),
    ('3c0e0000-0000-4000-8000-0000000000b1', 'mcp-admin-b@test.local'),
    ('3c0e0000-0000-4000-8000-0000000000e1', 'mcp-master@test.local'),
    ('3c0e0000-0000-4000-8000-0000000000f2', 'mcp-multi@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active, created_at) VALUES
  ('3c0e0000-0000-4000-8000-0000000001a1', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a1', 'Admin A',   'admin',  true, now()),
  ('3c0e0000-0000-4000-8000-0000000001a2', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Membro A',  'member', true, now()),
  ('3c0e0000-0000-4000-8000-0000000001a3', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a3', 'Sai A',     'member', true, now()),
  ('3c0e0000-0000-4000-8000-0000000001b1', '3c0e0000-0000-4000-8000-00000000000b', '3c0e0000-0000-4000-8000-0000000000b1', 'Admin B',   'admin',  true, now()),
  ('3c0e0000-0000-4000-8000-0000000001e1', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000e1', 'Master A',  'admin',  true, now()),
  ('3c0e0000-0000-4000-8000-0000000001f2', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000f2', 'Multi A',   'member', true, now() - interval '1 year'),
  ('3c0e0000-0000-4000-8000-0000000002f2', '3c0e0000-0000-4000-8000-00000000000c', '3c0e0000-0000-4000-8000-0000000000f2', 'Multi C',   'member', true, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_users (user_id, is_active)
VALUES ('3c0e0000-0000-4000-8000-0000000000e1', true);

SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

CREATE FUNCTION pg_temp.h(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- O teste executa o resolver como o papel dele. postgres tem ADMIN no papel
-- (criou), então pode se dar a pertença dentro desta transação.
GRANT crm_mcp_resolver TO postgres;

-- ===========================================================================
-- (GR) Grants
-- ===========================================================================
SELECT ok(NOT has_table_privilege('anon', 'public.personal_access_tokens', 'SELECT'),
  'GR1 anon não lê tokens');
SELECT ok(NOT has_column_privilege('authenticated', 'public.personal_access_tokens', 'token_hash', 'SELECT'),
  'GR2 o hash não é legível pelo navegador');
SELECT ok(NOT has_column_privilege('authenticated', 'public.personal_access_tokens', 'expires_at', 'UPDATE'),
  'GR3 validade não se altera pelo navegador');
SELECT ok(NOT has_table_privilege('authenticated', 'public.personal_access_tokens', 'DELETE'),
  'GR4 ninguém apaga token pelo navegador (revoga)');
SELECT ok(NOT has_function_privilege('anon', 'public.crm_mcp_authenticate(text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.crm_mcp_authenticate(text)', 'EXECUTE'),
  'GR5 o resolver não é alcançável por anon nem authenticated');
SELECT ok(has_function_privilege('crm_mcp_resolver', 'public.crm_mcp_authenticate(text)', 'EXECUTE'),
  'GR6 o papel do resolver executa o resolver');
SELECT ok(NOT has_function_privilege('authenticated', 'public.crm_mcp_principal_check(uuid,uuid)', 'EXECUTE'),
  'GR7 principal_check (responde sobre qualquer usuário) fechada ao navegador');
SELECT ok(pg_has_role('authenticator', 'crm_mcp_resolver', 'MEMBER'),
  'GR8 o PostgREST consegue assumir o papel do resolver');
SELECT ok((SELECT NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname = 'crm_mcp_resolver'),
  'GR9 crm_mcp_resolver: sem login, sem BYPASSRLS, sem superusuário');
SELECT ok(NOT has_table_privilege('crm_mcp_resolver', 'public.leads', 'SELECT'),
  'GR10 o papel do resolver não lê dado de cliente');
SELECT ok(NOT has_table_privilege('authenticated', 'public.crm_mcp_rate_counters', 'SELECT'),
  'GR11 contadores de limite fechados ao navegador');

-- ===========================================================================
-- (IN) Emissão
-- ===========================================================================
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;

SELECT lives_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Claude do Membro',
          pg_temp.h('tok-a2-1'), 'tq_mcp_test_AAAAAAAA', now() + interval '90 days', '3c0e0000-0000-4000-8000-0000000000a2')
$$, 'IN1 membro de org liberada emite o próprio token');

SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a1', 'Em nome do admin',
          pg_temp.h('tok-x1'), 'tq_mcp_test_AAAAAAAA', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000a2')
$$, '42501', NULL, 'IN2 ninguém emite token com user_id alheio');

SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000b', '3c0e0000-0000-4000-8000-0000000000a2', 'Org alheia',
          pg_temp.h('tok-x2'), 'tq_mcp_test_AAAAAAAA', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000a2')
$$, '42501', NULL, 'IN3 não emite em org da qual não é membro');

SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Escrita',
          pg_temp.h('tok-x3'), 'tq_mcp_test_AAAAAAAA', ARRAY['read','write'], now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000a2')
$$, '42501', NULL, 'IN4 escopo fora do permitido (aqui: org sem crm_mcp_write) é recusado na emissão');

SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Eterno',
          pg_temp.h('tok-x4'), 'tq_mcp_test_AAAAAAAA', now() + interval '400 days', '3c0e0000-0000-4000-8000-0000000000a2')
$$, '23514', NULL, 'IN5 validade acima de 366 dias recusada');

SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by, created_at)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Futuro',
          pg_temp.h('tok-x5'), 'tq_mcp_test_AAAAAAAA', now() + interval '700 days', '3c0e0000-0000-4000-8000-0000000000a2', now() + interval '400 days')
$$, '42501', NULL, 'IN6 created_at não é gravável (não estica a janela)');

RESET ROLE;
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Admin pelo membro',
          pg_temp.h('tok-x6'), 'tq_mcp_test_AAAAAAAA', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000a1')
$$, '42501', NULL, 'IN7 admin NÃO emite token por um membro (seria virar o membro)');

RESET ROLE;
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000b', '3c0e0000-0000-4000-8000-0000000000b1', 'Flag desligada',
          pg_temp.h('tok-x7'), 'tq_mcp_test_AAAAAAAA', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000b1')
$$, '42501', NULL, 'IN8 org sem a flag crm_mcp não emite');
SELECT is(public.crm_mcp_issue_check('3c0e0000-0000-4000-8000-00000000000b'), 'org_disabled',
  'IN9 issue_check explica o motivo (org_disabled)');

RESET ROLE;
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000e1', 'Master',
          pg_temp.h('tok-x8'), 'tq_mcp_test_AAAAAAAA', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000e1')
$$, '42501', NULL, 'IN10 master não emite, mesmo sendo membro da org');
SELECT is(public.crm_mcp_issue_check('3c0e0000-0000-4000-8000-00000000000a'), 'master_principal',
  'IN11 issue_check: master_principal');

RESET ROLE;
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000c', '3c0e0000-0000-4000-8000-0000000000f2', 'Multi na C',
          pg_temp.h('tok-f2-c'), 'tq_mcp_test_CCCCCCCC', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000f2')
$$, 'IN12 multi-org emite na org que NÃO é a mais antiga');

-- Teto de 10 ativos: já há 0 de a3; cria 10 e o 11º recusa.
RESET ROLE;
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a3');
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
    VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a3', 'Lote ' || i,
            encode(sha256(convert_to('tok-a3-' || i, 'UTF8')), 'hex'), 'tq_mcp_test_DDDDDDDD', now() + interval '30 days',
            '3c0e0000-0000-4000-8000-0000000000a3');
  END LOOP;
END $$;
SELECT throws_ok($$
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by)
  VALUES ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a3', 'Décimo primeiro',
          pg_temp.h('tok-a3-11'), 'tq_mcp_test_DDDDDDDD', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000a3')
$$, 'P0001', NULL, 'IN13 teto de 10 tokens ativos por usuário e org');
RESET ROLE;

-- ===========================================================================
-- (RL) Visibilidade
-- ===========================================================================
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens), 1, 'RL1 dono vê só o próprio token');
RESET ROLE;

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens WHERE organization_id = '3c0e0000-0000-4000-8000-00000000000a'), 11,
  'RL2 admin da org vê todos os tokens da org (1 de a2 + 10 de a3)');
RESET ROLE;

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens WHERE user_id <> '3c0e0000-0000-4000-8000-0000000000f2'), 0,
  'RL3 membro comum não vê token de colega');
RESET ROLE;

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens), 0, 'RL4 admin de outra org não vê nada');
RESET ROLE;

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) FROM public.personal_access_tokens) >= 12, 'RL5 master vê (governança)');
RESET ROLE;

-- ===========================================================================
-- (UP) Revogação
-- ===========================================================================
SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000f2');
SET LOCAL ROLE authenticated;
UPDATE public.personal_access_tokens SET revoked_at = now(), revoked_reason = 'user'
 WHERE organization_id = '3c0e0000-0000-4000-8000-00000000000a';
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens WHERE organization_id = '3c0e0000-0000-4000-8000-00000000000a' AND revoked_at IS NOT NULL), 0,
  'UP1 membro comum não revoga token de colega (RLS, zero linhas)');

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;
UPDATE public.personal_access_tokens SET revoked_at = now() - interval '5 days', revoked_reason = 'offboarding'
 WHERE user_id = '3c0e0000-0000-4000-8000-0000000000a2';
RESET ROLE;
SELECT is((SELECT revoked_reason FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-a2-1')), 'user',
  'UP2 dono não se passa por sistema: motivo vira user');
SELECT ok((SELECT revoked_at > now() - interval '1 minute' FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-a2-1')),
  'UP3 revoked_at é carimbado pelo servidor (não aceita data retroativa)');

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$
  UPDATE public.personal_access_tokens SET revoked_at = NULL, revoked_reason = NULL
   WHERE user_id = '3c0e0000-0000-4000-8000-0000000000a2'
$$, 'P0001', NULL, 'UP4 revogado não volta');
SELECT throws_ok($$
  UPDATE public.personal_access_tokens SET expires_at = now() + interval '300 days'
   WHERE user_id = '3c0e0000-0000-4000-8000-0000000000a2'
$$, '42501', NULL, 'UP5 validade não se altera');
RESET ROLE;

SELECT pg_temp.as_user('3c0e0000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
UPDATE public.personal_access_tokens SET revoked_at = now(), revoked_reason = 'user'
 WHERE user_id = '3c0e0000-0000-4000-8000-0000000000a3' AND name = 'Lote 1';
RESET ROLE;
SELECT is((SELECT revoked_reason FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-a3-1')), 'admin',
  'UP6 admin revoga token do membro e o motivo registra admin');

-- ===========================================================================
-- (AU) Resolver
-- ===========================================================================
-- Fixtures diretas (como dono da tabela): um token válido de a2, um expirado,
-- um de master e um em org sem flag.
SET LOCAL session_replication_role = replica;
INSERT INTO public.personal_access_tokens (id, organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by, created_at) VALUES
  ('3c0e0000-0000-4000-8000-0000000a0001', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Válido',
   pg_temp.h('tok-ok'), 'tq_mcp_test_EEEEEEEE', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000a2', now()),
  ('3c0e0000-0000-4000-8000-0000000a0002', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a2', 'Expirado',
   pg_temp.h('tok-exp'), 'tq_mcp_test_EEEEEEEE', now() - interval '1 day', '3c0e0000-0000-4000-8000-0000000000a2', now() - interval '10 days'),
  ('3c0e0000-0000-4000-8000-0000000a0003', '3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000e1', 'Master',
   pg_temp.h('tok-master'), 'tq_mcp_test_EEEEEEEE', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000e1', now()),
  ('3c0e0000-0000-4000-8000-0000000a0004', '3c0e0000-0000-4000-8000-00000000000b', '3c0e0000-0000-4000-8000-0000000000b1', 'Sem flag',
   pg_temp.h('tok-noflag'), 'tq_mcp_test_EEEEEEEE', now() + interval '30 days', '3c0e0000-0000-4000-8000-0000000000b1', now());
SET LOCAL session_replication_role = origin;

-- O resolver roda como o papel dele; o resultado vai para uma tabela e as
-- asserções saem como postgres (o papel do resolver não enxerga o pgTAP).
CREATE TEMP TABLE _au (caso text, linhas int, outcome text, org uuid, retry int);
GRANT INSERT, SELECT ON _au TO crm_mcp_resolver;

SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _au SELECT 'desconhecido', count(*)::int, NULL, NULL, NULL
  FROM public.crm_mcp_authenticate(encode(sha256('nao-existe'::bytea), 'hex'));
INSERT INTO _au SELECT 'malformado', count(*)::int, NULL, NULL, NULL
  FROM public.crm_mcp_authenticate('nao-e-hex');
INSERT INTO _au SELECT 'ok', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-ok'::bytea), 'hex'));
INSERT INTO _au SELECT 'revogado', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-a2-1'::bytea), 'hex'));
INSERT INTO _au SELECT 'expirado', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-exp'::bytea), 'hex'));
INSERT INTO _au SELECT 'master', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-master'::bytea), 'hex'));
INSERT INTO _au SELECT 'sem-flag', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-noflag'::bytea), 'hex'));
INSERT INTO _au SELECT 'multi-c', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-f2-c'::bytea), 'hex'));
RESET ROLE;

SELECT is((SELECT linhas FROM _au WHERE caso = 'desconhecido'), 0, 'AU1 hash desconhecido: nenhuma linha (não é oráculo)');
SELECT is((SELECT linhas FROM _au WHERE caso = 'malformado'), 0, 'AU2 hash malformado: nenhuma linha');
SELECT is((SELECT outcome FROM _au WHERE caso = 'ok'), 'ok', 'AU3 token válido: ok');
SELECT is((SELECT outcome FROM _au WHERE caso = 'revogado'), 'revoked', 'AU4 revogado');
SELECT is((SELECT outcome FROM _au WHERE caso = 'expirado'), 'expired', 'AU5 expirado');
SELECT is((SELECT outcome FROM _au WHERE caso = 'master'), 'master_principal',
  'AU6 token de master recusado (o endpoint de cliente nunca vira leitor cross-org)');
SELECT is((SELECT outcome FROM _au WHERE caso = 'sem-flag'), 'org_disabled', 'AU7 org sem flag: recusado');
SELECT is((SELECT outcome FROM _au WHERE caso = 'multi-c'), 'ok', 'AU8 multi-org: token da org C vale (a mais antiga é A)');
SELECT is((SELECT org FROM _au WHERE caso = 'multi-c'), '3c0e0000-0000-4000-8000-00000000000c'::uuid,
  'AU9 o resolver devolve a org DO TOKEN');

SELECT ok((SELECT last_used_at IS NOT NULL FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-ok')),
  'AU10 uso ok carimba last_used_at');
SELECT is((SELECT sum(hits)::int FROM public.crm_mcp_auth_denials
            WHERE pat_id = (SELECT id FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-a2-1'))), 1,
  'AU11 uso de token revogado fica registrado (sinal de vazamento)');

-- Membro saiu da org sem passar pelo gatilho: a autenticação ainda recusa,
-- porque relê a pertença a cada requisição.
SET LOCAL session_replication_role = replica;
UPDATE public.team_members SET is_active = false WHERE id = '3c0e0000-0000-4000-8000-0000000001a2';
SET LOCAL session_replication_role = origin;
SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _au SELECT 'saiu', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-ok'::bytea), 'hex'));
RESET ROLE;
SELECT is((SELECT outcome FROM _au WHERE caso = 'saiu'), 'not_member', 'AU12 pertença relida a cada requisição');
SET LOCAL session_replication_role = replica;
UPDATE public.team_members SET is_active = true WHERE id = '3c0e0000-0000-4000-8000-0000000001a2';
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- (RT) Limite de uso
-- ===========================================================================
-- now() é o instante da transação, então todo o teste cai na mesma janela de
-- minuto. O token válido já passou 1 vez (AU3); força o balde dele a 120.
UPDATE public.crm_mcp_rate_counters SET hits = 120
 WHERE scope = 'token_minute' AND subject_id = '3c0e0000-0000-4000-8000-0000000a0001'
   AND window_start = date_trunc('minute', now());

SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _au SELECT 'estourou', 1, outcome, organization_id, retry_after_seconds
  FROM public.crm_mcp_authenticate(encode(sha256('tok-ok'::bytea), 'hex'));
RESET ROLE;
SELECT is((SELECT outcome FROM _au WHERE caso = 'estourou'), 'rate_limited', 'RT1 121ª chamada no minuto: rate_limited');
SELECT ok((SELECT retry BETWEEN 1 AND 60 FROM _au WHERE caso = 'estourou'), 'RT2 Retry-After dentro do minuto');
-- Na org A só o AU3 passou como ok neste minuto (o AU12 foi recusa).
SELECT is((SELECT hits FROM public.crm_mcp_rate_counters
            WHERE scope = 'org_minute' AND subject_id = '3c0e0000-0000-4000-8000-00000000000a'
              AND window_start = date_trunc('minute', now())),
          1, 'RT3 token estourado não consome o balde da org');
SELECT is((SELECT sum(hits)::int FROM public.crm_mcp_auth_denials
            WHERE pat_id = '3c0e0000-0000-4000-8000-0000000a0001' AND reason = 'rate_limited'), 1,
  'RT4 estouro registrado nas recusas');

-- ===========================================================================
-- (LC) Ciclo de vida
-- ===========================================================================
-- Desligar como o sistema faria (a função de gatilho é DEFINER; quem desativa
-- não precisa de grant nos tokens).
UPDATE public.team_members SET is_active = false WHERE id = '3c0e0000-0000-4000-8000-0000000001a3';
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens
            WHERE user_id = '3c0e0000-0000-4000-8000-0000000000a3' AND revoked_at IS NULL), 0,
  'LC1 desligar o membro revoga todos os tokens dele na org');
SELECT is((SELECT count(*)::int FROM public.personal_access_tokens
            WHERE user_id = '3c0e0000-0000-4000-8000-0000000000a3' AND revoked_reason = 'offboarding'), 9,
  'LC2 motivo offboarding (o 1º já fora revogado pelo admin e mantém admin)');

DELETE FROM public.team_members WHERE id = '3c0e0000-0000-4000-8000-0000000002f2';
SELECT is((SELECT revoked_reason FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-f2-c')), 'offboarding',
  'LC3 apagar a linha de membro também revoga');

SET LOCAL session_replication_role = replica;
INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, expires_at, created_by, created_at) VALUES
  ('3c0e0000-0000-4000-8000-00000000000a', '3c0e0000-0000-4000-8000-0000000000a1', 'Esquecido',
   pg_temp.h('tok-velho'), 'tq_mcp_test_FFFFFFFF', now() + interval '200 days', '3c0e0000-0000-4000-8000-0000000000a1', now() - interval '100 days');
INSERT INTO public.crm_mcp_rate_counters (scope, subject_id, window_start, hits)
VALUES ('org_day', '3c0e0000-0000-4000-8000-00000000000a', date_trunc('day', now()) - interval '5 days', 7);
SET LOCAL session_replication_role = origin;

SELECT ok((public.crm_mcp_housekeeping() ->> 'revogados_sem_uso')::int >= 1, 'LC4 faxina roda');
SELECT is((SELECT revoked_reason FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-velho')), 'auto_unused',
  'LC5 sem uso há 90 dias: revogado (auto_unused)');
SELECT is((SELECT revoked_at FROM public.personal_access_tokens WHERE token_hash = pg_temp.h('tok-ok')), NULL::timestamptz,
  'LC6 token em uso sobrevive à faxina');
SELECT is((SELECT count(*)::int FROM public.crm_mcp_rate_counters WHERE window_start < now() - interval '2 days'), 0,
  'LC7 contadores velhos apagados');
SELECT ok((SELECT count(*) = 1 FROM cron.job WHERE jobname = 'crm-mcp-housekeeping'), 'LC8 faxina agendada no pg_cron');

SELECT * FROM finish();
ROLLBACK;
