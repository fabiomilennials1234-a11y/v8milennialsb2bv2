-- rollback/20270903000010_metrica_valor_por_etapa.sql
--
-- Remove `valor_em_aberto` e `valor_perdido` do catálogo e do despachante.
--
-- ORDEM IMPORTA: o despachante volta ao corpo SEM os dois ramos ANTES de as
-- linhas de catálogo saírem, senão a guarda "medida catalogada sem ramo" da
-- 20270821240000 dispara no meio do caminho.
--
-- 🔴 Janela salva que aponte para uma das duas medidas passa a levantar
-- `unknown measure` (22023) no motor. É recuperável — o usuário remove a janela
-- — mas confira `metrics_studio_panels.layout` antes de rodar isto em prod:
--
--   SELECT o.name, w->>'metricId'
--     FROM metrics_studio_panels p
--     JOIN organizations o ON o.id = p.organization_id,
--          jsonb_array_elements(p.layout) w
--    WHERE w->>'metricId' IN ('valor_em_aberto','valor_perdido');

-- ===========================================================================
-- 1 — DESPACHANTE volta ao corpo de 20270821240000 (sem os dois ramos, sem
--     as chaves de cobertura no retorno)
-- ===========================================================================
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
    WHEN 'ltv'                    THEN public._metric_leaf_ltv(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'num_vendas_pre_venda'   THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters, true)
    WHEN 'negocios_perdidos'      THEN public._metric_leaf_sales_lost(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'ganho_perda'            THEN public._metric_leaf_ganho_perda(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_criados'          THEN public._metric_leaf_leads_criados(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_marcadas'      THEN public._metric_leaf_meetings(p_org_id, 'meeting_booked', p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_realizadas'    THEN public._metric_leaf_meetings(p_org_id, 'meeting_held',   p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'reunioes_no_show'       THEN public._metric_leaf_no_show(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'negocio')
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'lead')
    WHEN 'negocios_abertos'       THEN public._metric_leaf_negocios_abertos(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'tempo_medio_etapa'      THEN public._metric_leaf_stage_duration(p_org_id, p_recorte, p_filters)
    WHEN 'leads_sem_responsavel'  THEN public._metric_leaf_leads_sem_dono(p_org_id, p_recorte, p_filters)
    WHEN 'clientes_sem_resposta'  THEN public._metric_leaf_clientes_sem_resposta(p_org_id, p_recorte, p_filters)
    WHEN 'disparos_entregues'     THEN public._metric_leaf_automacao(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'entregues')
    WHEN 'disparos_respondidos'   THEN public._metric_leaf_automacao(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'respondidos')
    WHEN 'clientes_sem_atuacao'   THEN public._metric_leaf_clientes_sem_atuacao(p_org_id, p_recorte, p_filters)
    WHEN 'curva_abc'              THEN public._metric_leaf_curva_abc(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'leads_avaliados'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'avaliados')
    WHEN 'leads_nao_avaliados'    THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'nao_avaliados')
    WHEN 'boas_avaliacoes'        THEN public._metric_leaf_leads_qualidade(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'bons')
    WHEN 'tempo_resposta_equipe'  THEN public._metric_leaf_tempo_resposta(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
    WHEN 'negocios_coorte_origem'      THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'origem')
    WHEN 'negocios_coorte_convertidos' THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'convertidos')
    WHEN 'negocios_coorte_em_aberto'   THEN public._metric_leaf_coorte_etapa(p_org_id, p_recorte, v_bounds, v_tz, p_filters, 'em_aberto')
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

-- ===========================================================================
-- 2 — CATÁLOGO
-- ===========================================================================
DELETE FROM public.metric_catalog_measure_formats  WHERE measure_id IN ('valor_em_aberto','valor_perdido');
DELETE FROM public.metric_catalog_measure_recortes WHERE measure_id IN ('valor_em_aberto','valor_perdido');
DELETE FROM public.metric_catalog_measures         WHERE id         IN ('valor_em_aberto','valor_perdido');

-- ===========================================================================
-- 3 — LEAVES
-- ===========================================================================
DROP FUNCTION IF EXISTS public._metric_leaf_valor_em_aberto(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public._metric_leaf_valor_perdido(uuid, text, tstzrange, text, jsonb);
DROP FUNCTION IF EXISTS public._stage_is_final(uuid, uuid, text);
