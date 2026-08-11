-- 20270812030000_metric_boas_avaliacoes.sql
--
-- SCRUM-311, fatia 4 de 19: "Boas avaliações". Terceira e última da família de
-- qualidade de lead; reusa o leaf criado em 20270811130000.
--
-- FONTE LEGADA E A LISTA QUE NÃO PODE MUDAR
--
-- `get_funnel_health.stages.bons`, definido lá como:
--
--     bons = tier_efetivo IN ('prata', 'ouro', 'diamante')
--
-- `bronze` e `desqualificado` ficam de fora. Esta lista é reproduzida sem
-- alteração porque ela É a régua que a operação já usa na tela de funil —
-- incluir `bronze` aqui faria a mesma pergunta devolver dois números
-- diferentes dependendo da tela, que é o defeito que o Estúdio existe para
-- acabar.
--
-- `boas_avaliacoes` é subconjunto de `leads_avaliados`, não do total. Ou seja:
--
--     boas_avaliacoes ≤ leads_avaliados ≤ leads_criados
--
-- O pgTAP afirma a cadeia inteira, e não só cada ponta.
--
-- ⚠ A TAXA NÃO ENTRA AQUI. "Taxa de qualidade" (`taxa_qualidade`, catálogo do
-- Estúdio) é `boas_avaliacoes ÷ leads_avaliados` — uma RAZÃO, e razão é outro
-- objeto no motor (`metric_catalog_ratios`), com fatia própria. Registrar a
-- taxa como medida seria contrabandear divisão para dentro do catálogo de
-- medidas, que o ADR-0023 separa de propósito.
--
-- ROLLBACK pareado: rollback/20270812030000_metric_boas_avaliacoes.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('boas_avaliacoes', 'Boas avaliações', 'count', 'entradas',
   'Leads da janela com qualificação prata, ouro ou diamante. Mesma régua da tela de funil — bronze e desqualificado ficam de fora.', 34)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('boas_avaliacoes', 'total'),
  ('boas_avaliacoes', 'origem'),
  ('boas_avaliacoes', 'tag'),
  ('boas_avaliacoes', 'produto'),
  ('boas_avaliacoes', 'tempo')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('boas_avaliacoes', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — DESPACHANTE
-- ===========================================================================
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
    WHEN 'boas_avaliacoes'       THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
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

  -- A família inteira precisa estar despachável. Medida catalogada sem ramo
  -- levanta 22023 no motor, mas isso só aparece quando alguém abre a janela —
  -- aqui o apply já recusa.
  IF EXISTS (
    SELECT 1 FROM public.metric_catalog_measures m
    WHERE m.id IN ('leads_avaliados', 'leads_nao_avaliados', 'boas_avaliacoes')
    HAVING count(*) <> 3
  ) THEN
    RAISE EXCEPTION 'GUARDA: a família de qualidade não tem as três medidas no catálogo';
  END IF;
END
$guard$;
