-- ROLLBACK de 20260727140000_parity_p1_goals_target_and_noshow.sql (#1292 P1)
--
-- Reverte _metric_leaf à versão S2 (sem target, sem rota no_show), dropa o leaf de
-- no_show, remove a medida + compat e a coluna goal_type. DDL pura.

-- 1. _metric_leaf volta à versão S2 (20260727120000): sem target, sem no_show.
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
  RETURN jsonb_build_object(
    'measure_id', p_measure_id, 'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value', v_leaf->'value', 'series', v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- 2. Dropa o leaf de no_show.
DROP FUNCTION IF EXISTS public._metric_leaf_no_show(uuid, text, tstzrange, text, jsonb);

-- 3. Remove a medida reunioes_no_show (compat antes da medida, FK).
DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id = 'reunioes_no_show';
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id = 'reunioes_no_show';
DELETE FROM public.metric_catalog_measures         WHERE id = 'reunioes_no_show';

-- 4. Dropa a coluna goal_type.
ALTER TABLE public.metric_catalog_measures DROP COLUMN IF EXISTS goal_type;
