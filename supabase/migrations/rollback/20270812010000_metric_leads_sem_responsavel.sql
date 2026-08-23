-- ROLLBACK de 20270812010000_metric_leads_sem_responsavel.sql
--
-- ORDEM IMPORTA. O despachante precisa perder o ramo ANTES de a função sumir,
-- senão _metric_leaf fica referenciando função inexistente e toda leitura do
-- motor quebra — não só esta medida.
--
-- A guarda contra medida sem ramo (IF v_leaf IS NULL) fica: ela não pertence a
-- esta medida, corrige um buraco que já existia. Manter é mais seguro que
-- devolver o NULL silencioso.

-- 1 — despachante volta às 7 medidas, mantendo a guarda.
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
    WHEN 'receita'             THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'          THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'       THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'   THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas' THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'   THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
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

REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, jsonb) TO service_role;

-- 2 — catálogo. Widget salvo que aponte para esta medida some junto (FK), por
--     isso a ordem: filhos antes do pai.
DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id = 'leads_sem_responsavel';
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id = 'leads_sem_responsavel';
DELETE FROM public.metric_catalog_measures         WHERE id         = 'leads_sem_responsavel';

-- 3 — leaf, por último.
DROP FUNCTION IF EXISTS public._metric_leaf_leads_sem_dono(uuid, text, jsonb);
