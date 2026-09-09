-- 20270925000000_aposenta_calor_e_rating.sql
-- Etapa 2 da remoção do calor (SCRUM-647 / épico "Funil é Funil", divergência D3).
-- ESCRITA, NÃO APLICADA. Ensaio abortável: scripts/ensaio-etapa2-calor.sh
--
-- ============================================================================
-- O QUE ESTA MIGRATION FAZ
-- ============================================================================
-- Aposenta duas notas de calor que medem a mesma coisa e nunca concordaram:
--   * `leads.rating`      — inteiro 0..10 na pessoa
--   * `pipeline_entries.metadata->>'calor'` — inteiro 1..10 no negócio
-- A divergência D3 é o `COALESCE(..., 5)`: quem não tem calor é lido como 5,
-- ou seja, o produto inventa "morno" e depois filtra por ele. O CTO decidiu
-- resolver removendo o campo, não escolhendo um dos dois.
--
-- ORDEM (não trocar): backup → leitores → assinaturas → views → DROP COLUMN.
-- O DROP vem por último porque dois GATILHOS de `leads` leem `rating` por nome
-- em tempo de execução (ver "A ARMADILHA", abaixo).
--
-- ============================================================================
-- MEDIDO EM PROD (jsjsmuncfkbsbzqzqhfq) EM 2026-09-03
-- ============================================================================
-- leads.rating — integer, DEFAULT 0, NULLable, sem índice, sem policy:
--     rating = 0       55.988 leads / 78 orgs   ← o default, não é opinião de ninguém
--     rating = 5         1.725 leads / 48 orgs   ← o meio da escala; cheira a default de UI
--     rating ∉ {0,5}       275 leads / ~30 orgs  ← TODA a opinião real do produto
--     rating IS NULL       208 leads / 18 orgs
--     total não-nulo    57.988 leads / 82 orgs
--   O briefing falava em "2.000 leads em 50 orgs": é a fatia `rating > 0`
--   (5+9+25+26+16+1725+38+39+117 = 2.000). Está certa, mas 1.725 dela é o "5".
--
-- pipeline_entries.metadata ? 'calor' — 487 entradas / 28 orgs:
--     calor = 5           227 / 10 orgs   ← de novo o meio da escala
--     calor null (chave presente, valor JSON null)  197 / 24 orgs
--     calor ∉ {5,null}     63 /  ~1 org
--   O briefing falava em "290 valores em 10 orgs": é `calor IS NOT NULL`.
--
-- workflows ATIVOS que disparam por rating: 0. (confirmado)
--
-- ============================================================================
-- DEPENDÊNCIAS DE `leads.rating` ENCONTRADAS (o briefing não citava nenhuma)
-- ============================================================================
--   1. VIEW  public.leads_compat        — projeta l.rating. BLOQUEIA o DROP COLUMN.
--                                         Sem tratar, o DROP exige CASCADE e leva
--                                         a view junto. Recriada na Seção 5.
--   2. CHECK leads_rating_check         — CHECK (rating >= 0 AND rating <= 10).
--                                         Cai sozinho junto com a coluna.
--   3. Índice: NENHUM.  Policy RLS: NENHUMA.  Coluna gerada: NÃO.
--   4. 14 funções citam rating/calor (o briefing dizia 12) — ver Seções 3 e 4.
--   5. VIEW  public.negocio_projetado   — projeta o calor do metadata. Seção 5.
--
-- ---- A ARMADILHA -----------------------------------------------------------
-- `fn_track_lead_field_changes()` e `trigger_workflow_field_changed()` NÃO leem
-- NEW.rating estaticamente. Leem assim:
--
--     EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', v_field, v_field)
--       USING OLD, NEW;
--
-- com 'rating' dentro de um text[]. Se a coluna cair antes de sair desses dois
-- arrays, o erro NÃO aparece no apply: aparece no primeiro UPDATE de lead em
-- produção, como `column "rating" not found in data type leads`, em DOIS
-- gatilhos AFTER UPDATE FOR EACH ROW. Ou seja: toda edição de lead do produto
-- inteiro quebra de uma vez. É o motivo de o DROP COLUMN ser a última coisa
-- deste arquivo, e de a Seção 8 conferir os dois arrays antes de deixar commitar.
--
-- ============================================================================
-- ORDEM DE DEPLOY (fora deste arquivo, e ela importa)
-- ============================================================================
--   1º FRONT   (Etapa 1, agente B): a UI para de exibir e de ENVIAR
--              p_rating_min/p_rating_max/p_calor_min/p_calor_max.
--   2º API     (`_shared/api/routes/leads.ts` + openapi.json) — deploy das fns.
--   3º ESTA MIGRATION.
-- Invertido, um front antigo chamando a RPC nova recebe PGRST202 ("Could not
-- find the function ... in the schema cache") e o board fica vazio. Isso é
-- deliberado: falha ALTA e imediata, sem corromper dado. Ver Seção 4.
--
-- ============================================================================
-- POR QUE UM SCHEMA `backup` E NÃO UMA TABELA EM `public`
-- ============================================================================
-- Medido hoje em pg_default_acl, schema public, objtype 'r':
--     {postgres=arwdDxtm/postgres, anon=rxtm/postgres,
--      authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}
--     {postgres=arwdDxtm/supabase_admin, anon=arwdDxtm/supabase_admin, ...}
-- Traduzindo: QUALQUER tabela nova criada em `public` nasce LEGÍVEL por `anon`
-- e com ALL para `authenticated`. Um backup de 58 mil notas de cliente em
-- `public` nasceria exposto na API pública. `REVOKE ... FROM PUBLIC` não
-- resolve — o grant é direto no papel, não via PUBLIC.
-- O schema `backup` não tem entrada em pg_default_acl (conferido: só public,
-- storage, auth, realtime, graphql*, extensions e cron têm), então a tabela
-- nasce sem grant nenhum além do dono. Somam-se duas defesas independentes:
--   (a) PostgREST só expõe os schemas configurados (public, graphql_public) —
--       `backup` é inalcançável pela API mesmo que um grant vaze;
--   (b) REVOKE explícito + asserção com has_table_privilege na Seção 8.
--
-- Arquivo em vez de tabela foi avaliado e RECUSADO: um export sai por HTTP na
-- Management API (com teto de resposta) e passa a viver num laptop, fora do
-- domínio de backup do banco. E, decisivo: uma tabela é ATÔMICA com o DROP —
-- se esta transação abortar, o backup aborta junto; se commitar, ele commitou.
-- Um arquivo não tem essa propriedade, e é justamente na hora de abortar que
-- a diferença aparece.

-- ============================================================================
-- SEÇÃO 0 — Guardas de pré-condição. Abortam alto, antes de tocar em nada.
-- ============================================================================
DO $g0$
DECLARE
  v_n int;
  v_faltando text;
BEGIN
  -- G0 — idempotência: se a coluna já não existe, esta migration já rodou.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.leads'::regclass AND attname = 'rating' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'G0: leads.rating não existe — esta migration já foi aplicada. Abortando.';
  END IF;

  -- G1 — nenhuma dependência ALÉM das duas conhecidas (leads_compat, o CHECK).
  SELECT string_agg(DISTINCT dv.relname::text, ', ') INTO v_faltando
  FROM pg_depend dep
  JOIN pg_rewrite rw ON rw.oid = dep.objid
  JOIN pg_class dv ON dv.oid = rw.ev_class
  WHERE dep.refobjid = 'public.leads'::regclass
    AND dep.refobjsubid = (SELECT attnum FROM pg_attribute
                           WHERE attrelid='public.leads'::regclass AND attname='rating')
    AND dv.relname NOT IN ('leads', 'leads_compat');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'G1: dependências novas de leads.rating apareceram desde 2026-09-03: %. Reavaliar antes de dropar.', v_faltando;
  END IF;

  -- G2 — nenhum workflow ATIVO disparando por rating (medido: 0).
  SELECT count(*) INTO v_n FROM public.workflows w
  WHERE w.is_active AND w.definition::text ~* '"rating"';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'G2: % workflow(s) ativo(s) ainda disparam por rating. Migrar antes.', v_n;
  END IF;

  -- G3 — as 3 funções de funil têm exatamente os 4 parâmetros que vamos remover.
  --      Se alguém já mexeu na assinatura, a Seção 4 estaria removendo outra coisa.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('get_pipeline_page','get_pipeline_stage_counts','get_pipeline_stage_counts_by_id')
    AND pg_get_function_arguments(p.oid) LIKE '%p_rating_min integer%'
    AND pg_get_function_arguments(p.oid) LIKE '%p_rating_max integer%'
    AND pg_get_function_arguments(p.oid) LIKE '%p_calor_min integer%'
    AND pg_get_function_arguments(p.oid) LIKE '%p_calor_max integer%';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'G3: esperava 3 funções de funil com os 4 params de nota; encontrei %.', v_n;
  END IF;

  RAISE NOTICE 'G0..G3 OK — pré-condições satisfeitas.';
END
$g0$;

-- ============================================================================
-- SEÇÃO 1 — BACKUP. Antes de qualquer destruição. É dado de cliente.
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS backup;
COMMENT ON SCHEMA backup IS
  'Cópias frias de dados removidos por migration. NÃO exposto no PostgREST e sem grant para anon/authenticated. Ver 20270925000000.';

-- Cinto e suspensório: o schema não herda default ACL, mas dizemos explícito.
REVOKE ALL ON SCHEMA backup FROM PUBLIC;
REVOKE ALL ON SCHEMA backup FROM anon;
REVOKE ALL ON SCHEMA backup FROM authenticated;

-- 1.1 — as notas do lead. Guardamos TODAS as não-nulas (57.988), não só as
--       2.000 "com valor": o zero também é um fato, e 58 mil linhas não custam
--       nada. `e_opiniao` marca a fatia que alguém de fato escolheu.
CREATE TABLE backup.leads_rating_20270925 (
  lead_id         uuid        NOT NULL,
  organization_id uuid,
  rating          integer     NOT NULL,
  e_opiniao       boolean     NOT NULL,
  copiado_em      timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE backup.leads_rating_20270925 FROM PUBLIC;
REVOKE ALL ON TABLE backup.leads_rating_20270925 FROM anon;
REVOKE ALL ON TABLE backup.leads_rating_20270925 FROM authenticated;

INSERT INTO backup.leads_rating_20270925 (lead_id, organization_id, rating, e_opiniao)
SELECT l.id, l.organization_id, l.rating, (l.rating <> 0)
FROM public.leads l
WHERE l.rating IS NOT NULL;

-- 1.2 — o calor do negócio. Guardamos toda entrada com a CHAVE presente (487),
--       inclusive as 197 em que o valor é JSON null: a chave presente também é
--       um fato sobre o que a UI escreveu.
CREATE TABLE backup.entry_calor_20270925 (
  entry_id        uuid        NOT NULL,
  organization_id uuid,
  pipeline_id     uuid,
  lead_id         uuid,
  calor           integer,
  calor_bruto     jsonb,
  copiado_em      timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE backup.entry_calor_20270925 FROM PUBLIC;
REVOKE ALL ON TABLE backup.entry_calor_20270925 FROM anon;
REVOKE ALL ON TABLE backup.entry_calor_20270925 FROM authenticated;

INSERT INTO backup.entry_calor_20270925
  (entry_id, organization_id, pipeline_id, lead_id, calor, calor_bruto)
SELECT pe.id, pe.organization_id, pe.pipeline_id, pe.lead_id,
       NULLIF(pe.metadata->>'calor','')::int,
       pe.metadata->'calor'
FROM public.pipeline_entries pe
WHERE pe.metadata ? 'calor';

-- 1.3 — o backup capturou tudo? Compara contra a origem, não contra um número
--       escrito à mão: número congelado envelhece e vira carimbo.
DO $b1$
DECLARE
  v_bk int; v_src int;
BEGIN
  SELECT count(*) INTO v_bk  FROM backup.leads_rating_20270925;
  SELECT count(*) INTO v_src FROM public.leads WHERE rating IS NOT NULL;
  IF v_bk <> v_src OR v_bk = 0 THEN
    RAISE EXCEPTION 'BACKUP rating incompleto: % copiadas vs % na origem.', v_bk, v_src;
  END IF;
  RAISE NOTICE 'BACKUP rating: % linhas (% com opinião real).',
    v_bk, (SELECT count(*) FROM backup.leads_rating_20270925 WHERE e_opiniao);

  SELECT count(*) INTO v_bk  FROM backup.entry_calor_20270925;
  SELECT count(*) INTO v_src FROM public.pipeline_entries WHERE metadata ? 'calor';
  IF v_bk <> v_src OR v_bk = 0 THEN
    RAISE EXCEPTION 'BACKUP calor incompleto: % copiadas vs % na origem.', v_bk, v_src;
  END IF;
  RAISE NOTICE 'BACKUP calor: % linhas (% com valor não-nulo).',
    v_bk, (SELECT count(*) FROM backup.entry_calor_20270925 WHERE calor IS NOT NULL);
END
$b1$;

-- ============================================================================
-- SEÇÃO 2 — O bisturi.
-- ============================================================================
-- As Seções 3 e 4 reescrevem funções vivas a partir do corpo QUE ESTÁ EM PROD
-- (pg_get_functiondef), não de um corpo copiado para dentro deste arquivo.
-- Duas razões, ambas medidas:
--
--   (a) Cinco destas funções (create_lead_with_pipe, get_analytics_utm_metrics,
--       get_next_best_actions, import_lead_into_custom_pipeline, seed_demo_data)
--       ainda leem os espelhos e serão reescritas pela 20270920000000
--       (demolição dos espelhos, agente A). Colar o corpo de hoje aqui, com
--       timestamp POSTERIOR ao dela, RESSUSCITARIA `pipe_propostas` dentro de
--       funções que ela acabou de migrar. Operar sobre o corpo vivo é a única
--       forma de as duas migrations comutarem.
--   (b) O corpo de prod já divergiu do repo antes (ver memória "Função de prod
--       mais velha que o ledger"). O corpo vivo é a fonte.
--
-- `_cirurgia` recusa a operação que não corta nada: substituição que não casa
-- vira EXCEÇÃO, nunca no-op silencioso. Detectar não é alertar; aqui, detectar
-- é abortar.
CREATE OR REPLACE FUNCTION pg_temp._cirurgia(
  p_fn regprocedure, p_de text, p_para text, p_rotulo text
) RETURNS void LANGUAGE plpgsql AS $cir$
DECLARE
  v_antes text := pg_get_functiondef(p_fn);
  v_depois text;
BEGIN
  v_depois := replace(v_antes, p_de, p_para);
  IF v_depois = v_antes THEN
    RAISE EXCEPTION 'CIRURGIA [%] em %: o trecho procurado não existe no corpo vivo. O corpo mudou — revisar à mão, não relaxar o gate.',
      p_rotulo, p_fn::text;
  END IF;
  EXECUTE v_depois;
END
$cir$;

-- ============================================================================
-- SEÇÃO 3 — Leitores sem mudança de assinatura (CREATE OR REPLACE).
-- ============================================================================

-- 3.1 — OS DOIS GATILHOS. Primeiro de todos: são eles que quebram todo UPDATE
--       de lead se a coluna cair antes.
SELECT pg_temp._cirurgia('public.fn_track_lead_field_changes()'::regprocedure,
  E'    ''rating'', ''qualification_score'',',
  E'    ''qualification_score'',',
  'track_lead_field_changes');

SELECT pg_temp._cirurgia('public.trigger_workflow_field_changed()'::regprocedure,
  E'''faturamento'', ''rating'', ''email''',
  E'''faturamento'', ''email''',
  'workflow_field_changed');

-- 3.2 — Contrato público de leitura: some `rating` do JSON do lead.
SELECT pg_temp._cirurgia('public.api_get_lead(uuid,uuid)'::regprocedure,
  E'''origin'', l.origin::text, ''rating'', l.rating, ''qualification_score''',
  E'''origin'', l.origin::text, ''qualification_score''',
  'api_get_lead');

-- 3.3 — Escrita da API. O parâmetro `rating` do patch CONTINUA sendo aceito;
--       só para de ser gravado. Ver a nota de depreciação no fim do arquivo.
SELECT pg_temp._cirurgia('public.api_update_lead(uuid,uuid,jsonb)'::regprocedure,
  E'    rating = CASE WHEN p_patch ? ''rating'' THEN (p_patch->>''rating'')::int ELSE rating END,\n',
  '',
  'api_update_lead');

-- 3.4 — Ingestão: `p_rating` continua na assinatura (quebrar lead-webhook/n8n/
--       Make custa LEAD PERDIDO, não filtro quebrado), mas para de ser gravado.
SELECT pg_temp._cirurgia('public.create_lead_with_pipe(text,text,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,timestamptz,text,uuid)'::regprocedure,
  E'organization_id, sdr_id, closer_id, rating, notes,',
  E'organization_id, sdr_id, closer_id, notes,',
  'create_lead_with_pipe/colunas');
SELECT pg_temp._cirurgia('public.create_lead_with_pipe(text,text,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,timestamptz,text,uuid)'::regprocedure,
  E'p_organization_id, p_sdr_id, p_closer_id, p_rating, p_notes,',
  E'p_organization_id, p_sdr_id, p_closer_id, p_notes,',
  'create_lead_with_pipe/valores');

-- 3.5 — Import para funil custom: mesma política (a chave 'rating' do jsonb
--       continua aceita e passa a ser ignorada).
SELECT pg_temp._cirurgia('public.import_lead_into_custom_pipeline(uuid,jsonb,uuid,uuid,uuid)'::regprocedure,
  E'    faturamento, segment, notes, origin, rating,',
  E'    faturamento, segment, notes, origin,',
  'import_lead/colunas');
SELECT pg_temp._cirurgia('public.import_lead_into_custom_pipeline(uuid,jsonb,uuid,uuid,uuid)'::regprocedure,
  E'    coalesce((p_lead->>''rating'')::int, 0),\n',
  '',
  'import_lead/valores');

-- 3.6 — Dados de demonstração.
SELECT pg_temp._cirurgia('public.seed_demo_data(uuid)'::regprocedure,
  E'      organization_id, name, company, phone, email, origin, rating',
  E'      organization_id, name, company, phone, email, origin',
  'seed_demo/colunas');
SELECT pg_temp._cirurgia('public.seed_demo_data(uuid)'::regprocedure,
  E'      ''outro'',\n      CASE WHEN i <= 3 THEN 5 WHEN i <= 6 THEN 3 ELSE 1 END\n',
  E'      ''outro''\n',
  'seed_demo/valores');

-- 3.7 — Próximas melhores ações. MUDANÇA DE COMPORTAMENTO, não só de campo:
--       o recorte de "lead quente parado" era `rating >= 4 OR score >= 70`.
--       Sem rating, passa a ser só `score >= 70`. Menos linhas nessa CTE (que
--       já é LIMIT 4) — e isso é o correto: `rating >= 4` selecionava, na
--       prática, os 1.725 leads carimbados com "5" pela UI, não os quentes.
SELECT pg_temp._cirurgia('public.get_next_best_actions(integer,uuid)'::regprocedure,
  E'      AND (l.rating >= 4 OR l.qualification_score >= 70)',
  E'      AND (l.qualification_score >= 70)',
  'next_best_actions/where');
SELECT pg_temp._cirurgia('public.get_next_best_actions(integer,uuid)'::regprocedure,
  E'    ORDER BY l.qualification_score DESC NULLS LAST, l.rating DESC NULLS LAST, l.updated_at ASC',
  E'    ORDER BY l.qualification_score DESC NULLS LAST, l.updated_at ASC',
  'next_best_actions/order');

-- 3.8 — Métricas de UTM. `avg_rating` sai do JSON de resposta: é chave de
--       contrato com o front de analytics (agente B). Quatro cortes.
SELECT pg_temp._cirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E'        ) AS responsible,\n        COALESCE(l.rating, 0) AS rating\n',
  E'        ) AS responsible\n',
  'utm/cte1');
SELECT pg_temp._cirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E'      l.rating,\n      l.responsible_id',
  E'      l.responsible_id',
  'utm/cte2');
SELECT pg_temp._cirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E' AS revenue,\n      ROUND(AVG(fl.rating) FILTER (WHERE fl.rating IS NOT NULL), 1) AS avg_rating\n',
  E' AS revenue\n',
  'utm/agregado');
SELECT pg_temp._cirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E'        ''revenue'', g.revenue,\n        ''avg_rating'', COALESCE(g.avg_rating, 0)\n',
  E'        ''revenue'', g.revenue\n',
  'utm/json');

-- ============================================================================
-- SEÇÃO 4 — Mudança de assinatura: exige DROP + CREATE e RE-DECLARAR grants.
-- ============================================================================
-- DROP FUNCTION zera os privilégios (memória: "DROP+CREATE de função reseta
-- grants" — EXECUTE volta para PUBLIC/anon pelo default ACL). Cada função
-- abaixo é recriada e RE-GRANTED explicitamente, e a Seção 8 confere.
--
-- Grants medidos em prod hoje, para restaurar exatamente o que existia:
--   api_list_leads ................. service_role
--   get_pipeline_page .............. authenticated, service_role
--   get_pipeline_stage_counts ...... authenticated, service_role
--   get_pipeline_stage_counts_by_id  authenticated, service_role
--
-- FALHA ALTA POR DESENHO: removidos os 4 parâmetros, um front que ainda envie
-- p_rating_min/p_rating_max/p_calor_min/p_calor_max recebe PGRST202 do
-- PostgREST — erro imediato e visível, sem gravar nada errado. É por isso que
-- o front vai PRIMEIRO (ver "ORDEM DE DEPLOY" no cabeçalho).

DO $sig$
DECLARE
  v_sigs    text[];
  v_sig     text;
  r         record;
  v_def     text;
  v_antes   text;
BEGIN
  -- 4.1 — api_list_leads: `rating integer` está no RETURNS TABLE, o que torna
  --       o CREATE OR REPLACE impossível (não se troca tipo de retorno).
  --
  -- As assinaturas são MATERIALIZADAS antes do laço, de propósito. Um
  -- `FOR r IN SELECT ... FROM pg_proc` que dropa e recria funções dentro do
  -- próprio laço enxerga as próprias escritas nas leituras seguintes do
  -- catálogo — a função recriada reaparece e é operada duas vezes. A segunda
  -- passada falharia no `IF v_def = v_antes` e abortaria a migration por um
  -- defeito do laço, não do banco.
  SELECT array_agg(p.oid::regprocedure::text) INTO v_sigs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='api_list_leads';

  FOREACH v_sig IN ARRAY COALESCE(v_sigs, ARRAY[]::text[]) LOOP
    SELECT v_sig::regprocedure AS sig, v_sig::regprocedure::oid AS oid INTO r;
    v_def := pg_get_functiondef(r.oid);
    v_antes := v_def;
    v_def := replace(v_def, 'origin text, rating integer, qualification_score integer',
                            'origin text, qualification_score integer');
    v_def := replace(v_def, E'    l.origin::text,\n    l.rating,\n', E'    l.origin::text,\n');
    IF v_def = v_antes THEN
      RAISE EXCEPTION '4.1 api_list_leads: corpo vivo não bate com o esperado. Revisar à mão.';
    END IF;
    EXECUTE format('DROP FUNCTION %s', r.sig);
    EXECUTE v_def;
  END LOOP;
  -- REVOKE ANTES DO GRANT, e não é zelo: pg_default_acl tem, para objtype 'f'
  -- em `public`, {anon=X, authenticated=X, service_role=X}. Toda função CRIADA
  -- aqui nasce EXECUTÁVEL POR ANON. api_list_leads hoje é service_role-only;
  -- sem este REVOKE, o DROP+CREATE a ABRIRIA para o anônimo — uma função
  -- SECURITY DEFINER que recebe organization_id por parâmetro. Foi o ensaio de
  -- 2026-09-03 que pegou isto, na asserção 8.7.
  EXECUTE 'REVOKE ALL ON FUNCTION public.api_list_leads(uuid,text[],text[],text[],text[],uuid,timestamptz,timestamptz,text,integer,timestamptz,uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.api_list_leads(uuid,text[],text[],text[],text[],uuid,timestamptz,timestamptz,text,integer,timestamptz,uuid) TO service_role';

  -- 4.2 — as três funções de funil: fora os 4 parâmetros de nota e os filtros
  --       que os usavam. `get_pipeline_stage_counts` é um repassador para
  --       `_by_id`: se só a segunda perdesse os parâmetros, a primeira passaria
  --       a chamar uma função que não existe. As três caem juntas, por isso.
  --       (o briefing citava duas; são três.)
  SELECT array_agg(p.oid::regprocedure::text) INTO v_sigs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('get_pipeline_page','get_pipeline_stage_counts','get_pipeline_stage_counts_by_id');

  FOREACH v_sig IN ARRAY COALESCE(v_sigs, ARRAY[]::text[]) LOOP
    SELECT v_sig::regprocedure AS sig, v_sig::regprocedure::oid AS oid,
           split_part(v_sig, '(', 1) AS proname INTO r;
    v_def := pg_get_functiondef(r.oid);
    v_antes := v_def;

    -- assinatura (as 3)
    v_def := replace(v_def, ', p_rating_min integer DEFAULT NULL::integer', '');
    v_def := replace(v_def, ', p_rating_max integer DEFAULT NULL::integer', '');
    v_def := replace(v_def, ', p_calor_min integer DEFAULT NULL::integer', '');
    v_def := replace(v_def, ', p_calor_max integer DEFAULT NULL::integer', '');

    -- filtros (get_pipeline_page e _by_id). Aqui morre o COALESCE(calor, 5):
    -- a divergência D3 em pessoa.
    v_def := replace(v_def, E'    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)\n', '');
    v_def := replace(v_def, E'    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)\n', '');
    v_def := replace(v_def, E'    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>''calor'', '''')::INT, 5) >= p_calor_min)\n', '');
    v_def := replace(v_def, E'    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>''calor'', '''')::INT, 5) <= p_calor_max)\n', '');

    -- repasse (get_pipeline_stage_counts)
    v_def := replace(v_def, E'      p_rating_min, p_rating_max, p_calor_min, p_calor_max, p_urgency,',
                            E'      p_urgency,');

    -- rating dentro do jsonb do lead (get_pipeline_page)
    v_def := replace(v_def, E'''rating'', l.rating, ''origin'', l.origin', E'''origin'', l.origin');

    IF v_def = v_antes THEN
      RAISE EXCEPTION '4.2 %: corpo vivo não bate com o esperado. Revisar à mão.', r.proname;
    END IF;
    IF v_def ~* '\mp_(rating|calor)_(min|max)\M' THEN
      RAISE EXCEPTION '4.2 %: sobrou referência a p_rating_*/p_calor_* após a cirurgia.', r.proname;
    END IF;

    EXECUTE format('DROP FUNCTION %s', r.sig);
    EXECUTE v_def;
  END LOOP;

  -- Mesmo motivo do 4.1: revogar o brinde do default ACL antes de conceder o
  -- que estas três de fato tinham (authenticated + service_role, medido hoje).
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) FROM PUBLIC, anon';
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_pipeline_stage_counts(text,uuid,text,uuid,uuid[],text[],text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) FROM PUBLIC, anon';
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_pipeline_stage_counts_by_id(uuid,uuid,text,uuid,uuid[],text[],text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) FROM PUBLIC, anon';

  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) TO authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts(text,uuid,text,uuid,uuid[],text[],text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) TO authenticated, service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts_by_id(uuid,uuid,text,uuid,uuid[],text[],text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) TO authenticated, service_role';
END
$sig$;

-- ============================================================================
-- SEÇÃO 5 — Views. CREATE OR REPLACE VIEW não remove coluna: é DROP + CREATE.
-- ============================================================================
DO $vw$
DECLARE
  v_def text;
BEGIN
  -- 5.1 — leads_compat. É ELA que bloqueia o DROP COLUMN da Seção 6.
  --       Grants medidos: authenticated, service_role. Nenhuma função a lê.
  v_def := pg_get_viewdef('public.leads_compat'::regclass, true);
  IF position(E'    l.rating,\n' in v_def) = 0 THEN
    RAISE EXCEPTION '5.1 leads_compat: não achei l.rating na definição viva.';
  END IF;
  v_def := replace(v_def, E'    l.rating,\n', '');
  EXECUTE 'DROP VIEW public.leads_compat';
  EXECUTE 'CREATE VIEW public.leads_compat AS ' || v_def;
  EXECUTE 'GRANT SELECT ON public.leads_compat TO authenticated, service_role';

  -- 5.2 — negocio_projetado (projeção canônica, 20270919000000). A coluna
  --       `calor` nasceu hoje e morre hoje. Seis funções a leem, todas em
  --       plpgsql/sql NÃO-atômico (conferido: prosqlbody IS NULL nas seis),
  --       então nenhuma segura pg_depend sobre a view e o DROP passa.
  --       Nenhuma delas seleciona `calor` (conferido).
  v_def := pg_get_viewdef('public.negocio_projetado'::regclass, true);
  IF position(E'    (pe.metadata ->> ''calor''::text)::integer AS calor,\n' in v_def) = 0 THEN
    RAISE EXCEPTION '5.2 negocio_projetado: não achei a coluna calor na definição viva.';
  END IF;
  v_def := replace(v_def, E'    (pe.metadata ->> ''calor''::text)::integer AS calor,\n', '');
  EXECUTE 'DROP VIEW public.negocio_projetado';
  EXECUTE 'CREATE VIEW public.negocio_projetado AS ' || v_def;
  EXECUTE 'GRANT SELECT ON public.negocio_projetado TO authenticated, service_role';
END
$vw$;

-- ============================================================================
-- SEÇÃO 6 — A coluna. Por último, e sem CASCADE.
-- ============================================================================
-- Sem CASCADE de propósito: se sobrou algum dependente que as Seções 0 e 5 não
-- previram, queremos o ERRO, não a demolição em cadeia do que ele segurava.
ALTER TABLE public.leads DROP COLUMN rating;

-- ============================================================================
-- SEÇÃO 7 — O `calor` do metadata: FICA. Decisão, não esquecimento.
-- ============================================================================
-- Não removemos a chave 'calor' das 487 entradas. Razões:
--   1. Assimetria de custo: deixar não custa nada (nenhum leitor sobrou — a
--      Seção 8 prova), remover é irreversível na linha viva. Backup e produção
--      divergiriam sem ganho nenhum.
--   2. A coluna `leads.rating` PRECISA sair porque é schema: aparece em
--      types.ts, no RETURNS TABLE, no payload da API, e um `SELECT *` a
--      carrega sozinha. Uma chave de JSONB não aparece em lugar nenhum que
--      não a leia de propósito. Dado morto sem leitor não vaza e não mente.
--   3. Se o calor um dia voltar como conceito (agora medido, não digitado),
--      esses 487 registros são a única amostra de como as orgs usavam a régua.
--      Jogar fora hoje é destruir a evidência do próximo desenho.
-- Um UPDATE `metadata - 'calor'` em 487 linhas está no rollback pareado, caso
-- a decisão mude. O caminho de volta é que precisa existir, não a destruição.

-- ============================================================================
-- SEÇÃO 8 — Asserções finais. Nada commita sem passar por aqui.
-- ============================================================================
DO $fim$
DECLARE
  v_n int;
  v_l text;
BEGIN
  -- 8.1 — a coluna morreu.
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid='public.leads'::regclass AND attname='rating' AND NOT attisdropped) THEN
    RAISE EXCEPTION '8.1: leads.rating ainda existe.';
  END IF;

  -- 8.2 — nenhuma função de prod cita mais rating/calor. Esta é A asserção:
  --       é ela que impede o cenário "gatilho lê coluna que não existe" de
  --       chegar em produção e derrubar todo UPDATE de lead.
  SELECT string_agg(p.oid::regprocedure::text, ', '), count(*) INTO v_l, v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
    AND (p.prosrc ~* '\mrating\M' OR p.prosrc ~* '\mcalor\M')
    -- pipe_propostas_{insert,update}_fn são gatilhos INSTEAD OF do espelho
    -- pipe_propostas: território da 20270920000000 (demolição), que os apaga
    -- inteiros. Escrevem 'calor' no metadata a partir de NEW.calor, coluna da
    -- VIEW — não de leads. Não quebram com este DROP.
    AND p.proname NOT IN ('pipe_propostas_insert_fn','pipe_propostas_update_fn');
  IF v_n > 0 THEN
    RAISE EXCEPTION '8.2: % função(ões) ainda citam rating/calor: %', v_n, v_l;
  END IF;

  -- 8.3 — nenhuma view cita mais rating/calor.
  SELECT string_agg(c.relname, ', '), count(*) INTO v_l, v_n
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('v','m')
    AND pg_get_viewdef(c.oid, true) ~* '\m(rating|calor)\M'
    AND c.relname NOT IN ('pipe_propostas');  -- espelho, cai na 20270920000000
  IF v_n > 0 THEN
    RAISE EXCEPTION '8.3: % view(s) ainda citam rating/calor: %', v_n, v_l;
  END IF;

  -- 8.4 — os 4 parâmetros sumiram das 3 funções de funil.
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND pg_get_function_arguments(p.oid) ~* '\mp_(rating|calor)_(min|max)\M';
  IF v_n > 0 THEN
    RAISE EXCEPTION '8.4: % função(ões) ainda expõem p_rating_*/p_calor_*.', v_n;
  END IF;

  -- 8.5 — GRANTS DO BACKUP FECHADOS. A armadilha do default ACL do schema
  --       public é reincidente (memória: "Backup em public nasce legível por
  --       anon", reincidiu em 11/08 com token vivo). Aqui ela é medida, não
  --       presumida.
  IF has_schema_privilege('anon', 'backup', 'USAGE')
     OR has_schema_privilege('authenticated', 'backup', 'USAGE') THEN
    RAISE EXCEPTION '8.5: schema backup acessível por anon/authenticated.';
  END IF;
  FOR v_l IN SELECT unnest(ARRAY['backup.leads_rating_20270925','backup.entry_calor_20270925']) LOOP
    IF has_table_privilege('anon', v_l, 'SELECT')
       OR has_table_privilege('authenticated', v_l, 'SELECT')
       OR has_table_privilege('anon', v_l, 'INSERT')
       OR has_table_privilege('authenticated', v_l, 'INSERT')
       OR has_table_privilege('anon', v_l, 'UPDATE')
       OR has_table_privilege('authenticated', v_l, 'UPDATE')
       OR has_table_privilege('anon', v_l, 'DELETE')
       OR has_table_privilege('authenticated', v_l, 'DELETE') THEN
      RAISE EXCEPTION '8.5: % legível/gravável por anon ou authenticated.', v_l;
    END IF;
  END LOOP;

  -- 8.6 — grants re-declarados nas funções recriadas (DROP zerou os antigos).
  IF NOT has_function_privilege('service_role',
       'public.api_list_leads(uuid,text[],text[],text[],text[],uuid,timestamptz,timestamptz,text,integer,timestamptz,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '8.6: api_list_leads perdeu o grant de service_role.';
  END IF;
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('get_pipeline_page','get_pipeline_stage_counts','get_pipeline_stage_counts_by_id')
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '8.6: esperava 3 funções de funil com grant restaurado; tenho %.', v_n;
  END IF;

  -- 8.7 — e o `anon` não ganhou EXECUTE de brinde no caminho (default ACL de
  --       FUNÇÃO em public também dá X para anon).
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('api_list_leads','get_pipeline_page','get_pipeline_stage_counts','get_pipeline_stage_counts_by_id')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_n > 0 THEN
    RAISE EXCEPTION '8.7: % função(ões) recriadas ficaram executáveis por anon.', v_n;
  END IF;

  RAISE NOTICE 'ETAPA 2 OK — rating e calor aposentados; backup fechado; grants conferidos.';
END
$fim$;

COMMENT ON TABLE backup.leads_rating_20270925 IS
  'leads.rating antes do DROP (Etapa 2, SCRUM-647). e_opiniao=true marca rating<>0. Restauração: ver supabase/migrations/rollback/20270925000000_aposenta_calor_e_rating.sql';
COMMENT ON TABLE backup.entry_calor_20270925 IS
  'pipeline_entries.metadata->>calor no dia do DROP (Etapa 2, SCRUM-647). A chave NÃO foi removida da linha viva — ver Seção 7 da migration.';
