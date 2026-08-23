-- 20270821200000_metric_ltv.sql
--
-- SCRUM-417 (decisão registrada no SCRUM-365) — LTV do cliente.
--
-- A DECISÃO
--
-- CTO, 2026-08-21: LTV = RECEITA REALIZADA por cliente, janela de 12 meses.
-- Soma das vendas líquidas de estorno nos últimos 12 meses, dividida pelo
-- número de clientes com ao menos uma compra na janela.
--
-- Recusadas: "vida inteira" (incomparável entre org nova e antiga, e insensível
-- a queda recente) e manter `useAnalyticsOverview.UnitEconomics.ltv_estimate`
-- (é ESTIMATIVA — ninguém consegue auditar, e o Estúdio existe para acabar com
-- número que não fecha com o resto).
--
-- A JANELA É PRÓPRIA, E ISSO PRECISA ESTAR VISÍVEL
--
-- Os 12 meses NÃO são o período do painel: são uma janela própria, ancorada no
-- FIM do período escolhido. Um gestor que troca o seletor de "este mês" para
-- "este ano" vê o LTV mudar pouco — e tem que ser assim, porque LTV de um mês
-- não existe. Sem esta nota, o número parece quebrado.
--
-- COMPÕE A RECEITA, NÃO A RECALCULA
--
-- O numerador sai de `_metric_leaf_sales(..., 'revenue', 'total', janela12m,
-- ...)` — a MESMA função de Faturamento. Receita é área frágil com ADR próprio
-- e consumidores legados; uma segunda soma seria uma segunda verdade sobre
-- dinheiro (ADR-0017 §1). Só o DENOMINADOR é conta nova, e ele é contagem de
-- gente, não de dinheiro.
--
-- QUEM É "CLIENTE" AQUI
--
-- O `lead_id` do evento de venda. No modelo do produto, lead que comprou É
-- cliente — `upsell_clients` é a projeção de carteira, não a identidade. Contar
-- por lá deixaria de fora quem comprou e ainda não foi promovido, e o LTV
-- subiria por exclusão de denominador.
--
-- ROLLBACK pareado: rollback/20270821200000_metric_ltv.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('ltv', 'LTV do cliente', 'currency', 'entradas',
   'Receita realizada por cliente nos 12 meses que terminam no período escolhido.', 47)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

-- Só `total`. Recortar LTV por origem ou por closer dividiria receitas de um
-- balde pelo denominador de outro — número plausível e errado.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('ltv', 'total')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('ltv', 'currency_brl')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — O LEAF
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_ltv(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_fim timestamptz;
  v_janela tstzrange;
  v_receita numeric;
  v_clientes bigint;
BEGIN
  IF p_recorte <> 'total' THEN
    RAISE EXCEPTION 'recorte % incompatible with measure ltv', p_recorte
      USING ERRCODE = '22023';
  END IF;

  -- A janela dos 12 meses termina onde o período escolhido termina. Ancorar no
  -- INÍCIO faria "este mês" olhar 12 meses atrás do dia 1º e ignorar o próprio
  -- mês — o cliente que comprou ontem sumiria da conta.
  v_fim := upper(p_bounds);
  v_janela := tstzrange(v_fim - interval '12 months', v_fim, '[)');

  -- Receita pela MESMA função de Faturamento. Ver o cabeçalho.
  v_receita := (public._metric_leaf_sales(
                  p_org_id, 'revenue', 'total', v_janela, p_tz, p_filters) ->> 'value')::numeric;

  -- Denominador: gente, não dinheiro. Distinct de lead com venda VIVA na
  -- janela — o mesmo predicado de estorno, porque cliente cuja única venda foi
  -- estornada não é cliente.
  SELECT count(DISTINCT w.lead_id) INTO v_clientes
  FROM public.sale_events w
  LEFT JOIN public.leads l ON l.id = w.lead_id
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale'
    AND w.sold_at <@ v_janela
    AND w.lead_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                    WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
    AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'stream')      IS NULL OR w.revenue_stream = (p_filters->>'stream'))
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'));

  -- Zero cliente é AUSÊNCIA, não zero reais. "R$ 0,00 de LTV" afirma que os
  -- clientes não compraram; a verdade é que não houve cliente na janela.
  IF COALESCE(v_clientes, 0) = 0 THEN
    RETURN jsonb_build_object('value', NULL, 'series', NULL, 'empty_reason', 'no_rows');
  END IF;

  RETURN jsonb_build_object(
    'value', round(COALESCE(v_receita, 0) / v_clientes, 2),
    'series', NULL,
    'empty_reason', NULL);
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb) IS
  'SCRUM-417 — receita realizada por cliente nos 12 meses que terminam no período escolhido. Numerador COMPÕE _metric_leaf_sales (uma só verdade sobre dinheiro); denominador conta leads distintos com venda viva.';

-- ===========================================================================
-- 3 — DESPACHANTE (corpo vigente de 20270821190000 + UM ramo)
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
REVOKE EXECUTE ON FUNCTION public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_ltv(uuid, text, tstzrange, text, jsonb)'::regprocedure,
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
