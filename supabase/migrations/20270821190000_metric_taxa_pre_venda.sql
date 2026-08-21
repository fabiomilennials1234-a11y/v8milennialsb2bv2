-- 20270821190000_metric_taxa_pre_venda.sql
--
-- SCRUM-422 (decisão registrada no SCRUM-393) — "vendas com pré-venda".
--
-- A DECISÃO
--
-- CTO, 2026-08-21: pré-venda = o negócio TEM pré-vendedor. Recusadas a
-- passagem por etapa de qualificação (mede processo, e depende de
-- `pipeline_stage_events` completo, que nem toda org tem) e "SDR ≠ closer"
-- (zera em org onde a mesma pessoa faz as duas pontas, que é a maioria).
--
-- ONDE ESTÁ O PRÉ-VENDEDOR, E POR QUE NÃO É NO LEAD
--
-- O card sugeria `leads.sdr_id`. O caderno de vendas guarda melhor:
-- `sale_events.pre_sale_responsible_id` é o SNAPSHOT de quem era o pré-vendedor
-- no instante da venda. O lead pode ter trocado de SDR depois — ler de lá
-- reescreveria o passado a cada reatribuição, que é o defeito que o ADR-0017 §2
-- nomeia ao exigir snapshot no evento.
--
-- UMA MEDIDA NOVA, NENHUMA CONTA NOVA
--
-- `_metric_leaf_sales` ganhou UM parâmetro opcional (`p_so_pre_venda`, default
-- `false`) em vez de uma segunda função. Um leaf próprio teria duplicado o
-- líquido de estorno, os seis filtros e os cinco recortes — e uma segunda
-- definição de "venda que conta" é uma segunda verdade sobre dinheiro
-- (ADR-0017 §1). O default mantém as duas chamadas existentes idênticas.
--
-- A TAXA É RAZÃO, E O ×100 É DO MOTOR
--
-- `taxa_pre_venda = num_vendas_pre_venda ÷ num_vendas`. Os dois são `count`, e
-- o ramo `ratio` deriva `percent` multiplicando por 100 — que é o certo AQUI,
-- ao contrário de `negocios_por_lead` (SCRUM-392), onde a mesma derivação seria
-- o erro de 100×. A diferença não é técnica, é semântica: taxa É percentual;
-- negócios por lead não.
--
-- O numerador é SUBCONJUNTO do denominador por construção, então a razão vive
-- em [0, 100] sem precisar de trava — mesma disciplina de `taxa_qualidade`.
--
-- ROLLBACK pareado: rollback/20270821190000_metric_taxa_pre_venda.sql

-- ===========================================================================
-- 1 — CATÁLOGO
-- ===========================================================================
INSERT INTO public.metric_catalog_measures (id, label, unit, anchor, description, sort) VALUES
  ('num_vendas_pre_venda', 'Vendas com pré-venda', 'count', 'entradas',
   'Vendas líquidas de estorno cujo evento registrou pré-vendedor.', 46)
ON CONFLICT (id) DO UPDATE
  SET label = EXCLUDED.label, unit = EXCLUDED.unit,
      anchor = EXCLUDED.anchor, description = EXCLUDED.description;

-- Os mesmos recortes de `num_vendas`: é a mesma consulta com um predicado a
-- mais. Oferecer menos seria arbitrário; oferecer mais, mentira.
INSERT INTO public.metric_catalog_measure_recortes (measure_id, recorte_id)
SELECT 'num_vendas_pre_venda', r.recorte_id
FROM public.metric_catalog_measure_recortes r
WHERE r.measure_id = 'num_vendas'
ON CONFLICT DO NOTHING;

INSERT INTO public.metric_catalog_measure_formats (measure_id, format_id) VALUES
  ('num_vendas_pre_venda', 'integer')
ON CONFLICT DO NOTHING;

-- ===========================================================================
-- 2 — O LEAF DE VENDAS, com o parâmetro novo
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_sales(
  p_org_id uuid, p_agg text, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb,
  p_so_pre_venda boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  -- Contagem da base (para empty_reason). Mesma cláusula das agregações.
  SELECT count(*) INTO v_base_count
  FROM public.sale_events w
  LEFT JOIN public.leads l ON l.id = w.lead_id
  WHERE w.organization_id = p_org_id
    AND w.event_type = 'sale'
    AND w.sold_at <@ p_bounds
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                    WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
    -- SCRUM-422: pré-venda é o SNAPSHOT do evento, não a coluna do lead. O
    -- caderno guarda quem era o pré-vendedor no instante da venda; o lead pode
    -- ter trocado de SDR depois, e ler de lá reescreveria o passado.
    AND (NOT p_so_pre_venda OR w.pre_sale_responsible_id IS NOT NULL)
    AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
    AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'stream')      IS NULL OR w.revenue_stream = (p_filters->>'stream'))
    AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id')      IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
           WHERE lt.lead_id = w.lead_id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
    AND ((p_filters->>'product_id')  IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
           WHERE lp.lead_id = w.lead_id AND lp.product_id = (p_filters->>'product_id')::uuid));

  IF p_recorte = 'total' THEN
    SELECT CASE p_agg WHEN 'revenue' THEN COALESCE(SUM(w.sale_value), 0) ELSE COUNT(*) END
    INTO v_val
    FROM public.sale_events w
    LEFT JOIN public.leads l ON l.id = w.lead_id
    WHERE w.organization_id = p_org_id
      AND w.event_type = 'sale'
      AND w.sold_at <@ p_bounds
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                      WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
      -- SCRUM-422: pré-venda é o SNAPSHOT do evento, não a coluna do lead. O
      -- caderno guarda quem era o pré-vendedor no instante da venda; o lead pode
      -- ter trocado de SDR depois, e ler de lá reescreveria o passado.
      AND (NOT p_so_pre_venda OR w.pre_sale_responsible_id IS NOT NULL)
      AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
      AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
      AND ((p_filters->>'stream')      IS NULL OR w.revenue_stream = (p_filters->>'stream'))
      AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
      AND ((p_filters->>'tag_id')      IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
             WHERE lt.lead_id = w.lead_id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
      AND ((p_filters->>'product_id')  IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
             WHERE lp.lead_id = w.lead_id AND lp.product_id = (p_filters->>'product_id')::uuid));

    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'tag' THEN
    -- Recorte N:N — a linha de venda multiplica por tag. Somatório por tag.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.tag_id, 'label', COALESCE(g.tag_name, 'Sem tag'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT t.id AS tag_id, t.name AS tag_name,
             CASE p_agg WHEN 'revenue' THEN COALESCE(SUM(w.sale_value), 0) ELSE COUNT(*) END AS val
      FROM public.sale_events w
      LEFT JOIN public.leads l ON l.id = w.lead_id
      JOIN public.lead_tags lt ON lt.lead_id = w.lead_id
      JOIN public.tags t ON t.id = lt.tag_id
      WHERE w.organization_id = p_org_id
        AND w.event_type = 'sale'
        AND w.sold_at <@ p_bounds
        AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
        -- SCRUM-422: pré-venda é o SNAPSHOT do evento, não a coluna do lead. O
        -- caderno guarda quem era o pré-vendedor no instante da venda; o lead pode
        -- ter trocado de SDR depois, e ler de lá reescreveria o passado.
        AND (NOT p_so_pre_venda OR w.pre_sale_responsible_id IS NOT NULL)
        AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'stream')      IS NULL OR w.revenue_stream = (p_filters->>'stream'))
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
        AND ((p_filters->>'product_id')  IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
               WHERE lp.lead_id = w.lead_id AND lp.product_id = (p_filters->>'product_id')::uuid))
      GROUP BY t.id, t.name
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- closer | sdr | origem | stream | pipeline | tempo — chave por CASE(valor).
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'closer'   THEN (SELECT tm.name FROM public.team_members tm WHERE tm.id = g.bucket_key::uuid)
                 WHEN 'sdr'      THEN (SELECT tm.name FROM public.team_members tm WHERE tm.id = g.bucket_key::uuid)
                 WHEN 'pipeline' THEN (SELECT p.name  FROM public.pipelines p     WHERE p.id  = g.bucket_key::uuid)
                 WHEN 'tempo'    THEN to_char(g.bucket_key::date, 'DD/MM')
                 ELSE g.bucket_key
               END,
               CASE p_recorte WHEN 'closer' THEN 'Sem atribuição'
                              WHEN 'sdr' THEN 'Sem atribuição'
                              ELSE 'Sem valor' END),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'closer'   THEN w.sale_responsible_id::text
          WHEN 'sdr'      THEN w.pre_sale_responsible_id::text
          WHEN 'origem'   THEN l.origin
          WHEN 'stream'   THEN w.revenue_stream
          WHEN 'pipeline' THEN w.pipeline_id::text
          WHEN 'tempo'    THEN to_char(w.sold_at AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        CASE p_agg WHEN 'revenue' THEN COALESCE(SUM(w.sale_value), 0) ELSE COUNT(*) END AS val
      FROM public.sale_events w
      LEFT JOIN public.leads l ON l.id = w.lead_id
      WHERE w.organization_id = p_org_id
        AND w.event_type = 'sale'
        AND w.sold_at <@ p_bounds
        AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                        WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
        -- SCRUM-422: pré-venda é o SNAPSHOT do evento, não a coluna do lead. O
        -- caderno guarda quem era o pré-vendedor no instante da venda; o lead pode
        -- ter trocado de SDR depois, e ler de lá reescreveria o passado.
        AND (NOT p_so_pre_venda OR w.pre_sale_responsible_id IS NOT NULL)
        AND ((p_filters->>'pipeline_id') IS NULL OR w.pipeline_id = (p_filters->>'pipeline_id')::uuid)
        AND ((p_filters->>'member_id')   IS NULL OR w.sale_responsible_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'stream')      IS NULL OR w.revenue_stream = (p_filters->>'stream'))
        AND ((p_filters->>'origin')      IS NULL OR l.origin = (p_filters->>'origin'))
        AND ((p_filters->>'tag_id')      IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
               WHERE lt.lead_id = w.lead_id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
        AND ((p_filters->>'product_id')  IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
               WHERE lp.lead_id = w.lead_id AND lp.product_id = (p_filters->>'product_id')::uuid))
      GROUP BY 1
    ) g;

    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;


COMMENT ON FUNCTION public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean) IS
  'Vendas líquidas de estorno, no agregado pedido. `p_so_pre_venda` restringe ao evento que registrou pré-vendedor (SCRUM-422) — o snapshot do caderno, não a coluna do lead.';

-- ===========================================================================
-- 3 — DESPACHANTE (corpo vigente de 20270821170000 + UM ramo)
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
-- 3.1 — A DE SEIS ARGUMENTOS SAI
-- ===========================================================================
-- Obrigatório, e não limpeza: com as duas vivas, `_metric_leaf_sales(a,b,c,d,e,f)`
-- casa com AS DUAS (a nova tem default no 7º) e o Postgres recusa a chamada com
-- "function is not unique". Sai DEPOIS de o despachante já apontar para a nova.
DROP FUNCTION IF EXISTS public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb);

-- ===========================================================================
-- 4 — GRANTS + GUARDA
-- ===========================================================================
-- A assinatura MUDOU (ganhou o 7º parâmetro), então os grants da antiga não
-- valem para a nova: é outra função no catálogo do Postgres.
REVOKE EXECUTE ON FUNCTION public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)
  TO service_role;

DO $guard$
DECLARE
  v_fn regprocedure;
  v_fns regprocedure[] := ARRAY[
    'public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb, boolean)'::regprocedure,
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

  SELECT string_agg(m.id, ', ') INTO v_sem_ramo
  FROM public.metric_catalog_measures m
  WHERE position('''' || m.id || '''' IN pg_get_functiondef(
          'public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)'::regprocedure)) = 0;

  IF v_sem_ramo IS NOT NULL THEN
    RAISE EXCEPTION 'GUARDA: medida(s) catalogada(s) sem ramo no despachante: %', v_sem_ramo;
  END IF;
END
$guard$;
