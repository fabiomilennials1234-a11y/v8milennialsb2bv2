-- supabase/tests/crm_mcp_rpc_allowlist_test.sql
--
-- O crm-mcp só alcança funções Postgres pela allowlist de supabase/functions/crm-mcp/tools/rpc.ts.
-- Cada entrada declara um portão; este teste prova o portão no banco REAL:
--
--   (DEF) forma: quem é DEFINER, quem é INVOKER, e que o DEFINER começa autorizando
--   (ORG) comportamento: o motor de métricas recusa org alheia e responde pela própria;
--         has_feature_permission responde pela org pedida, não pela "primeira org"
--
-- Personas: a1 membro de A (org mais antiga dele) e de C; nenhuma relação com B.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT no_plan();

SET LOCAL role postgres;

SET LOCAL session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug, timezone) VALUES
  ('4a110000-0000-4000-8000-00000000000a', 'Org RPC A', 'org-rpc-a', 'America/Sao_Paulo'),
  ('4a110000-0000-4000-8000-00000000000b', 'Org RPC B', 'org-rpc-b', 'America/Sao_Paulo'),
  ('4a110000-0000-4000-8000-00000000000c', 'Org RPC C', 'org-rpc-c', 'America/Sao_Paulo')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at,
  instance_id, aud, role, confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
  reauthentication_token, phone_change_token, email_change, phone_change)
VALUES ('4a110000-0000-4000-8000-0000000000a1', 'rpc-a1@test.local', '', now(), '{}'::jsonb, now(), now(),
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.team_members (id, organization_id, user_id, name, role, is_active, created_at) VALUES
  ('4a110000-0000-4000-8000-0000000001a1', '4a110000-0000-4000-8000-00000000000a', '4a110000-0000-4000-8000-0000000000a1', 'A1 em A', 'member', true, now() - interval '1 year'),
  ('4a110000-0000-4000-8000-0000000002a1', '4a110000-0000-4000-8000-00000000000c', '4a110000-0000-4000-8000-0000000000a1', 'A1 em C', 'member', true, now())
ON CONFLICT (id) DO NOTHING;
SET LOCAL session_replication_role = origin;

-- Devolve o SQLSTATE do erro ('ok' se não errou). O resultado vai para uma tabela e as
-- asserções saem como postgres.
CREATE FUNCTION pg_temp.tenta(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- ===========================================================================
-- (DEF) Forma
-- ===========================================================================
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_metric_measure(uuid,jsonb,text,text,date,date,date,jsonb)'::regprocedure),
  'DEF1 fn_metric_measure é DEFINER (por isso precisa de portão)');
SELECT ok((SELECT prosrc ~ 'PERFORM\s+public\.assert_org_access\(p_org_id\)'
             FROM pg_proc WHERE oid = 'public.fn_metric_measure(uuid,jsonb,text,text,date,date,date,jsonb)'::regprocedure),
  'DEF2 fn_metric_measure autoriza o chamador com assert_org_access(p_org_id)');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_metric_catalog()'::regprocedure),
  'DEF3 fn_metric_catalog é INVOKER (roda sob a RLS de quem chama)');
SELECT ok((SELECT prosecdef AND prosrc ~ 'auth\.uid\(\)' FROM pg_proc
            WHERE oid = 'public.has_feature_permission(text,uuid)'::regprocedure),
  'DEF4 has_feature_permission(text, uuid) é DEFINER e responde por auth.uid()');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.mover_negocio(uuid,uuid,text,text,uuid)'::regprocedure),
  'DEF6 mover_negocio é INVOKER (a movimentação roda sob a RLS de quem move)');
SELECT ok((SELECT count(*) > 0 AND bool_and(NOT prosecdef) FROM pg_proc
            WHERE proname = 'get_pipeline_stage_counts_by_id' AND pronamespace = 'public'::regnamespace),
  'DEF7 get_pipeline_stage_counts_by_id é INVOKER (conta os cards sob a RLS de quem pede)');
SELECT ok((SELECT bool_and(has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT has_function_privilege('anon', oid, 'EXECUTE')) FROM pg_proc
            WHERE proname = 'get_pipeline_stage_counts_by_id' AND pronamespace = 'public'::regnamespace),
  'DEF8 get_pipeline_stage_counts_by_id: authenticated executa, anon não');
SELECT ok(has_function_privilege('authenticated', 'public.fn_metric_measure(uuid,jsonb,text,text,date,date,date,jsonb)', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.fn_metric_catalog()', 'EXECUTE')
      AND has_function_privilege('authenticated', 'public.has_feature_permission(text,uuid)', 'EXECUTE'),
  'DEF5 as três estão abertas a authenticated — o app as chama com a mesma sessão');

-- ===========================================================================
-- (ORG) Comportamento como o usuário
-- ===========================================================================
CREATE TEMP TABLE _r (caso text, v text);
GRANT INSERT, SELECT ON _r TO authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub', '4a110000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
INSERT INTO _r VALUES ('medida_org_alheia', pg_temp.tenta(
  $q$SELECT public.fn_metric_measure('4a110000-0000-4000-8000-00000000000b', '{"id":"receita"}'::jsonb, 'total')$q$));
INSERT INTO _r VALUES ('medida_org_propria', pg_temp.tenta(
  $q$SELECT public.fn_metric_measure('4a110000-0000-4000-8000-00000000000a', '{"id":"receita"}'::jsonb, 'total')$q$));
INSERT INTO _r VALUES ('medida_segunda_org', pg_temp.tenta(
  $q$SELECT public.fn_metric_measure('4a110000-0000-4000-8000-00000000000c', '{"id":"leads_criados"}'::jsonb, 'total')$q$));
INSERT INTO _r VALUES ('unidade_receita',
  (public.fn_metric_measure('4a110000-0000-4000-8000-00000000000a', '{"id":"receita"}'::jsonb, 'total'))->>'unit');
INSERT INTO _r VALUES ('perm_org_c', public.has_feature_permission('metrics.view', '4a110000-0000-4000-8000-00000000000c')::text);
INSERT INTO _r VALUES ('perm_org_b', public.has_feature_permission('metrics.view', '4a110000-0000-4000-8000-00000000000b')::text);
INSERT INTO _r VALUES ('catalogo', jsonb_array_length((public.fn_metric_catalog())->'measures')::text);
RESET ROLE;

SELECT isnt((SELECT v FROM _r WHERE caso = 'medida_org_alheia'), 'ok',
  'ORG1 o motor RECUSA medir uma org da qual o usuário não é membro');
SELECT is((SELECT v FROM _r WHERE caso = 'medida_org_propria'), 'ok', 'ORG2 o motor mede a própria org');
SELECT is((SELECT v FROM _r WHERE caso = 'medida_segunda_org'), 'ok',
  'ORG3 e a segunda org de um multi-org (não só a mais antiga)');
SELECT is((SELECT v FROM _r WHERE caso = 'unidade_receita'), 'currency', 'ORG4 receita sai em moeda');
SELECT is((SELECT v FROM _r WHERE caso = 'perm_org_c'), 'true',
  'ORG5 has_feature_permission responde pela org pedida (C, que não é a primeira)');
SELECT is((SELECT v FROM _r WHERE caso = 'perm_org_b'), 'false', 'ORG6 e nega na org alheia');
SELECT ok((SELECT v::int > 0 FROM _r WHERE caso = 'catalogo'), 'ORG7 o catálogo é legível pelo usuário');

SELECT * FROM finish();
ROLLBACK;
