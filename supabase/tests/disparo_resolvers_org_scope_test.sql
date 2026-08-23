-- ============================================================================
-- Resolvers de público do Disparo — ESCOPO e PRIVILÉGIO (SCRUM-429)
-- ============================================================================
--
-- O que este arquivo protege, e por que ele é de catálogo e não de comportamento:
--
-- O bug do SCRUM-429 é uma LINHA QUE FALTAVA. O predicado de tenancy dos cinco
-- resolvers autorizava (`OR` com o ramo master) mas não escopava, então master
-- pedindo a org B recebia B mais todas as outras — num caminho que ENVIA
-- mensagem de WhatsApp. A migration 20270822180000 acrescenta, em cada um:
--
--     AND (p_organization_id IS NULL OR <tabela>.organization_id = p_organization_id)
--
-- O COMPORTAMENTO já é coberto, com auth de verdade, por
-- tests/integration/get-filtered-lead-ids-conditions.test.ts (bloco SCRUM-429) e
-- por get-stage-lead-ids.test.ts caso (f). O que aquelas suítes NÃO pegam é a
-- regressão silenciosa: um `CREATE OR REPLACE` futuro que reescreva o corpo e
-- deixe a linha cair de UM dos cinco — ou, em `get_all_funnels_lead_ids`, de UM
-- dos dois ramos da união. Foi exatamente assim que o predicado de autorização
-- chegou incompleto: copiado cinco vezes à mão.
--
-- Daí a forma: asserção sobre `pg_proc.prosrc`, que conta as ocorrências. É um
-- teste estrutural, e o custo dele é conhecido — renomear o parâmetro quebra
-- este arquivo. Isso é desejado: renomear o parâmetro de escopo É a mudança que
-- precisa de revisão humana.
--
-- Nada aqui troca de ROLE nem depende de claim de JWT (ver a nota do
-- assert_org_access sobre `postgres` não ser superusuário no CI): são leituras
-- de catálogo, determinísticas em qualquer banco construído do repo.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- ---------------------------------------------------------------------------
-- diagnóstico: quem tem EXECUTE em cada resolver, cru, no log do job
-- ---------------------------------------------------------------------------
SELECT diag(
  'ACL ' || p.proname || '/' || p.pronargs || ' = ' || COALESCE(p.proacl::text, '(default: herda de PUBLIC)')
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_stage_lead_ids', 'get_filtered_lead_ids', 'get_custom_filtered_lead_ids',
    'get_carteira_lead_ids', 'get_all_funnels_lead_ids'
  );

-- ---------------------------------------------------------------------------
-- 1-5. O predicado de ESCOPO existe em cada resolver.
--
-- `get_all_funnels_lead_ids` exige DUAS ocorrências: a união tem um ramo em
-- pipeline_entries e outro em custom_pipe_entries, e esquecer um dos dois vaza
-- pela metade — que é pior que vazar inteiro, porque passa despercebido.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL regexp_matches(p.prosrc, 'p_organization_id IS NULL OR', 'g') AS m
    WHERE n.nspname = 'public' AND p.proname = 'get_stage_lead_ids'),
  1, 'get_stage_lead_ids escopa por p_organization_id (SCRUM-429)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL regexp_matches(p.prosrc, 'p_organization_id IS NULL OR', 'g') AS m
    WHERE n.nspname = 'public' AND p.proname = 'get_filtered_lead_ids'),
  1, 'get_filtered_lead_ids escopa por p_organization_id (SCRUM-429)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL regexp_matches(p.prosrc, 'p_organization_id IS NULL OR', 'g') AS m
    WHERE n.nspname = 'public' AND p.proname = 'get_custom_filtered_lead_ids'),
  1, 'get_custom_filtered_lead_ids escopa por p_organization_id (SCRUM-429)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL regexp_matches(p.prosrc, 'p_organization_id IS NULL OR', 'g') AS m
    WHERE n.nspname = 'public' AND p.proname = 'get_carteira_lead_ids'),
  1, 'get_carteira_lead_ids escopa por p_organization_id (SCRUM-429)');

SELECT is(
  (SELECT count(*)::int
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL regexp_matches(p.prosrc, 'p_organization_id IS NULL OR', 'g') AS m
    WHERE n.nspname = 'public' AND p.proname = 'get_all_funnels_lead_ids'),
  2, 'get_all_funnels_lead_ids escopa nos DOIS ramos da união (SCRUM-429)');

-- ---------------------------------------------------------------------------
-- 6-10. O gate de AUTORIZAÇÃO continua onde estava.
--
-- O fix é aditivo: ele RESTRINGE, e não substitui o `is_master_user()`. Se uma
-- reescrita futura trocar o `OR` do ramo master pelo escopo — achando que um
-- resolve o outro — o master-ghost volta: master sem membership na org pedida
-- passa a receber público VAZIO, e o DisparoWizard volta a dizer "nenhum lead
-- neste estágio" (o bug original de archive/20261228000000).
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT p.prosrc LIKE '%is_master_user()%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_stage_lead_ids'),
  'get_stage_lead_ids preserva o ramo master (master-ghost não regride)');

SELECT ok(
  (SELECT p.prosrc LIKE '%is_master_user()%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_filtered_lead_ids'),
  'get_filtered_lead_ids preserva o ramo master');

SELECT ok(
  (SELECT p.prosrc LIKE '%is_master_user()%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_custom_filtered_lead_ids'),
  'get_custom_filtered_lead_ids preserva o ramo master');

SELECT ok(
  (SELECT p.prosrc LIKE '%is_master_user()%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_carteira_lead_ids'),
  'get_carteira_lead_ids preserva o ramo master');

SELECT ok(
  (SELECT p.prosrc LIKE '%get_my_organization_ids()%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_all_funnels_lead_ids'),
  'get_all_funnels_lead_ids preserva o helper de tenancy');

-- ---------------------------------------------------------------------------
-- 11-13. NENHUM deles é SECURITY DEFINER, e o search_path segue pinado.
--
-- Estes resolvers dependem da RLS de `leads` como backstop — o INNER JOIN é o
-- que esconde lead de outro tenant e lead soft-deleted. Virar DEFINER
-- desligaria esse backstop sem que nada no corpo mudasse de aparência.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_stage_lead_ids', 'get_filtered_lead_ids',
                        'get_custom_filtered_lead_ids', 'get_carteira_lead_ids',
                        'get_all_funnels_lead_ids')
      AND p.prosecdef),
  0, 'nenhum resolver de público é SECURITY DEFINER (a RLS de leads é o backstop)');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_stage_lead_ids', 'get_filtered_lead_ids',
                        'get_custom_filtered_lead_ids', 'get_carteira_lead_ids',
                        'get_all_funnels_lead_ids')
      AND NOT EXISTS (
            SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
             WHERE cfg LIKE 'search_path=%')),
  0, 'os 5 resolvers pinam search_path');

SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_stage_lead_ids', 'get_filtered_lead_ids',
                        'get_custom_filtered_lead_ids', 'get_carteira_lead_ids',
                        'get_all_funnels_lead_ids')),
  5, 'os 5 resolvers existem em UMA assinatura cada — nenhum overload órfão');

-- ---------------------------------------------------------------------------
-- 14-18. `authenticated` mantém EXECUTE nos cinco.
--
-- `CREATE OR REPLACE` preserva a ACL da função (o Postgres não reaplica default
-- privileges em objeto já existente), mas isso é PROMESSA de documentação — e a
-- rubric de segurança exige a medição, não a leitura. É o app inteiro que
-- depende deste grant: os cinco call-sites do DisparoWizard chamam com o JWT do
-- usuário logado.
--
-- ⚠ HERDADO, NÃO ASSERIDO AQUI: o baseline 20260101000000 também concede
-- EXECUTE a `anon` nestes resolvers (`GRANT ALL … TO "anon"`). O grant é inerte
-- — são SECURITY INVOKER, então para anon `get_my_organization_ids()` volta
-- vazio, `is_master_user()` é falso, e a RLS de `leads` ainda barra o join — mas
-- é superfície que não precisava existir. Revogar é mudança de contrato de
-- privilégio, fora do escopo do SCRUM-429; o `diag` acima deixa a ACL no log
-- para quem for abrir esse card.
-- ---------------------------------------------------------------------------
SELECT ok(has_function_privilege('authenticated',
  'public.get_stage_lead_ids(text,text,uuid)', 'EXECUTE'),
  'authenticated executa get_stage_lead_ids (o REPLACE não derrubou o grant)');

SELECT ok(has_function_privilege('authenticated',
  'public.get_filtered_lead_ids(text,text,text,uuid,uuid[],text[],text[],text[],uuid)', 'EXECUTE'),
  'authenticated executa get_filtered_lead_ids');

SELECT ok(has_function_privilege('authenticated',
  'public.get_custom_filtered_lead_ids(uuid,uuid,text,uuid,uuid[],text[],text[],text[],uuid)', 'EXECUTE'),
  'authenticated executa get_custom_filtered_lead_ids');

SELECT ok(has_function_privilege('authenticated',
  'public.get_carteira_lead_ids(text[],text,uuid[],text[],text[],text[],uuid)', 'EXECUTE'),
  'authenticated executa get_carteira_lead_ids');

SELECT ok(has_function_privilege('authenticated',
  'public.get_all_funnels_lead_ids(uuid[],text[],text[],text[],uuid)', 'EXECUTE'),
  'authenticated executa get_all_funnels_lead_ids');

SELECT * FROM finish();
ROLLBACK;
