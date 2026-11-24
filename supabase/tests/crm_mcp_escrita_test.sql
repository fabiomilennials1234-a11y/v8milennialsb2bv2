-- supabase/tests/crm_mcp_escrita_test.sql
--
-- crm-mcp v2 — fundação de escrita (20280124013300_crm_mcp_escrita.sql), no banco REAL:
--
--   (SC) escopos na emissão: só o que a pessoa já pode no app, só com a flag crm_mcp_write
--   (AC) ações: plano de uso único, só o mesmo token confirma, validade, revalidação
--   (AU) auditoria: navegador lê o que deve e não escreve nada
--
-- Personas: a1 admin de A · a2 membro de A · a3 membro de A sem pipeline.move_cards ·
-- b1 admin de B (sem crm_mcp_write).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug, timezone, feature_flags) VALUES
  ('5e5c0000-0000-4000-8000-00000000000a', 'Org Escrita A', 'org-escrita-a', 'America/Sao_Paulo', '{"crm_mcp": true, "crm_mcp_write": true}'),
  ('5e5c0000-0000-4000-8000-00000000000b', 'Org Escrita B', 'org-escrita-b', 'America/Sao_Paulo', '{"crm_mcp": true}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at,
  instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
  reauthentication_token, phone_change_token, email_change, phone_change)
SELECT u.id::uuid, u.email, '', now(), '{}'::jsonb, now(), now(), '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', '', '', '', '', '', '', '', ''
  FROM (VALUES
    ('5e5c0000-0000-4000-8000-0000000000a1', 'esc-a1@test.local'),
    ('5e5c0000-0000-4000-8000-0000000000a2', 'esc-a2@test.local'),
    ('5e5c0000-0000-4000-8000-0000000000a3', 'esc-a3@test.local'),
    ('5e5c0000-0000-4000-8000-0000000000b1', 'esc-b1@test.local')
  ) AS u(id, email)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active) VALUES
  ('5e5c0000-0000-4000-8000-0000000001a1', '5e5c0000-0000-4000-8000-00000000000a', '5e5c0000-0000-4000-8000-0000000000a1', 'Admin A', 'admin', true),
  ('5e5c0000-0000-4000-8000-0000000001a2', '5e5c0000-0000-4000-8000-00000000000a', '5e5c0000-0000-4000-8000-0000000000a2', 'Membro A', 'member', true),
  ('5e5c0000-0000-4000-8000-0000000001a3', '5e5c0000-0000-4000-8000-00000000000a', '5e5c0000-0000-4000-8000-0000000000a3', 'Sem mover', 'member', true),
  ('5e5c0000-0000-4000-8000-0000000001b1', '5e5c0000-0000-4000-8000-00000000000b', '5e5c0000-0000-4000-8000-0000000000b1', 'Admin B', 'admin', true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled) VALUES
  ('5e5c0000-0000-4000-8000-0000000001a3', '5e5c0000-0000-4000-8000-00000000000a', 'pipeline.move_cards', false);
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;
CREATE FUNCTION pg_temp.h(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;
CREATE FUNCTION pg_temp.emite(p_user uuid, p_org uuid, p_tok text, p_scopes text[]) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(p_user);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.personal_access_tokens (organization_id, user_id, name, token_hash, token_prefix, scopes, expires_at, created_by)
  VALUES (p_org, p_user, 'T ' || p_tok, pg_temp.h(p_tok), 'tq_mcp_test_ESCRITA0', p_scopes, now() + interval '30 days', p_user);
  EXECUTE 'RESET ROLE';
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN SQLSTATE;
END $$;

GRANT crm_mcp_resolver TO postgres;

-- ===========================================================================
-- (SC) Escopos na emissão
-- ===========================================================================
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000a2', '5e5c0000-0000-4000-8000-00000000000a', 'a2-crm', ARRAY['read','crm:write']), 'ok',
  'SC1 membro com pipeline.move_cards emite crm:write');
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000a2', '5e5c0000-0000-4000-8000-00000000000a', 'a2-msg', ARRAY['read','messages:send']), '42501',
  'SC2 membro NÃO emite messages:send (só admin)');
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000a1', '5e5c0000-0000-4000-8000-00000000000a', 'a1-all', ARRAY['read','crm:write','messages:send','automations:write']), 'ok',
  'SC3 admin emite todos os escopos');
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000a3', '5e5c0000-0000-4000-8000-00000000000a', 'a3-crm', ARRAY['read','crm:write']), '42501',
  'SC4 membro sem pipeline.move_cards NÃO emite crm:write');
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000a3', '5e5c0000-0000-4000-8000-00000000000a', 'a3-read', ARRAY['read']), 'ok',
  'SC5 e continua emitindo só leitura');
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000b1', '5e5c0000-0000-4000-8000-00000000000b', 'b1-crm', ARRAY['read','crm:write']), '42501',
  'SC6 org sem a flag crm_mcp_write não emite escrita, nem para admin');
SELECT is(pg_temp.emite('5e5c0000-0000-4000-8000-0000000000a1', '5e5c0000-0000-4000-8000-00000000000a', 'a1-sem-read', ARRAY['crm:write']), '23514',
  'SC7 todo token inclui read');

SELECT pg_temp.as_user('5e5c0000-0000-4000-8000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT is(public.crm_mcp_issue_check('5e5c0000-0000-4000-8000-00000000000a', ARRAY['read','messages:send']),
  'scope_admin_only:messages:send', 'SC8 issue_check explica o escopo recusado');
RESET ROLE;

-- ===========================================================================
-- (AC) Ações
-- ===========================================================================
CREATE TEMP TABLE _ac (caso text, v text);
GRANT INSERT, SELECT ON _ac TO crm_mcp_resolver;

SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _ac SELECT 'aberta', action_id::text
  FROM public.crm_mcp_action_open(encode(sha256('a2-crm'::bytea), 'hex'), 'deal.move', 'crm:write', 'Mover 2 cards', '{"moves":[1,2]}');
RESET ROLE;

SELECT ok((SELECT v IS NOT NULL FROM _ac WHERE caso = 'aberta'), 'AC1 token com crm:write abre plano');

-- token só leitura não abre plano de escrita
CREATE FUNCTION pg_temp.abre(p_tok text, p_scope text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE crm_mcp_resolver';
  PERFORM * FROM public.crm_mcp_action_open(encode(sha256(convert_to(p_tok, 'UTF8')), 'hex'), 'deal.move', p_scope, 's', '{}');
  EXECUTE 'RESET ROLE';
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN SQLSTATE;
END $$;
SELECT is(pg_temp.abre('a3-read', 'crm:write'), '42501', 'AC2 token só leitura não abre plano de escrita');
SELECT is(pg_temp.abre('nao-existe', 'crm:write'), '28000', 'AC3 token desconhecido não abre plano');

SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _ac SELECT 'outro_token', count(*)::text
  FROM public.crm_mcp_action_take(encode(sha256('a1-all'::bytea), 'hex'), (SELECT v::uuid FROM _ac WHERE caso = 'aberta'));
INSERT INTO _ac SELECT 'take1', count(*)::text
  FROM public.crm_mcp_action_take(encode(sha256('a2-crm'::bytea), 'hex'), (SELECT v::uuid FROM _ac WHERE caso = 'aberta'));
INSERT INTO _ac SELECT 'take2', count(*)::text
  FROM public.crm_mcp_action_take(encode(sha256('a2-crm'::bytea), 'hex'), (SELECT v::uuid FROM _ac WHERE caso = 'aberta'));
INSERT INTO _ac SELECT 'finish', public.crm_mcp_action_finish(encode(sha256('a2-crm'::bytea), 'hex'),
  (SELECT v::uuid FROM _ac WHERE caso = 'aberta'), 'applied', '{"moved":2}')::text;
INSERT INTO _ac SELECT 'get_applied', count(*)::text
  FROM public.crm_mcp_action_get_applied(encode(sha256('a2-crm'::bytea), 'hex'), (SELECT v::uuid FROM _ac WHERE caso = 'aberta'));
INSERT INTO _ac SELECT 'undone', public.crm_mcp_action_mark_undone(encode(sha256('a2-crm'::bytea), 'hex'),
  (SELECT v::uuid FROM _ac WHERE caso = 'aberta'))::text;
INSERT INTO _ac SELECT 'undone2', public.crm_mcp_action_mark_undone(encode(sha256('a2-crm'::bytea), 'hex'),
  (SELECT v::uuid FROM _ac WHERE caso = 'aberta'))::text;
RESET ROLE;

SELECT is((SELECT v FROM _ac WHERE caso = 'outro_token'), '0', 'AC4 outro token (mesmo admin da org) NÃO confirma o plano');
SELECT is((SELECT v FROM _ac WHERE caso = 'take1'), '1', 'AC5 o mesmo token confirma');
SELECT is((SELECT v FROM _ac WHERE caso = 'take2'), '0', 'AC6 uso único: a segunda confirmação não devolve nada');
SELECT is((SELECT v FROM _ac WHERE caso = 'finish'), 'true', 'AC7 resultado registrado');
SELECT is((SELECT v FROM _ac WHERE caso = 'get_applied'), '1', 'AC8 ação aplicada legível para desfazer');
SELECT is((SELECT v FROM _ac WHERE caso = 'undone'), 'true', 'AC9 desfazer marca a ação');
SELECT is((SELECT v FROM _ac WHERE caso = 'undone2'), 'false', 'AC10 e não desfaz duas vezes');

-- validade: plano vencido não confirma
SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _ac SELECT 'velho', action_id::text
  FROM public.crm_mcp_action_open(encode(sha256('a2-crm'::bytea), 'hex'), 'deal.move', 'crm:write', 'Velho', '{}');
RESET ROLE;
UPDATE public.crm_mcp_actions SET expires_at = now() - interval '1 second' WHERE id = (SELECT v::uuid FROM _ac WHERE caso = 'velho');
SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _ac SELECT 'take_velho', count(*)::text
  FROM public.crm_mcp_action_take(encode(sha256('a2-crm'::bytea), 'hex'), (SELECT v::uuid FROM _ac WHERE caso = 'velho'));
RESET ROLE;
SELECT is((SELECT v FROM _ac WHERE caso = 'take_velho'), '0', 'AC11 plano vencido (5 min) não confirma');

-- revalidação: permissão tirada DEPOIS do plano → não confirma
SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _ac SELECT 'antes_de_tirar', action_id::text
  FROM public.crm_mcp_action_open(encode(sha256('a2-crm'::bytea), 'hex'), 'deal.move', 'crm:write', 'Antes', '{}');
RESET ROLE;
INSERT INTO public.member_feature_permissions (team_member_id, organization_id, feature_key, enabled)
VALUES ('5e5c0000-0000-4000-8000-0000000001a2', '5e5c0000-0000-4000-8000-00000000000a', 'pipeline.move_cards', false);
SET LOCAL ROLE crm_mcp_resolver;
INSERT INTO _ac SELECT 'depois_de_tirar', count(*)::text
  FROM public.crm_mcp_action_take(encode(sha256('a2-crm'::bytea), 'hex'), (SELECT v::uuid FROM _ac WHERE caso = 'antes_de_tirar'));
RESET ROLE;
SELECT is((SELECT v FROM _ac WHERE caso = 'depois_de_tirar'), '0',
  'AC12 permissão retirada depois do plano: a confirmação é recusada');
DELETE FROM public.member_feature_permissions WHERE team_member_id = '5e5c0000-0000-4000-8000-0000000001a2' AND feature_key = 'pipeline.move_cards';

-- flag de escrita desligada → nada abre
UPDATE public.organizations SET feature_flags = feature_flags || '{"crm_mcp_write": false}' WHERE id = '5e5c0000-0000-4000-8000-00000000000a';
SELECT is(pg_temp.abre('a2-crm', 'crm:write'), '42501', 'AC13 flag crm_mcp_write desligada corta a escrita na hora');
UPDATE public.organizations SET feature_flags = feature_flags || '{"crm_mcp_write": true}' WHERE id = '5e5c0000-0000-4000-8000-00000000000a';

-- ===========================================================================
-- (AU) Auditoria
-- ===========================================================================
SELECT ok(NOT has_function_privilege('authenticated', 'public.crm_mcp_action_open(text,text,text,text,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.crm_mcp_action_open(text,text,text,text,jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.crm_mcp_action_finish(text,uuid,text,jsonb)', 'EXECUTE'),
  'AU1 navegador não chama as funções de ação');
SELECT ok(NOT has_table_privilege('authenticated', 'public.crm_mcp_actions', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.crm_mcp_actions', 'UPDATE'),
  'AU2 navegador não escreve na trilha (não forja registro)');

SELECT pg_temp.as_user('5e5c0000-0000-4000-8000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) >= 3 FROM public.crm_mcp_actions WHERE organization_id = '5e5c0000-0000-4000-8000-00000000000a'),
  'AU3 admin da org vê as ações da equipe');
RESET ROLE;
SELECT pg_temp.as_user('5e5c0000-0000-4000-8000-0000000000a3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.crm_mcp_actions), 0, 'AU4 membro não vê ação de colega');
RESET ROLE;
SELECT pg_temp.as_user('5e5c0000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.crm_mcp_actions), 0, 'AU5 admin de outra org não vê nada');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
