-- rollback/20270813110000_metric_custom_definitions.sql
--
-- Desfaz a métrica personalizada. Ordem: o motor volta ao corpo sem os ramos
-- `custom`/`tree` ANTES de as funções de árvore saírem, senão fica um intervalo
-- em que o motor chama função que não existe mais.
--
-- ⚠ `DROP TABLE metric_custom_definitions` APAGA DEFINIÇÃO DE CLIENTE. Fica no
-- fim, comentado. Rodar rollback num ambiente onde alguém já montou métrica
-- destrói trabalho que não é recuperável sem backup.

-- 1 — motor volta ao corpo de 20260723100100 (leaf | ratio)
CREATE OR REPLACE FUNCTION public.fn_metric_measure(
  p_org_id     uuid,
  p_measure_ref jsonb,
  p_recorte    text,
  p_period     text     DEFAULT 'month',
  p_ref        date     DEFAULT NULL,
  p_start      date     DEFAULT NULL,
  p_end        date     DEFAULT NULL,
  p_filters    jsonb    DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_kind text; v_num jsonb; v_den jsonb; v_num_v numeric; v_den_v numeric;
  v_unit text; v_val numeric; v_period_label text; v_tz text; v_bounds tstzrange;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  v_kind := COALESCE(p_measure_ref->>'kind', 'leaf');

  BEGIN
    SELECT o.timezone INTO v_tz FROM public.organizations o WHERE o.id = p_org_id;
    v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);
    v_period_label := to_char(lower(v_bounds) AT TIME ZONE v_tz, 'MM/YYYY');
  EXCEPTION WHEN OTHERS THEN
    v_period_label := NULL;
  END;

  IF v_kind = 'leaf' THEN
    RETURN public._metric_leaf(
             p_org_id, p_measure_ref->>'id', p_recorte,
             p_period, p_ref, p_start, p_end, p_filters)
           || jsonb_build_object('kind', 'leaf',
                'provenance', jsonb_build_object('period_label', v_period_label, 'stream', p_filters->>'stream', 'note', NULL));

  ELSIF v_kind = 'ratio' THEN
    v_num := public._metric_leaf(p_org_id, p_measure_ref->>'num', 'total',
                                 p_period, p_ref, p_start, p_end, p_filters);
    v_den := public._metric_leaf(p_org_id, p_measure_ref->>'den', 'total',
                                 p_period, p_ref, p_start, p_end, p_filters);
    v_num_v := (v_num->>'value')::numeric;
    v_den_v := (v_den->>'value')::numeric;

    v_unit := CASE
      WHEN (v_num->>'unit') = 'count'    AND (v_den->>'unit') = 'count' THEN 'percent'
      WHEN (v_num->>'unit') = 'currency' AND (v_den->>'unit') = 'count' THEN 'currency'
      ELSE 'ratio'
    END;
    v_val := CASE
      WHEN v_den_v IS NULL OR v_den_v = 0 THEN NULL
      WHEN v_unit = 'percent'  THEN round(100.0 * v_num_v / v_den_v, 2)
      WHEN v_unit = 'currency' THEN round(v_num_v / v_den_v, 2)
      ELSE round(v_num_v / v_den_v, 4)
    END;

    RETURN jsonb_build_object(
      'kind', 'ratio',
      'measure_ref', p_measure_ref,
      'unit', v_unit,
      'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
      'anchor', v_num->>'anchor',
      'value', v_val,
      'series', NULL,
      'num', jsonb_build_object('measure_id', v_num->>'measure_id', 'value', v_num_v, 'unit', v_num->>'unit'),
      'den', jsonb_build_object('measure_id', v_den->>'measure_id', 'value', v_den_v, 'unit', v_den->>'unit'),
      'empty_reason', CASE WHEN v_den_v IS NULL OR v_den_v = 0 THEN 'no_rows' ELSE NULL END,
      'provenance', jsonb_build_object('period_label', v_period_label, 'stream', p_filters->>'stream', 'note', NULL)
    );
  ELSE
    RAISE EXCEPTION 'unknown measure_ref kind %', v_kind USING ERRCODE = '22023';
  END IF;
END;
$$;

-- 2 — some com o maquinário da árvore
DROP TRIGGER   IF EXISTS trg_metric_custom_definitions_validate  ON public.metric_custom_definitions;
DROP TRIGGER   IF EXISTS trg_metric_custom_definitions_updated_at ON public.metric_custom_definitions;
DROP FUNCTION  IF EXISTS public.trg_metric_custom_definition_validate();
DROP FUNCTION  IF EXISTS public._metric_tree_eval(uuid, jsonb, text, date, date, date, jsonb, int);
DROP FUNCTION  IF EXISTS public.fn_metric_tree_validate(jsonb);
DROP FUNCTION  IF EXISTS public._metric_tree_unit(jsonb, int);
DROP FUNCTION  IF EXISTS public._metric_tree_formats_for_unit(text);
DROP FUNCTION  IF EXISTS public._metric_tree_op_unit(text, text, text);

-- 3 — dado do cliente: decisão explícita, nunca automática
-- DROP TABLE IF EXISTS public.metric_custom_definitions;
