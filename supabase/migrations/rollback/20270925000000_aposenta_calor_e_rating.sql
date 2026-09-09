-- ROLLBACK pareado de 20270925000000_aposenta_calor_e_rating.sql
--
-- Desfaz a Etapa 2: devolve `leads.rating` com os valores que tinha, devolve o
-- `calor` da projeção canônica, e devolve os 4 parâmetros de nota às 3 funções
-- de funil.
--
-- ============================================================================
-- O QUE ESTE ROLLBACK PODE E O QUE NÃO PODE
-- ============================================================================
-- PODE devolver: a coluna, o CHECK, TODOS os valores (o backup é integral —
--   57.988 linhas, não só as 2.000 com opinião), a coluna `calor` da view
--   `negocio_projetado`, `l.rating` em `leads_compat`, os 4 parâmetros e os
--   filtros das 3 funções de funil, `rating` no RETURNS TABLE de
--   `api_list_leads` e no payload de `api_get_lead`/`get_pipeline_page`.
--
-- NÃO PODE devolver: as notas que alguém teria dado ENTRE o apply e o rollback.
--   Depois do DROP não há onde escrever nota nenhuma, então não há perda —
--   mas há um buraco no tempo, e ele é permanente. Rodar cedo.
--
-- NÃO APAGA as tabelas de backup. Elas são a evidência; sobrevivem ao rollback
--   e são apagadas à mão quando a decisão estiver estável:
--     DROP TABLE backup.leads_rating_20270925, backup.entry_calor_20270925;
--
-- NÃO desfaz nada no metadata: a Seção 7 da migration não removeu a chave
--   'calor' das 487 entradas, então não há o que restaurar. Se a decisão da
--   Seção 7 for revertida NO FUTURO (isto é, se alguém decidir apagar a chave),
--   o SQL de restauração daquela chave a partir do backup está no fim deste
--   arquivo, comentado.

-- ---------------------------------------------------------------------------
-- 0 — Guarda: o backup precisa existir. Sem ele isto não é rollback, é chute.
-- ---------------------------------------------------------------------------
DO $r0$
BEGIN
  IF to_regclass('backup.leads_rating_20270925') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK: backup.leads_rating_20270925 não existe. Sem backup não há restauração — PARE.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid='public.leads'::regclass AND attname='rating' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ROLLBACK: leads.rating já existe — a migration não foi aplicada, ou já foi revertida.';
  END IF;
END
$r0$;

-- ---------------------------------------------------------------------------
-- 1 — A coluna e os dados. Antes das funções: são elas que vão voltar a lê-la.
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads ADD COLUMN rating integer DEFAULT 0;

UPDATE public.leads l
SET    rating = b.rating
FROM   backup.leads_rating_20270925 b
WHERE  b.lead_id = l.id;

-- O CHECK só depois do UPDATE: se entrasse antes, validaria 58 mil linhas
-- contra o DEFAULT e não contra o dado restaurado.
ALTER TABLE public.leads
  ADD CONSTRAINT leads_rating_check CHECK (rating >= 0 AND rating <= 10);

DO $r1$
DECLARE v_bk int; v_ok int;
BEGIN
  SELECT count(*) INTO v_bk FROM backup.leads_rating_20270925;
  SELECT count(*) INTO v_ok FROM public.leads l
    JOIN backup.leads_rating_20270925 b ON b.lead_id = l.id
   WHERE l.rating IS NOT DISTINCT FROM b.rating;
  IF v_ok <> v_bk THEN
    RAISE EXCEPTION 'ROLLBACK 1: restaurei % de % notas. Divergência — investigar antes de commitar.', v_ok, v_bk;
  END IF;
  RAISE NOTICE 'ROLLBACK 1 OK — % notas restauradas.', v_ok;
END
$r1$;

-- ---------------------------------------------------------------------------
-- 2 — Views: devolver as colunas removidas.
-- ---------------------------------------------------------------------------
DO $r2$
DECLARE v_def text;
BEGIN
  -- leads_compat: l.rating volta na mesma posição (depois de utm_term).
  v_def := pg_get_viewdef('public.leads_compat'::regclass, true);
  IF position(E'    l.utm_term,\n' in v_def) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK 2: leads_compat não tem a âncora esperada (l.utm_term).';
  END IF;
  v_def := replace(v_def, E'    l.utm_term,\n', E'    l.utm_term,\n    l.rating,\n');
  EXECUTE 'DROP VIEW public.leads_compat';
  EXECUTE 'CREATE VIEW public.leads_compat AS ' || v_def;
  EXECUTE 'REVOKE ALL ON public.leads_compat FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON public.leads_compat TO authenticated, service_role';

  -- negocio_projetado: `calor` volta entre product_type e loss_reason.
  v_def := pg_get_viewdef('public.negocio_projetado'::regclass, true);
  IF position(E'    pe.metadata ->> ''product_type''::text AS product_type,\n' in v_def) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK 2: negocio_projetado não tem a âncora esperada (product_type).';
  END IF;
  v_def := replace(v_def,
    E'    pe.metadata ->> ''product_type''::text AS product_type,\n',
    E'    pe.metadata ->> ''product_type''::text AS product_type,\n    (pe.metadata ->> ''calor''::text)::integer AS calor,\n');
  EXECUTE 'DROP VIEW public.negocio_projetado';
  EXECUTE 'CREATE VIEW public.negocio_projetado AS ' || v_def;
  EXECUTE 'REVOKE ALL ON public.negocio_projetado FROM PUBLIC, anon';
  EXECUTE 'GRANT SELECT ON public.negocio_projetado TO authenticated, service_role';
END
$r2$;

-- ---------------------------------------------------------------------------
-- 3 — O bisturi, ao contrário.
-- ---------------------------------------------------------------------------
-- Mesma disciplina da ida: opera o corpo VIVO e RECUSA a substituição que não
-- casa. Se a ida foi aplicada e depois alguém mexeu nas funções, este arquivo
-- aborta em vez de reescrever por cima do trabalho do outro.
CREATE OR REPLACE FUNCTION pg_temp._descirurgia(
  p_fn regprocedure, p_de text, p_para text, p_rotulo text
) RETURNS void LANGUAGE plpgsql AS $cir$
DECLARE
  v_antes text := pg_get_functiondef(p_fn);
  v_depois text;
BEGIN
  v_depois := replace(v_antes, p_de, p_para);
  IF v_depois = v_antes THEN
    RAISE EXCEPTION 'DESCIRURGIA [%] em %: âncora não encontrada no corpo vivo. Revisar à mão.',
      p_rotulo, p_fn::text;
  END IF;
  EXECUTE v_depois;
END
$cir$;

-- 3.1 — os dois gatilhos (voltam a rastrear rating)
SELECT pg_temp._descirurgia('public.fn_track_lead_field_changes()'::regprocedure,
  E'    ''qualification_score'',', E'    ''rating'', ''qualification_score'',', 'track_lead_field_changes');
SELECT pg_temp._descirurgia('public.trigger_workflow_field_changed()'::regprocedure,
  E'''faturamento'', ''email''', E'''faturamento'', ''rating'', ''email''', 'workflow_field_changed');

-- 3.2 / 3.3 — API de leitura e escrita
SELECT pg_temp._descirurgia('public.api_get_lead(uuid,uuid)'::regprocedure,
  E'''origin'', l.origin::text, ''qualification_score''',
  E'''origin'', l.origin::text, ''rating'', l.rating, ''qualification_score''', 'api_get_lead');
SELECT pg_temp._descirurgia('public.api_update_lead(uuid,uuid,jsonb)'::regprocedure,
  E'    qualification_score = CASE WHEN p_patch ? ''qualification_score''',
  E'    rating = CASE WHEN p_patch ? ''rating'' THEN (p_patch->>''rating'')::int ELSE rating END,\n    qualification_score = CASE WHEN p_patch ? ''qualification_score''',
  'api_update_lead');

-- 3.4 / 3.5 / 3.6 — caminhos de escrita
SELECT pg_temp._descirurgia('public.create_lead_with_pipe(text,text,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,timestamptz,text,uuid)'::regprocedure,
  E'organization_id, sdr_id, closer_id, notes,', E'organization_id, sdr_id, closer_id, rating, notes,', 'create_lead/colunas');
SELECT pg_temp._descirurgia('public.create_lead_with_pipe(text,text,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,timestamptz,text,uuid)'::regprocedure,
  E'p_organization_id, p_sdr_id, p_closer_id, p_notes,', E'p_organization_id, p_sdr_id, p_closer_id, p_rating, p_notes,', 'create_lead/valores');

SELECT pg_temp._descirurgia('public.import_lead_into_custom_pipeline(uuid,jsonb,uuid,uuid,uuid)'::regprocedure,
  E'    faturamento, segment, notes, origin,', E'    faturamento, segment, notes, origin, rating,', 'import_lead/colunas');
SELECT pg_temp._descirurgia('public.import_lead_into_custom_pipeline(uuid,jsonb,uuid,uuid,uuid)'::regprocedure,
  E'    coalesce((p_lead->>''origin'')::public.lead_origin, ''outro''::public.lead_origin),\n',
  E'    coalesce((p_lead->>''origin'')::public.lead_origin, ''outro''::public.lead_origin),\n    coalesce((p_lead->>''rating'')::int, 0),\n',
  'import_lead/valores');

SELECT pg_temp._descirurgia('public.seed_demo_data(uuid)'::regprocedure,
  E'      organization_id, name, company, phone, email, origin',
  E'      organization_id, name, company, phone, email, origin, rating', 'seed_demo/colunas');
SELECT pg_temp._descirurgia('public.seed_demo_data(uuid)'::regprocedure,
  E'      ''outro''\n', E'      ''outro'',\n      CASE WHEN i <= 3 THEN 5 WHEN i <= 6 THEN 3 ELSE 1 END\n', 'seed_demo/valores');

-- 3.7 / 3.8 — próximas ações e métricas de UTM
SELECT pg_temp._descirurgia('public.get_next_best_actions(integer,uuid)'::regprocedure,
  E'      AND (l.qualification_score >= 70)', E'      AND (l.rating >= 4 OR l.qualification_score >= 70)', 'nba/where');
SELECT pg_temp._descirurgia('public.get_next_best_actions(integer,uuid)'::regprocedure,
  E'    ORDER BY l.qualification_score DESC NULLS LAST, l.updated_at ASC',
  E'    ORDER BY l.qualification_score DESC NULLS LAST, l.rating DESC NULLS LAST, l.updated_at ASC', 'nba/order');

SELECT pg_temp._descirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E'        ) AS responsible\n', E'        ) AS responsible,\n        COALESCE(l.rating, 0) AS rating\n', 'utm/cte1');
SELECT pg_temp._descirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E'      l.responsible_id', E'      l.rating,\n      l.responsible_id', 'utm/cte2');
SELECT pg_temp._descirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E' AS revenue\n', E' AS revenue,\n      ROUND(AVG(fl.rating) FILTER (WHERE fl.rating IS NOT NULL), 1) AS avg_rating\n', 'utm/agregado');
SELECT pg_temp._descirurgia('public.get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)'::regprocedure,
  E'        ''revenue'', g.revenue\n', E'        ''revenue'', g.revenue,\n        ''avg_rating'', COALESCE(g.avg_rating, 0)\n', 'utm/json');

-- ---------------------------------------------------------------------------
-- 4 — Assinaturas: devolver os 4 parâmetros e os filtros. DROP + CREATE.
-- ---------------------------------------------------------------------------
DO $r4$
DECLARE
  v_sigs text[]; v_sig text; v_oid oid; v_def text; v_antes text; v_nome text;
BEGIN
  -- 4.1 — api_list_leads: `rating integer` volta ao RETURNS TABLE.
  SELECT array_agg(p.oid::regprocedure::text) INTO v_sigs
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='api_list_leads';
  FOREACH v_sig IN ARRAY COALESCE(v_sigs, ARRAY[]::text[]) LOOP
    v_oid := v_sig::regprocedure::oid;
    v_def := pg_get_functiondef(v_oid); v_antes := v_def;
    v_def := replace(v_def, 'origin text, qualification_score integer',
                            'origin text, rating integer, qualification_score integer');
    v_def := replace(v_def, E'    l.origin::text,\n', E'    l.origin::text,\n    l.rating,\n');
    IF v_def = v_antes THEN RAISE EXCEPTION 'ROLLBACK 4.1: api_list_leads não bate com o esperado.'; END IF;
    EXECUTE format('DROP FUNCTION %s', v_sig);
    EXECUTE v_def;
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public.api_list_leads(uuid,text[],text[],text[],text[],uuid,timestamptz,timestamptz,text,integer,timestamptz,uuid) FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.api_list_leads(uuid,text[],text[],text[],text[],uuid,timestamptz,timestamptz,text,integer,timestamptz,uuid) TO service_role';

  -- 4.2 — as três funções de funil.
  SELECT array_agg(p.oid::regprocedure::text) INTO v_sigs
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('get_pipeline_page','get_pipeline_stage_counts','get_pipeline_stage_counts_by_id');
  FOREACH v_sig IN ARRAY COALESCE(v_sigs, ARRAY[]::text[]) LOOP
    v_oid := v_sig::regprocedure::oid; v_nome := split_part(v_sig,'(',1);
    v_def := pg_get_functiondef(v_oid); v_antes := v_def;

    v_def := replace(v_def, ', p_origins text[] DEFAULT NULL::text[]',
      ', p_origins text[] DEFAULT NULL::text[], p_rating_min integer DEFAULT NULL::integer, p_rating_max integer DEFAULT NULL::integer, p_calor_min integer DEFAULT NULL::integer, p_calor_max integer DEFAULT NULL::integer');
    v_def := replace(v_def, E'    AND (p_urgency IS NULL',
      E'    AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)\n'
      || E'    AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)\n'
      || E'    AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>''calor'', '''')::INT, 5) >= p_calor_min)\n'
      || E'    AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>''calor'', '''')::INT, 5) <= p_calor_max)\n'
      || E'    AND (p_urgency IS NULL');
    v_def := replace(v_def, E'      p_urgency,', E'      p_rating_min, p_rating_max, p_calor_min, p_calor_max, p_urgency,');
    v_def := replace(v_def, E'''origin'', l.origin', E'''rating'', l.rating, ''origin'', l.origin');

    IF v_def = v_antes THEN RAISE EXCEPTION 'ROLLBACK 4.2 %: corpo vivo não bate com o esperado.', v_nome; END IF;
    EXECUTE format('DROP FUNCTION %s', v_sig);
    EXECUTE v_def;
  END LOOP;

  EXECUTE 'REVOKE ALL ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_pipeline_page(text,text,uuid,integer,timestamptz,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer,uuid) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_pipeline_stage_counts(text,uuid,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts(text,uuid,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.get_pipeline_stage_counts_by_id(uuid,uuid,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_pipeline_stage_counts_by_id(uuid,uuid,text,uuid,uuid[],text[],integer,integer,integer,integer,text,text,timestamptz,timestamptz,timestamptz,timestamptz,text[],timestamptz,text[],text[],boolean,text[],text[],integer,integer) TO authenticated, service_role';
END
$r4$;

-- ---------------------------------------------------------------------------
-- 5 — Asserções do rollback.
-- ---------------------------------------------------------------------------
DO $r5$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid='public.leads'::regclass AND attname='rating' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ROLLBACK 5: leads.rating não voltou.';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND pg_get_function_arguments(p.oid) ~* '\mp_(rating|calor)_(min|max)\M';
  IF v_n <> 3 THEN RAISE EXCEPTION 'ROLLBACK 5: esperava 3 funções com os params de nota; tenho %.', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid='public.negocio_projetado'::regclass AND attname='calor' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'ROLLBACK 5: negocio_projetado.calor não voltou.';
  END IF;

  -- E o anon não ganhou nada de brinde na volta (mesmo default ACL da ida).
  SELECT count(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname IN ('api_list_leads','get_pipeline_page','get_pipeline_stage_counts','get_pipeline_stage_counts_by_id')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_n > 0 THEN RAISE EXCEPTION 'ROLLBACK 5: % função(ões) ficaram executáveis por anon.', v_n; END IF;

  RAISE NOTICE 'ROLLBACK OK — rating e calor de volta; grants conferidos.';
END
$r5$;

-- ---------------------------------------------------------------------------
-- 6 — (não executado) Se um dia a Seção 7 da ida for revertida e a chave
--     'calor' for de fato apagada do metadata, é assim que ela volta:
-- ---------------------------------------------------------------------------
-- UPDATE public.pipeline_entries pe
-- SET    metadata = pe.metadata || jsonb_build_object('calor', b.calor_bruto)
-- FROM   backup.entry_calor_20270925 b
-- WHERE  b.entry_id = pe.id
--   AND  NOT (pe.metadata ? 'calor');
