-- 20270821170000_metric_ganho_perda.sql
--
-- SCRUM-391, metade FUNIL: "Ganho e perda" entra no catálogo do motor.
--
-- A OUTRA METADE JÁ EXISTIA, e não vira SQL nenhum
--
-- `negocios_por_funil` é a decisão G2 do grill: o corte é escolha do usuário,
-- não atributo da métrica. "Negócios por funil" É `negocios_na_etapa` com corte
-- `pipeline`, que o motor já aceita. Portá-la como medida própria reimplementaria
-- o mesmo GROUP BY com outro nome.
--
-- ESTA MEDIDA É COMPOSIÇÃO, NÃO CONTA NOVA
--
-- O card mandava conferir se `ganho_perda` não era a composição de duas medidas
-- que já estão no motor. É:
--
--   ganhos  = `_metric_leaf_sales(..., 'count', ...)`  — o mesmo de num_vendas,
--             LÍQUIDO de estorno
--   perdas  = `_metric_leaf_sales_lost(...)`           — o mesmo de negocios_perdidos
--
-- O leaf abaixo CHAMA as duas em vez de reescrever o predicado. Não é economia
-- de linhas: é a única forma de a soma continuar batendo quando alguém mexer no
-- líquido de estorno. Reimplementar aqui criaria a terceira definição de "venda
-- que conta", e dinheiro não comporta terceira definição (ADR-0017 §1).
--
-- RECORTE NOVO: `desfecho`
--
-- A medida existe para mostrar DOIS baldes lado a lado, e o motor só produz
-- série a partir de um recorte. `desfecho` é o décimo primeiro do vocabulário
-- fechado, e serve só a esta medida por enquanto.
--
-- Ela NÃO oferece `total`, e isso é deliberado: "o total de ganho e perda"
-- somaria vendas com perdas num número que não responde pergunta nenhuma.
-- Precedente vivo: `tempo_medio_etapa` também não tem `total`.
--
-- INVARIANTE (ADR-0023 §3): zero EXECUTE. SQL estático, filtro ligado como
-- parâmetro — e, aqui, nem SQL novo: duas chamadas de função.
--
-- ROLLBACK pareado: rollback/20270821170000_metric_ganho_perda.sql

-- ===========================================================================
-- 1 — VOCABULÁRIO: o recorte `desfecho`
-- ===========================================================================
INSERT INTO public.metric_catalog_recortes (id, label, sort) VALUES
  ('desfecho', 'Por desfecho', 110)
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;

-- ===========================================================================
-- 2 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('ganho_perda', 'Ganho e perda', 'count', 'entradas',
   'Negócios ganhos contra perdidos na janela. Ganhos são líquidos de estorno.', 45)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id) VALUES
  ('ganho_perda', 'desfecho')
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('ganho_perda', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 3 — O LEAF, que compõe em vez de recontar
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_ganho_perda(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_ganhos numeric;
  v_perdas numeric;
BEGIN
  -- Recorte fora do conjunto falha ALTO. Devolver a série de `desfecho` para um
  -- pedido de `origem` seria responder outra pergunta com cara de resposta.
  IF p_recorte <> 'desfecho' THEN
    RAISE EXCEPTION 'recorte % incompatible with measure ganho_perda', p_recorte
      USING ERRCODE = '22023';
  END IF;

  -- As MESMAS funções que servem num_vendas e negocios_perdidos, no recorte
  -- total. Se o líquido de estorno mudar lá, muda aqui junto — que é o ponto.
  v_ganhos := (public._metric_leaf_sales(p_org_id, 'count', 'total', p_bounds, p_tz, p_filters) ->> 'value')::numeric;
  v_perdas := (public._metric_leaf_sales_lost(p_org_id, 'total', p_bounds, p_tz, p_filters) ->> 'value')::numeric;

  -- Zero é RESPOSTA aqui, não ausência: "nenhuma perda no mês" é informação, e
  -- some se o balde não for desenhado. Ausência é quando NÃO HOUVE NADA — os
  -- dois nulos ou os dois zerados.
  IF COALESCE(v_ganhos, 0) = 0 AND COALESCE(v_perdas, 0) = 0 THEN
    RETURN jsonb_build_object('value', NULL, 'series', '[]'::jsonb,
      'empty_reason', 'no_rows');
  END IF;

  RETURN jsonb_build_object(
    'value', NULL,
    'series', jsonb_build_array(
      jsonb_build_object('key', 'ganho', 'label', 'Ganhos', 'value', COALESCE(v_ganhos, 0)),
      jsonb_build_object('key', 'perda', 'label', 'Perdas', 'value', COALESCE(v_perdas, 0))
    ),
    'empty_reason', NULL
  );
END;
$$;

COMMENT ON FUNCTION public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb) IS
  'SCRUM-391 — ganhos (líquidos de estorno) contra perdas na janela. COMPÕE _metric_leaf_sales e _metric_leaf_sales_lost em vez de recontar: uma terceira definição de venda que conta seria uma terceira verdade sobre dinheiro.';

-- ===========================================================================
-- 4 — DESPACHANTE (corpo vigente de 20270821120000 + UM ramo)
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
    WHEN 'num_vendas'             THEN public._metric_leaf_sales(p_org_id, 'count',   p_recorte, v_bounds, v_tz, p_filters)
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
-- 5 — GRANTS + GUARDA
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_ganho_perda(uuid, text, tstzrange, text, jsonb)'::regprocedure,
    'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure
  ];
  v_sem_ramo text;
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

  -- O wrapper público continua acessível: se um REVOKE vazar para ele, o
  -- Estúdio inteiro para.
  IF NOT has_function_privilege(
       'authenticated',
       'public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'GUARDA: authenticated perdeu fn_metric_measure';
  END IF;

  -- Medida catalogada SEM ramo no CASE cai no NULL implícito e o motor
  -- levanta 22023 só quando alguém abrir a janela. Falhar no apply é melhor.
  SELECT string_agg(m.id, ', ') INTO v_sem_ramo
  FROM public.metric_catalog_measures m
  WHERE position('''' || m.id || '''' IN pg_get_functiondef(
          'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure)) = 0;

  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida(s) catalogada(s) sem ramo no despachante: %', v_sem_ramo;
  END IF;
END
$guard$;
