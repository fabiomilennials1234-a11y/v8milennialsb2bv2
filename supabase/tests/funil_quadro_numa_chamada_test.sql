-- supabase/tests/funil_quadro_numa_chamada_test.sql
--
-- get_pipeline_board (20280123000000) == N× get_pipeline_page + get_pipeline_stage_counts_by_id.
--
-- Requer a massa de perf da branch (orgs/usuários com os ids de prod, textos
-- sintéticos): ver o relatório da Trilha B. Rodar:
--   node scripts/branch-pgtap.mjs --ref <branch> --file supabase/tests/funil_quadro_numa_chamada_test.sql
-- Rodado como `authenticated` COM claims (nunca superuser: bypassaria a RLS).
--
-- Asserts
--   (S) estrutura, INVOKER, search_path vazio, ACL exata (sem PUBLIC/anon/service_role)
--   (E) para admin da 38f3 (14 etapas) e membro do Café: cada coluna do
--       quadro é, linha a linha (jsonb inteiro), a 1ª página de get_pipeline_page;
--       counts == get_pipeline_stage_counts_by_id
--   (F) idem com filtros: busca, responsável, período + chaves fechadas, etiqueta
--   (X) org alheia → erro (assert_org_access), funil de outra org → vazio
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(22);

-- ── (S) ─────────────────────────────────────────────────────────────────────
SELECT has_function('public', 'get_pipeline_board',
  ARRAY['uuid','uuid','text[]','integer','text','uuid','uuid[]','text[]','integer','integer','integer','integer','text','text',
        'timestamp with time zone','timestamp with time zone','timestamp with time zone','timestamp with time zone','text[]',
        'timestamp with time zone','text[]','text[]','boolean','text[]','text[]','integer','integer'], '(S1) assinatura');
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname = 'get_pipeline_board'), false, '(S2) SECURITY INVOKER');
SELECT ok((SELECT 'search_path=""' = ANY(proconfig) AND 'plan_cache_mode=force_generic_plan' = ANY(proconfig) FROM pg_proc WHERE proname = 'get_pipeline_board'),
  '(S3) search_path vazio + plano genérico');
SELECT is((SELECT proacl::text FROM pg_proc WHERE proname = 'get_pipeline_board'),
  '{postgres=X/postgres,authenticated=X/postgres}', '(S4) ACL: só authenticated (sem PUBLIC, anon, service_role)');

CREATE TEMP TABLE _quadro(caso text, esperado jsonb, obtido jsonb) ON COMMIT DROP;
GRANT ALL ON _quadro TO authenticated;

-- Esperado e obtido para (org, funil, filtros) no contexto do usuário corrente.
CREATE FUNCTION pg_temp.comparar(p_caso text, p_org uuid, p_pipe uuid, p_search text DEFAULT NULL, p_resp uuid DEFAULT NULL,
                                 p_after timestamptz DEFAULT NULL, p_closed text[] DEFAULT NULL, p_tags uuid[] DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE v_keys text[]; v_board jsonb; v_cols jsonb; v_counts jsonb;
BEGIN
  v_keys := ARRAY(SELECT s.stage_key FROM public.pipeline_stages s WHERE s.pipeline_id = p_pipe AND s.is_active ORDER BY s.position, s.stage_key);
  v_board := public.get_pipeline_board(p_org_id => p_org, p_pipeline_id => p_pipe, p_search => p_search, p_responsible_id => p_resp,
                                        p_period_after => p_after, p_closed_status_keys => p_closed, p_tag_ids => p_tags);
  SELECT jsonb_object_agg(k.k, COALESCE((
           SELECT jsonb_agg(to_jsonb(p) - 'o' ORDER BY p.o)
             FROM public.get_pipeline_page(p_org_id => p_org, p_pipeline_id => p_pipe, p_stage_id => k.k, p_page_size => 20,
                                           p_search => p_search, p_responsible_id => p_resp, p_period_after => p_after,
                                           p_closed_status_keys => p_closed, p_tag_ids => p_tags)
                  WITH ORDINALITY AS p(id, pipeline_id, lead_id, stage_key, assigned_to, notes, metadata, entered_at, stage_changed_at,
                                       created_at, updated_at, lead, o)), '[]'::jsonb))
    INTO v_cols FROM unnest(v_keys) AS k(k);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('stage_id', c.stage_id, 'stage_key', c.stage_key, 'cnt', c.cnt) ORDER BY c.stage_key, c.stage_id), '[]'::jsonb)
    INTO v_counts
    FROM public.get_pipeline_stage_counts_by_id(p_pipeline_id => p_pipe, p_org_id => p_org, p_search => p_search, p_responsible_id => p_resp,
                                                p_period_after => p_after, p_closed_status_keys => p_closed, p_tag_ids => p_tags) c;
  INSERT INTO _quadro VALUES (p_caso || ' colunas', v_cols, v_board -> 'columns'), (p_caso || ' contagens', v_counts, v_board -> 'counts');
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.comparar(text, uuid, uuid, text, uuid, timestamptz, text[], uuid[]) TO authenticated;

-- admin da 38f3
SELECT set_config('request.jwt.claims', '{"sub":"46c1b874-7492-4378-b609-fbb309ba1e87","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('(E1) admin 38f3', '38f3bea4-44c6-4732-bb20-065f547a7ed8', 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1');
SELECT pg_temp.comparar('(F1) admin 38f3 busca', '38f3bea4-44c6-4732-bb20-065f547a7ed8', 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1', p_search => 'Lead 4-1');
SELECT pg_temp.comparar('(F2) admin 38f3 período+fechadas', '38f3bea4-44c6-4732-bb20-065f547a7ed8', 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1',
  p_after => now() - interval '60 days',
  p_closed => ARRAY(SELECT s.stage_key FROM public.pipeline_stages s WHERE s.pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND s.stage_role::text IN ('won','lost')));
SELECT pg_temp.comparar('(F3) admin 38f3 responsável', '38f3bea4-44c6-4732-bb20-065f547a7ed8', 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1',
  p_resp => (SELECT tm.id FROM public.team_members tm WHERE tm.organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8' ORDER BY tm.id LIMIT 1));
SELECT pg_temp.comparar('(F4) admin 38f3 etiqueta', '38f3bea4-44c6-4732-bb20-065f547a7ed8', 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1',
  p_tags => ARRAY(SELECT t.id FROM public.tags t WHERE t.organization_id = '38f3bea4-44c6-4732-bb20-065f547a7ed8' ORDER BY t.name LIMIT 1));
SELECT throws_ok($$SELECT public.get_pipeline_board(p_org_id => '636776d8-6282-48bc-b190-764d42785a5b', p_pipeline_id => 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1')$$,
  'P0001', 'access_denied', '(X1) org alheia: recusada por assert_org_access');
SELECT is(public.get_pipeline_board(p_org_id => '38f3bea4-44c6-4732-bb20-065f547a7ed8', p_pipeline_id => '8106f2dc-e13b-4aaa-8058-05034c1e239a'),
  '{"counts":[],"columns":{}}'::jsonb, '(X2) funil de OUTRA org pela org certa: vazio');
RESET ROLE;

-- membro do Café (não admin; RLS de leads por responsável)
SELECT set_config('request.jwt.claims', '{"sub":"8af3d7f4-4d68-4390-a2ae-f19c4e0a0896","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.comparar('(E2) membro Café', '4922638c-4909-494e-ba10-12282ec0b161', '8106f2dc-e13b-4aaa-8058-05034c1e239a');
SELECT pg_temp.comparar('(F5) membro Café busca', '4922638c-4909-494e-ba10-12282ec0b161', '8106f2dc-e13b-4aaa-8058-05034c1e239a', p_search => '3-1');
RESET ROLE;

-- Controle positivo: o caso não pode passar por estar vazio.
SELECT ok((SELECT jsonb_array_length(obtido -> (SELECT s.stage_key FROM public.pipeline_stages s WHERE s.pipeline_id = 'fef4335d-c4c8-44eb-bc05-ac0805ab05f1' AND s.is_active ORDER BY s.position LIMIT 1))
             FROM _quadro WHERE caso = '(E1) admin 38f3 colunas') = 20, '(E0) CONTROLE POSITIVO: 1ª coluna do admin cheia (20)');
SELECT ok((SELECT jsonb_array_length(obtido) FROM _quadro WHERE caso = '(E2) membro Café contagens') > 0, '(E0b) CONTROLE POSITIVO: membro strict conta alguma etapa');

SELECT is(obtido, esperado, caso) FROM _quadro ORDER BY caso;

SELECT * FROM finish();
ROLLBACK;
