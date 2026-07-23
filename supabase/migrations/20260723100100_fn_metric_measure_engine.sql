-- 20260723100100_fn_metric_measure_engine.sql
--
-- ISSUE #1194 (PRD #986 · ADR-0023) — Métricas Montáveis, Camada 2, fatia 2/5.
-- O MOTOR. Despacho sobre conjunto fechado, ZERO EXECUTE.
--
-- INVARIANTE INEGOCIÁVEL (1º mandamento do CTO, gate bloqueante do Crivo + grep
-- no CI): NENHUM `EXECUTE`, nenhum `format()`-into-query, nenhuma concatenação
-- de identificador dentro do motor. O recorte e o modo de agregação escolhem
-- ramo por um `CASE` sobre o VALOR do parâmetro — que é dado, não código. A
-- chave de agrupamento é uma coluna calculada por CASE; a lista de GROUP BY é
-- fixa. Filtros entram SEMPRE LIGADOS (bind), no padrão dos 4 leitores
-- canônicos: `(p_filters->>'x') IS NULL OR col = (p_filters->>'x')::tipo`.
--
-- ATERRAMENTO (colunas REAIS, verificado contra o baseline de prod):
--   receita/num_vendas  → sale_events (event_type='sale', líquido de estorno,
--                         sold_at <@ bounds). closer=sale_responsible_id,
--                         sdr=pre_sale_responsible_id, stream=revenue_stream.
--   leads_criados       → leads, COALESCE(metrics_period_at, created_at),
--                         deleted_at IS NULL.
--   reunioes_marcadas   → meeting_events event_type='meeting_booked' (occurred_at).
--   reunioes_realizadas → meeting_events event_type='meeting_held'
--                         (COALESCE(meeting_date, occurred_at)).
--   leads_na_etapa      → pipeline_entries abertas (snapshot, sem período).
--   tempo_medio_etapa   → pipeline_stage_events, dwell desde a última transição.
--
-- Período: metric_period_bounds(org, period, ref, start, end) → tstzrange, na
-- timezone da org. Vocabulário REAL: day|week|month|range (o macro citava
-- today/custom; a fonte de verdade é metric_period_bounds).
--
-- COMISSÃO/CARTEIRA: o motor SÓ LÊ. Não projeta comissão. `receita` é recortável
-- por `stream` (novo_negocio/carteira) — comissão nunca inclui carteira em
-- silêncio; projeção segue OFF p/ producer=carteira (ADR §Riscos).
--
-- ROLLBACK pareado: rollback/20260723100100_fn_metric_measure_engine.sql (DROPs).

-- ===========================================================================
-- 1. Leaf de VENDA — receita e num_vendas (mesmas linhas, agg diferente)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_sales(
  p_org_id uuid, p_agg text, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
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

-- ===========================================================================
-- 2. Leaf de LEADS CRIADOS
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_leads_criados(
  p_org_id uuid, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_val numeric; v_series jsonb; v_base_count bigint;
BEGIN
  SELECT count(*) INTO v_base_count
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.deleted_at IS NULL
    AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
    AND ((p_filters->>'member_id')  IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')     IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id')     IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
           WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
    AND ((p_filters->>'product_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
           WHERE lp.lead_id = l.id AND lp.product_id = (p_filters->>'product_id')::uuid));

  IF p_recorte = 'total' THEN
    v_val := v_base_count;
    RETURN jsonb_build_object('value', v_val, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'tag' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.tag_id, 'label', COALESCE(g.tag_name, 'Sem tag'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT t.id AS tag_id, t.name AS tag_name, COUNT(*) AS val
      FROM public.leads l
      JOIN public.lead_tags lt ON lt.lead_id = l.id
      JOIN public.tags t ON t.id = lt.tag_id
      WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
        AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY t.id, t.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'produto' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.product_id, 'label', COALESCE(g.product_name, 'Sem produto'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT p.id AS product_id, p.name AS product_name, COUNT(DISTINCT l.id) AS val
      FROM public.leads l
      JOIN public.lead_products lp ON lp.lead_id = l.id
      JOIN public.products p ON p.id = lp.product_id
      WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
        AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
      GROUP BY p.id, p.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- origem | tempo
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM') ELSE g.bucket_key END,
               'Sem valor'),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'origem' THEN l.origin
          WHEN 'tempo'  THEN to_char(COALESCE(l.metrics_period_at, l.created_at) AT TIME ZONE p_tz, 'YYYY-MM-DD')
        END AS bucket_key,
        COUNT(*) AS val
      FROM public.leads l
      WHERE l.organization_id = p_org_id AND l.deleted_at IS NULL
        AND COALESCE(l.metrics_period_at, l.created_at) <@ p_bounds
        AND ((p_filters->>'member_id') IS NULL OR l.responsible_user_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
        AND ((p_filters->>'tag_id')    IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
               WHERE lt.lead_id = l.id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
        AND ((p_filters->>'product_id') IS NULL OR EXISTS (SELECT 1 FROM public.lead_products lp
               WHERE lp.lead_id = l.id AND lp.product_id = (p_filters->>'product_id')::uuid))
      GROUP BY 1
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- ===========================================================================
-- 3. Leaf de REUNIÕES (booked | held) — event_type parametrizado por valor
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_meetings(
  p_org_id uuid, p_event_type text, p_recorte text, p_bounds tstzrange, p_tz text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint;
BEGIN
  -- Held ancora em COALESCE(meeting_date, occurred_at); booked em occurred_at.
  -- A escolha é por CASE sobre o VALOR de p_event_type (não é identificador).
  SELECT count(*) INTO v_base_count
  FROM public.meeting_events me
  LEFT JOIN public.leads l ON l.id = me.lead_id
  WHERE me.organization_id = p_org_id
    AND me.event_type = p_event_type
    AND (CASE WHEN p_event_type = 'meeting_held'
              THEN COALESCE(me.meeting_date, me.occurred_at) ELSE me.occurred_at END) <@ p_bounds
    AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
    AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
    AND ((p_filters->>'tag_id')    IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
           WHERE lt.lead_id = me.lead_id AND lt.tag_id = (p_filters->>'tag_id')::uuid));

  IF p_recorte = 'total' THEN
    RETURN jsonb_build_object('value', v_base_count, 'series', NULL,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSIF p_recorte = 'tag' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.tag_id, 'label', COALESCE(g.tag_name, 'Sem tag'), 'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT t.id AS tag_id, t.name AS tag_name, COUNT(*) AS val
      FROM public.meeting_events me
      JOIN public.lead_tags lt ON lt.lead_id = me.lead_id
      JOIN public.tags t ON t.id = lt.tag_id
      WHERE me.organization_id = p_org_id AND me.event_type = p_event_type
        AND (CASE WHEN p_event_type = 'meeting_held'
                  THEN COALESCE(me.meeting_date, me.occurred_at) ELSE me.occurred_at END) <@ p_bounds
        AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
      GROUP BY t.id, t.name
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);

  ELSE
    -- sdr | origem | tempo
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'key', g.bucket_key,
             'label', COALESCE(
               CASE p_recorte
                 WHEN 'sdr'   THEN (SELECT tm.name FROM public.team_members tm WHERE tm.id = g.bucket_key::uuid)
                 WHEN 'tempo' THEN to_char(g.bucket_key::date, 'DD/MM')
                 ELSE g.bucket_key
               END,
               CASE p_recorte WHEN 'sdr' THEN 'Sem atribuição' ELSE 'Sem valor' END),
             'value', g.val
           ) ORDER BY g.val DESC), '[]'::jsonb)
    INTO v_series
    FROM (
      SELECT
        CASE p_recorte
          WHEN 'sdr'    THEN me.pre_sale_responsible_id::text
          WHEN 'origem' THEN l.origin
          WHEN 'tempo'  THEN to_char(
            (CASE WHEN p_event_type = 'meeting_held'
                  THEN COALESCE(me.meeting_date, me.occurred_at) ELSE me.occurred_at END) AT TIME ZONE p_tz,
            'YYYY-MM-DD')
        END AS bucket_key,
        COUNT(*) AS val
      FROM public.meeting_events me
      LEFT JOIN public.leads l ON l.id = me.lead_id
      WHERE me.organization_id = p_org_id AND me.event_type = p_event_type
        AND (CASE WHEN p_event_type = 'meeting_held'
                  THEN COALESCE(me.meeting_date, me.occurred_at) ELSE me.occurred_at END) <@ p_bounds
        AND ((p_filters->>'member_id') IS NULL OR me.pre_sale_responsible_id = (p_filters->>'member_id')::uuid)
        AND ((p_filters->>'origin')    IS NULL OR l.origin = (p_filters->>'origin'))
        AND ((p_filters->>'tag_id')    IS NULL OR EXISTS (SELECT 1 FROM public.lead_tags lt
               WHERE lt.lead_id = me.lead_id AND lt.tag_id = (p_filters->>'tag_id')::uuid))
      GROUP BY 1
    ) g;
    RETURN jsonb_build_object('value', NULL, 'series', v_series,
      'empty_reason', CASE WHEN v_base_count = 0 THEN 'no_rows' ELSE NULL END);
  END IF;
END;
$$;

-- ===========================================================================
-- 4. Leaf de LEADS NA ETAPA (snapshot — sem período)
-- ===========================================================================
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
    -- pipeline | etapa
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

-- ===========================================================================
-- 5. Leaf de TEMPO MÉDIO NA ETAPA (dwell atual, snapshot)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf_stage_duration(
  p_org_id uuid, p_recorte text, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_series jsonb; v_base_count bigint;
BEGIN
  -- Última transição por (lead, pipeline) = etapa atual + instante de entrada.
  -- dwell = now() - occurred_at (segundos). Média por recorte.
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

-- ===========================================================================
-- 6. Dispatcher interno — valida recorte, deriva unit/anchor, roteia
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._metric_leaf(
  p_org_id uuid, p_measure_id text, p_recorte text,
  p_period text, p_ref date, p_start date, p_end date, p_filters jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_unit text; v_anchor text; v_tz text; v_bounds tstzrange; v_leaf jsonb;
BEGIN
  -- Medida do catálogo. Ausente → erro (medida sem âncora não existe).
  SELECT m.unit, m.anchor INTO v_unit, v_anchor
  FROM public.metric_catalog_measures m WHERE m.id = p_measure_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'unknown measure %', p_measure_id USING ERRCODE = '22023';
  END IF;

  -- Recorte precisa ser compatível com a medida (defesa dupla; o trigger da
  -- composição já barra na escrita, mas o motor não confia no chamador).
  IF NOT EXISTS (
    SELECT 1 FROM public.metric_catalog_measure_recortes mr
    WHERE mr.measure_id = p_measure_id AND mr.recorte_id = p_recorte
  ) THEN
    RAISE EXCEPTION 'recorte % incompatible with measure %', p_recorte, p_measure_id
      USING ERRCODE = '22023';
  END IF;

  -- Timezone da org (para buckets temporais) — reusa o mesmo lookup do
  -- metric_period_bounds. Snapshots (anchor='hoje') não precisam de bounds.
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
    'measure_id', p_measure_id,
    'unit', v_unit,
    'currency', CASE WHEN v_unit = 'currency' THEN 'BRL' ELSE NULL END,
    'anchor', v_anchor,
    'recorte', p_recorte,
    'value',   v_leaf->'value',
    'series',  v_leaf->'series',
    'empty_reason', v_leaf->>'empty_reason'
  );
END;
$$;

-- ===========================================================================
-- 7. Wrapper público — assert_org_access 1ª instrução, leaf | ratio
-- ===========================================================================
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
  -- 1ª INSTRUÇÃO — gate de tenancy (padrão canônico ADR-0017).
  PERFORM public.assert_org_access(p_org_id);

  v_kind := COALESCE(p_measure_ref->>'kind', 'leaf');

  -- Rótulo de período para provenance (best-effort; snapshots não têm bounds).
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
    -- Profundidade EXATAMENTE 1, EXATAMENTE 2 filhos. Razão é escalar (total).
    v_num := public._metric_leaf(p_org_id, p_measure_ref->>'num', 'total',
                                 p_period, p_ref, p_start, p_end, p_filters);
    v_den := public._metric_leaf(p_org_id, p_measure_ref->>'den', 'total',
                                 p_period, p_ref, p_start, p_end, p_filters);
    v_num_v := (v_num->>'value')::numeric;
    v_den_v := (v_den->>'value')::numeric;

    -- Unit derivada, determinística. den 0 ou null → value null (não 0, não erro).
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

COMMENT ON FUNCTION public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb) IS
  'Motor de leitura das Métricas Montáveis (#1194 / ADR-0023). Despacho sobre '
  'catálogo FECHADO, ZERO EXECUTE: recorte/agg escolhem ramo por CASE sobre o '
  'VALOR do parâmetro; filtros LIGADOS. assert_org_access 1ª instrução. '
  'kind=leaf → 1 medida; kind=ratio → 2 filhos (total), den 0→null, unit '
  'derivada (count/count→percent, currency/count→currency).';

-- ===========================================================================
-- 8. Grants — internos só service_role; público a authenticated
-- ===========================================================================
REVOKE EXECUTE ON FUNCTION public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_leads_criados(uuid, text, tstzrange, text, jsonb)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_meetings(uuid, text, text, tstzrange, text, jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb)                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._metric_leaf_stage_duration(uuid, text, jsonb)                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)         FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_sales(uuid, text, text, tstzrange, text, jsonb)          TO service_role;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_leads_criados(uuid, text, tstzrange, text, jsonb)         TO service_role;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_meetings(uuid, text, text, tstzrange, text, jsonb)        TO service_role;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_stage_snapshot(uuid, text, jsonb)                         TO service_role;
GRANT  EXECUTE ON FUNCTION public._metric_leaf_stage_duration(uuid, text, jsonb)                         TO service_role;
GRANT  EXECUTE ON FUNCTION public._metric_leaf(uuid, text, text, text, date, date, date, jsonb)          TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_metric_measure(uuid, jsonb, text, text, date, date, date, jsonb) TO authenticated, service_role;
