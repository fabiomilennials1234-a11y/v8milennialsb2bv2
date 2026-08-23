-- rollback/20270813100000_metric_negocio_semantica.sql
--
-- Desfaz a fatia 9. A ordem importa: o despachante volta a apontar para o
-- snapshot de 3 argumentos ANTES de a versão de 4 sair, senão fica um intervalo
-- em que `leads_na_etapa` não tem função para chamar.
--
-- ⚠ `sale_events.deal_id` NÃO é derrubada por padrão. A coluna é nulável e
-- inerte, e derrubar coluna de tabela de dinheiro é irreversível sem backup. O
-- DROP fica no fim, comentado, para decisão explícita.

-- 1 — restaura o snapshot de 3 argumentos (corpo de 20260727120000)
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_snapshot(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint;
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

REVOKE EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb) TO service_role;

-- 2 — despachante volta ao corpo de 20270812120000 (14 medidas, sem as 2 novas)
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_goal_type text; v_tz text;
  v_bounds tstzrange; v_leaf jsonb; v_target numeric;
BEGIN
  SELECT m.unit, m.anchor, m.goal_type INTO v_unit, v_anchor, v_goal_type
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
    WHEN 'receita'                THEN public._metric_leaf_sales(p_org_id, 'revenue', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
  END;

  IF v_leaf IS NULL THEN
    RAISE EXCEPTION 'measure % has no leaf implementation', p_measure_id
      USING ERRCODE = '22023';
  END IF;

  IF v_goal_type IS NOT NULL AND v_bounds IS NOT NULL THEN
    SELECT sum(g.target_value) INTO v_target
    FROM public.goals g
    WHERE g.organization_id = p_org_id
      AND g.type = v_goal_type
      AND g.month = extract(month FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND g.year  = extract(year  FROM (lower(v_bounds) AT TIME ZONE v_tz))::int
      AND (
        ((p_filters->>'member_id') IS NULL AND g.team_member_id IS NULL)
        OR g.team_member_id = (p_filters->>'member_id')::uuid
      );
  END IF;

  RETURN jsonb_build_object(
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', COALESCE(v_leaf->>'effective_recorte', p_recorte),
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'target',  v_target,
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- 3 — some com o que a fatia acrescentou
DROP FUNCTION IF EXISTS public._metric_leaf_stage_snapshot(uuid, text, jsonb, text);
DROP FUNCTION IF EXISTS public._metric_leaf_negocios_abertos(uuid, text, tstzrange, text, jsonb);

DELETE FROM public.metric_catalog_ratios WHERE id = 'conversao_negocio';
UPDATE public.metric_catalog_ratios SET label = 'Taxa de conversão'
 WHERE id = 'conversao' AND label = 'Taxa de conversão por lead';

DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id IN ('negocios_na_etapa','negocios_abertos');
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id IN ('negocios_na_etapa','negocios_abertos');
DELETE FROM public.metric_catalog_measures         WHERE id         IN ('negocios_na_etapa','negocios_abertos');

UPDATE public.metric_catalog_measures
   SET label       = 'Leads na etapa',
       description = 'Estado atual: leads em entradas abertas por etapa.'
 WHERE id = 'leads_na_etapa';

-- 4 — coluna de dinheiro: decisão explícita, não automática
-- ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_deal_id_fkey;
-- DROP INDEX IF EXISTS public.idx_sale_events_deal_id;
-- ALTER TABLE public.sale_events DROP COLUMN IF EXISTS deal_id;
