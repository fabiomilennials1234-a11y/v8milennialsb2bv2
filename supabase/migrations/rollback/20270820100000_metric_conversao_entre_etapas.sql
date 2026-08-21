-- ===========================================================================
-- ROLLBACK — 20270820100000_metric_conversao_entre_etapas.sql (SCRUM-316)
-- ===========================================================================
-- Ordem: despachante PRIMEIRO (para de apontar), depois a função, depois o
-- catálogo. Inverter isso deixaria o despachante chamando função inexistente
-- entre dois statements.
--
-- ⚠ NÃO apaga `pipeline_stage_events` nem toca em dado de cliente: esta
-- migration só leu o caderno. O índice cai porque nasceu aqui.
-- ===========================================================================

-- 1 — Despachante volta ao corpo de 20270813100000 (16 medidas, sem as 3 da coorte).
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
    WHEN 'negocios_na_etapa'      THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'negocio')
    WHEN 'leads_na_etapa'         THEN public._metric_leaf_stage_snapshot(p_org_id, p_recorte, p_filters, 'lead')
    WHEN 'negocios_abertos'       THEN public._metric_leaf_negocios_abertos(p_org_id, p_recorte, v_bounds, v_tz, p_filters)
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

-- 2 — Allowlist da árvore volta às 6 chaves.
--
-- 🔴 CÓPIA LITERAL do corpo de 20270813110000:129 — o estado ANTERIOR a esta
-- fatia. A única diferença para o corpo da 20270820100000 é o `NOT IN` da
-- allowlist, sem as duas chaves de etapa. Tudo o mais (teto de literal 1e12,
-- exigência de recorte `total` no operando, presença de left/right, tipo do
-- literal) tem de continuar aqui: um rollback que "simplifica" o corpo desfaz
-- validações que nunca foram desta fatia.
CREATE OR REPLACE FUNCTION public._metric_tree_unit(p_node jsonb, p_depth int)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_tipo text; v_op text; v_id text; v_unit text;
  v_left text; v_right text; v_chave text; v_valor numeric;
BEGIN
  IF p_node IS NULL OR jsonb_typeof(p_node) <> 'object' THEN
    RAISE EXCEPTION 'nó da árvore não é objeto' USING ERRCODE = '22023';
  END IF;

  v_tipo := p_node->>'type';

  IF v_tipo = 'literal' THEN
    IF jsonb_typeof(p_node->'value') <> 'number' THEN
      RAISE EXCEPTION 'literal sem valor numérico' USING ERRCODE = '22023';
    END IF;
    v_valor := (p_node->>'value')::numeric;
    IF abs(v_valor) > 1e12 THEN
      RAISE EXCEPTION 'literal % fora do intervalo permitido (|x| ≤ 1e12)', v_valor
        USING ERRCODE = '22023';
    END IF;
    RETURN 'number';
  END IF;

  IF v_tipo = 'measure' THEN
    v_id := p_node->>'id';
    SELECT m.unit INTO v_unit FROM public.metric_catalog_measures m WHERE m.id = v_id;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'medida % não existe no catálogo', COALESCE(v_id, '(nula)')
        USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.metric_catalog_measure_recortes mr
      WHERE mr.measure_id = v_id AND mr.recorte_id = 'total'
    ) THEN
      RAISE EXCEPTION 'medida % não aceita o recorte total e não serve de operando', v_id
        USING ERRCODE = '22023';
    END IF;

    IF p_node ? 'filters' THEN
      IF jsonb_typeof(p_node->'filters') <> 'object' THEN
        RAISE EXCEPTION 'filtros da medida % não são objeto', v_id USING ERRCODE = '22023';
      END IF;
      FOR v_chave IN SELECT jsonb_object_keys(p_node->'filters') LOOP
        IF v_chave NOT IN ('pipeline_id','member_id','origin','tag_id','product_id','stream') THEN
          RAISE EXCEPTION 'filtro % não está na allowlist', v_chave USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;

    RETURN v_unit;
  END IF;

  IF v_tipo = 'op' THEN
    IF p_depth > 3 THEN
      RAISE EXCEPTION 'árvore excede a profundidade máxima de 3' USING ERRCODE = '22023';
    END IF;

    v_op := p_node->>'op';
    IF NOT (p_node ? 'left' AND p_node ? 'right') THEN
      RAISE EXCEPTION 'operação % sem os dois operandos', COALESCE(v_op, '(nulo)')
        USING ERRCODE = '22023';
    END IF;

    v_left  := public._metric_tree_unit(p_node->'left',  p_depth + 1);
    v_right := public._metric_tree_unit(p_node->'right', p_depth + 1);
    RETURN public._metric_tree_op_unit(v_op, v_left, v_right);
  END IF;

  RAISE EXCEPTION 'tipo de nó % desconhecido (use measure, literal ou op)',
    COALESCE(v_tipo, '(nulo)') USING ERRCODE = '22023';
END;
$$;

-- 3 — Função da coorte e índice.
DROP FUNCTION IF EXISTS public._metric_leaf_coorte_etapa(uuid, text, tstzrange, text, jsonb, text);
DROP INDEX IF EXISTS public.idx_pipeline_stage_events_coorte;

-- 4 — Catálogo. A razão sai antes das medidas (FK).
DELETE FROM public.metric_catalog_ratios WHERE id = 'conversao_entre_etapas';
DELETE FROM public.metric_catalog_measure_formats
 WHERE measure_id IN ('negocios_coorte_origem','negocios_coorte_convertidos','negocios_coorte_em_aberto');
DELETE FROM public.metric_catalog_measure_recortes
 WHERE measure_id IN ('negocios_coorte_origem','negocios_coorte_convertidos','negocios_coorte_em_aberto');
DELETE FROM public.metric_catalog_measures
 WHERE id IN ('negocios_coorte_origem','negocios_coorte_convertidos','negocios_coorte_em_aberto');

-- ⚠ Painel salvo que referencie a razão apagada passa a cair na validação de
-- `validate_widget_against_catalog`. Se houver painel em uso, remover o widget
-- ANTES de rodar este rollback.
