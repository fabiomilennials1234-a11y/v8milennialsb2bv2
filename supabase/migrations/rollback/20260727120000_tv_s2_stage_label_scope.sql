-- ROLLBACK de 20260727120000_tv_s2_stage_label_scope.sql (#1254 S2)
--
-- Reverte os 2 leafs de etapa ao corpo original (rótulo = stage_key cru, sem
-- degradação de escopo) e remove o helper. DDL pura, sem tocar dado.

-- 1. leads_na_etapa — volta ao original (20260723100100).
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.pipeline_entries pe
  WHERE pe.organization_id = p_org_id
    AND pe.closed_at IS NULL
    AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid);

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
                 ELSE g.bucket_key
               END, 'Sem valor'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'pipeline' THEN pe.pipeline_id::text
          WHEN 'etapa'    THEN pe.stage_key
        END AS bucket_key,
        COUNT(*) AS val
      FROM public.pipeline_entries pe
      WHERE pe.organization_id = p_org_id
        AND pe.closed_at IS NULL
        AND ((p_filters->>'pipeline_id') IS NULL OR pe.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      GROUP BY 1
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- 2. tempo_medio_etapa — volta ao original.
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_duration(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM (
    SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id) pse.id
    FROM public.pipeline_stage_events pse
    WHERE pse.organization_id = p_org_id
      AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', g.bucket_key,
           'label', COALESCE(
             CASE p_recorte
               WHEN 'pipeline' THEN (SELECT p.name FROM public.pipelines p WHERE p.id = g.bucket_key::uuid)
               ELSE g.bucket_key
             END, 'Sem valor'),
           'value', round(g.avg_secs)
         ) ORDER BY g.avg_secs DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      CASE p_recorte
        WHEN 'pipeline' THEN latest.pipeline_id::text
        WHEN 'etapa'    THEN latest.to_stage_key
      END AS bucket_key,
      avg(extract(epoch FROM (now() - latest.occurred_at))) AS avg_secs
    FROM (
      SELECT DISTINCT ON (pse.lead_id, pse.pipeline_id)
        pse.pipeline_id, pse.to_stage_key, pse.occurred_at
      FROM public.pipeline_stage_events pse
      WHERE pse.organization_id = p_org_id
        AND ((p_filters->>'pipeline_id') IS NULL OR pse.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      ORDER BY pse.lead_id, pse.pipeline_id, pse.occurred_at DESC
    ) latest
    GROUP BY 1
  ) g;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

-- 3. _metric_leaf volta ao original (recorte = p_recorte, sem effective).
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
    'anchor', v_anchor, 'recorte', p_recorte,
    'value', v_leaf->'value', 'series', v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- 4. Remove o helper.
DROP FUNCTION IF EXISTS public._stage_key_label(uuid, uuid, text);
