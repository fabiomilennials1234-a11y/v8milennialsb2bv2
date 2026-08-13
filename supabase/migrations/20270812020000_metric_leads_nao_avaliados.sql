-- 20270812020000_metric_leads_nao_avaliados.sql
--
-- SCRUM-311, fatia 3 de 19: "Leads não avaliados". Complemento exato de
-- `leads_avaliados` (20270811130000), sobre a mesma coorte.
--
-- POR QUE MEDIDA PRÓPRIA E NÃO SUBTRAÇÃO NA TELA
--
-- O catálogo do Estúdio marca esta como `parcial` com a nota "derivável
-- (entraram − avaliados), não exposto". Derivar no cliente é o que produz
-- número que não bate: as duas pontas da subtração precisam ter sido medidas
-- com a MESMA coorte, no MESMO instante, com os MESMOS filtros. Basta uma
-- janela recarregar entre as duas chamadas para a conta dar negativo na tela.
--
-- Aqui a subtração não existe: é uma contagem direta com o predicado invertido,
-- pelo mesmo leaf, na mesma transação. A identidade
--
--     leads_avaliados + leads_nao_avaliados = leads_criados
--
-- passa a valer por construção, e é isso que o pgTAP afirma.
--
-- O predicado é `COALESCE(qualification_tier, pre_qualification_tier) IS NULL`.
-- Note que "não avaliado" NÃO é o mesmo que "desqualificado": desqualificado é
-- um tier, portanto é avaliado. Confundir os dois faria o número inchar com
-- leads que a operação já julgou.
--
-- ROLLBACK pareado: rollback/20270812020000_metric_leads_nao_avaliados.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('leads_nao_avaliados', 'Leads não avaliados', 'count', 'entradas',
   'Leads da janela sem nenhuma qualificação, nem final nem pré. Desqualificado NÃO entra aqui — é um tier, logo é avaliado.', 33)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('leads_nao_avaliados', 'total'),
  ('leads_nao_avaliados', 'origem'),
  ('leads_nao_avaliados', 'tag'),
  ('leads_nao_avaliados', 'produto'),
  ('leads_nao_avaliados', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('leads_nao_avaliados', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — DESPACHANTE
-- ===========================================================================
-- O leaf da família já existe (20270811130000). Aqui só entra o ramo.
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_tz text; v_bounds tstzrange; v_leaf jsonb;
BEGIN
  SELECT m.unit, m.anchor INTO v_unit, v_anchor
  FROM public.metric_catalog_measures m WHERE m.id = p_measure_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'unknown measure %', p_measure_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = p_measure_id AND mr.recorte_id = p_recorte
  ) THEN
    RAISE EXCEPTION 'recorte % incompatible with measure %', p_recorte, p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_anchor <> 'hoje' THEN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
  END IF;

  v_leaf := CASE p_measure_id
    WHEN 'receita'               THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'            THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'         THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'     THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'        THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'     THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel' THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'       THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'   THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
  END;

  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- ===========================================================================
-- 3 — GRANTS E GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb) TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure := 'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: anon executa % — REVOKE não pegou', v_fn;
  END IF;
  IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated executa % — despachante interno não pode', v_fn;
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;
END
$guard$;
