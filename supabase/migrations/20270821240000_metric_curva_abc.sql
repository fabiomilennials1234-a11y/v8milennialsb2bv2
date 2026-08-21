-- 20270821240000_metric_curva_abc.sql
--
-- SCRUM-418 (decisão registrada no SCRUM-365) — curva ABC de produtos.
--
-- A DECISÃO
--
-- CTO, 2026-08-21: régua 80/15/5 por RECEITA ACUMULADA. Ordena produtos por
-- receita na janela, acumula, e corta em 80% (A), 95% (B), 100% (C).
--
-- Hoje existe ranking bruto em `ProductRanking`; o que falta é a classificação.
--
-- 🔴 A FONTE NÃO É `sale_events`, E ISSO TEM CONSEQUÊNCIA
--
-- Receita POR PRODUTO só existe em `pipe_proposta_items` — o caderno de vendas
-- (`sale_events`) guarda o valor da venda, não a quebra por item. É a mesma
-- fonte que `get_product_ranking` já usa, e usar outra criaria dois rankings
-- de produto que discordam.
--
-- O que isso custa, dito na frente: esta medida NÃO É LÍQUIDA DE ESTORNO. Item
-- de proposta não tem conceito de estorno — quem estorna é o evento de venda, e
-- ele não sabe de item. Uma venda estornada continua contando na curva até
-- alguém apagar os itens.
--
-- Consequência prática: a curva responde "onde meu faturamento se concentra",
-- não "quanto entrou". Para "quanto entrou" existe `receita`, que é líquida.
-- Cruzar as duas e achar diferença é ESPERADO, não defeito.
--
-- A CLASSE VIAJA NO RÓTULO
--
-- A série devolve `A · Nome do produto`, e não uma coluna extra, porque o
-- contrato de série do motor é `{key, label, value}` — mexer nele mudaria TODA
-- medida. A classe no rótulo aparece no gráfico e na tabela sem nenhuma
-- mudança no front.
--
-- EMPATE NA FRONTEIRA
--
-- O corte é pelo acumulado APÓS incluir o produto: quem cruza os 80% ainda é A,
-- e o próximo é B. Sem isso, um produto que sozinho representa 85% cairia em B
-- e a classe A ficaria vazia — que é o resultado que faz alguém desconfiar da
-- tela inteira.
--
-- ROLLBACK pareado: rollback/20270821240000_metric_curva_abc.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('curva_abc', 'Curva ABC de produtos', 'currency', 'entradas',
   'Produtos ordenados por receita, classificados em A (80%), B (95%) e C pelo acumulado.', 52)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

-- Só `produto`: a curva É a série por produto. `total` daria a soma da receita
-- de itens, que já é `receita` por outro caminho — e por um caminho que, ao
-- contrário deste, é líquido de estorno.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('curva_abc', 'produto')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('curva_abc', 'currency_brl')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — O LEAF
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_curva_abc(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb;
  v_base bigint;
BEGIN
  IF p_recorte <> 'produto' THEN
    RAISE EXCEPTION 'recorte % incompatible with measure curva_abc', p_recorte
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_base
  FROM public.pipe_proposta_items ppi
  JOIN public.pipeline_entries pe ON pe.id = ppi.pipe_proposta_id
  WHERE pe.organization_id = p_org_id
    AND pe.stage_key = 'vendido'
    AND COALESCE(pe.closed_at, pe.entered_at) <@ p_bounds;

  WITH por_produto AS (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(COALESCE(ppi.sale_value, 0)) AS receita
    FROM public.pipe_proposta_items ppi
    JOIN public.pipeline_entries pe ON pe.id = ppi.pipe_proposta_id
    JOIN public.products p ON p.id = ppi.product_id
    WHERE pe.organization_id = p_org_id
      AND pe.stage_key = 'vendido'
      AND COALESCE(pe.closed_at, pe.entered_at) <@ p_bounds
      AND ((p_filters->>'product_id') IS NULL OR p.id = (p_filters->>'product_id')::uuid)
    GROUP BY p.id, p.name
    HAVING SUM(COALESCE(ppi.sale_value, 0)) > 0
  ),
  acumulado AS (
    SELECT
      product_id, product_name, receita,
      -- Acumulado APÓS incluir este produto. É o que faz o produto que cruza a
      -- fronteira pertencer à classe de cima.
      SUM(receita) OVER (ORDER BY receita DESC, product_name)
        / NULLIF(SUM(receita) OVER (), 0) AS fracao
    FROM por_produto
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', a.product_id,
           'label', a.classe || ' · ' || a.product_name,
           'value', a.receita
         ) ORDER BY a.receita DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      product_id, product_name, receita,
      CASE
        WHEN fracao <= 0.80 THEN 'A'
        WHEN fracao <= 0.95 THEN 'B'
        ELSE 'C'
      END AS classe
    FROM acumulado
  ) a;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb) IS
  'SCRUM-418 — produtos por receita acumulada, classe A/B/C na régua 80/15/5. Fonte pipe_proposta_items (a única com receita POR ITEM); NÃO é líquida de estorno, e o cabeçalho da migration diz por quê.';

-- ===========================================================================
-- 3 — DESPACHANTE (corpo vigente de 20270821230000 + UM ramo)
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
    -- SCRUM-316. As três partilham a MESMA coorte; ver o cabeçalho da 20270821120000.
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
-- 4 — GRANTS + GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_curva_abc(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_sem_ramo text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: anon executa % — interno do motor não pode', v_fn;
    END IF;
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: authenticated executa % — interno do motor não pode', v_fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'GUARDA: service_role NÃO executa % — o motor não roda', v_fn;
    END IF;
  END LOOP;

  v_def := pg_get_functiondef(
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure);

  SELECT string_agg(m.id, ', ') INTO v_sem_ramo
  FROM public.metric_catalog_measures m
  WHERE position(quote_literal(m.id) IN v_def) = 0;

  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida(s) catalogada(s) sem ramo no despachante: %', v_sem_ramo;
  END IF;
END
$guard$;
