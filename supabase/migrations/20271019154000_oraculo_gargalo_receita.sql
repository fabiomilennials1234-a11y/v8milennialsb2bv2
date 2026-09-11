-- SCRUM-601 · gargalo por receita vazada, calculado sem modelo.

CREATE OR REPLACE FUNCTION public.oraculo_rank_revenue_bottleneck(
  p_candidates jsonb,
  p_available_weeks integer,
  p_available_from date,
  p_present jsonb,
  p_as_of date
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH raw AS (
    SELECT
      item->>'dimension' AS dimension,
      item->>'key' AS key,
      item->>'label' AS label,
      greatest(0, coalesce((item->>'current_volume')::numeric, 0)) AS current_volume,
      greatest(0, coalesce((item->>'baseline_volume')::numeric, 0)) AS baseline_volume,
      greatest(0, coalesce((item->>'current_successes')::numeric, 0)) AS current_successes,
      greatest(0, coalesce((item->>'baseline_successes')::numeric, 0)) AS baseline_successes,
      greatest(0, least(1, coalesce((item->>'downstream_conversion')::numeric, 1))) AS downstream_conversion,
      greatest(0, coalesce((item->>'average_ticket')::numeric, 0)) AS average_ticket,
      greatest(1, coalesce((item->>'min_current')::numeric, 20)) AS min_current,
      greatest(1, coalesce((item->>'min_baseline')::numeric, 40)) AS min_baseline
    FROM jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) item
    WHERE item->>'dimension' IN ('stage', 'origin', 'product')
      AND nullif(item->>'key', '') IS NOT NULL
  ),
  calculated AS (
    SELECT *,
      least(1, current_successes / nullif(current_volume, 0)) AS current_rate,
      least(1, baseline_successes / nullif(baseline_volume, 0)) AS baseline_rate
    FROM raw
  ),
  supported AS (
    SELECT *
    FROM calculated
    WHERE current_volume >= min_current
      AND baseline_volume >= min_baseline
      AND average_ticket > 0
  ),
  eligible AS (
    SELECT *,
      greatest(0, baseline_rate - current_rate) AS rate_gap,
      greatest(0, current_volume * (baseline_rate - current_rate)) AS lost_units,
      greatest(0,
        current_volume * (baseline_rate - current_rate) * downstream_conversion * average_ticket
      ) AS leaked_revenue
    FROM supported
    WHERE baseline_rate - current_rate >= 0.05
  ),
  ranked AS (
    SELECT *, row_number() OVER (
      ORDER BY leaked_revenue DESC, dimension, key
    ) AS position
    FROM eligible
    WHERE leaked_revenue >= 1000
  ),
  shaped AS (
    SELECT position, jsonb_build_object(
      'dimension', dimension,
      'key', key,
      'label', coalesce(nullif(label, ''), key),
      'current_volume', current_volume,
      'baseline_volume', baseline_volume,
      'current_conversion', round(current_rate, 4),
      'baseline_conversion', round(baseline_rate, 4),
      'rate_gap_pp', round(rate_gap * 100, 2),
      'lost_units', round(lost_units, 2),
      'downstream_conversion', round(downstream_conversion, 4),
      'average_ticket', round(average_ticket, 2),
      'estimated_leaked_revenue', round(leaked_revenue, 2)
    ) AS candidate
    FROM ranked
  ),
  dimension_support AS (
    SELECT
      dimensions.dimension,
      coalesce(bool_or(
        r.current_volume >= r.min_current
        AND r.baseline_volume >= r.min_baseline
        AND r.average_ticket > 0
      ), false) AS sufficient,
      coalesce(max(r.current_volume), 0) AS current_volume,
      coalesce(max(r.baseline_volume), 0) AS baseline_volume,
      CASE WHEN dimensions.dimension = 'product' THEN 10 ELSE 20 END AS min_current,
      CASE WHEN dimensions.dimension = 'product' THEN 20 ELSE 40 END AS min_baseline,
      coalesce(bool_or(r.average_ticket > 0), false) AS has_ticket
    FROM (VALUES ('stage'), ('origin'), ('product')) dimensions(dimension)
    LEFT JOIN raw r ON r.dimension = dimensions.dimension
    GROUP BY dimensions.dimension
  ),
  missing AS (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'dimension', dimension,
      'current_volume', current_volume,
      'baseline_volume', baseline_volume,
      'min_current', min_current,
      'min_baseline', min_baseline,
      'has_ticket', has_ticket
    ) ORDER BY dimension), '[]'::jsonb) AS value
    FROM dimension_support
    WHERE NOT sufficient
  ),
  output AS (
    SELECT
      CASE
        WHEN coalesce(p_available_weeks, 0) < 14 THEN 'insufficient_evidence'
        WHEN NOT EXISTS (SELECT 1 FROM supported) THEN 'insufficient_evidence'
        WHEN NOT EXISTS (SELECT 1 FROM shaped) THEN 'none'
        ELSE 'bottleneck'
      END AS status,
      CASE WHEN coalesce(p_available_weeks, 0) >= 14
          AND EXISTS (SELECT 1 FROM supported)
        THEN (SELECT candidate FROM shaped WHERE position = 1)
        ELSE NULL
      END AS bottleneck,
      CASE WHEN coalesce(p_available_weeks, 0) >= 14
          AND EXISTS (SELECT 1 FROM supported) THEN coalesce(
        (SELECT jsonb_agg(candidate ORDER BY position) FROM shaped WHERE position <= 5),
        '[]'::jsonb
      ) ELSE '[]'::jsonb END AS candidates
  )
  SELECT jsonb_build_object(
    'status', status,
    'as_of', p_as_of,
    'bottleneck', bottleneck,
    'candidates', candidates,
    'evidence', jsonb_build_object(
      'available_weeks', greatest(0, coalesce(p_available_weeks, 0)),
      'required_weeks', 14,
      'baseline_weeks', 8,
      'current_weeks', 4,
      'maturation_weeks', 2,
      'reason', CASE
        WHEN coalesce(p_available_weeks, 0) < 14 THEN 'history_window'
        WHEN NOT EXISTS (SELECT 1 FROM supported) THEN 'sample_size'
        ELSE NULL
      END,
      'available_from', CASE
        WHEN coalesce(p_available_weeks, 0) < 14 THEN p_available_from
        ELSE NULL
      END,
      'missing_dimensions', (SELECT value FROM missing)
    ),
    'present', coalesce(p_present, '{}'::jsonb)
  )
  FROM output;
$$;

COMMENT ON FUNCTION public.oraculo_rank_revenue_bottleneck(jsonb,integer,date,jsonb,date) IS
  'Núcleo puro do diagnóstico SCRUM-601. Ranqueia impacto monetário; 14 semanas = 8 baseline + 4 atuais + 2 de maturação.';

REVOKE ALL ON FUNCTION public.oraculo_rank_revenue_bottleneck(jsonb,integer,date,jsonb,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_rank_revenue_bottleneck(jsonb,integer,date,jsonb,date)
  TO service_role;

-- A data explícita vive numa função server-only para ensaio reproduzível. A
-- ferramenta chama apenas o wrapper de dois argumentos e nunca escolhe data.
CREATE OR REPLACE FUNCTION public.oraculo_revenue_bottleneck_at(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_as_of date
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH bounds_dates AS (
    SELECT
      p_as_of AS as_of,
      date_trunc('week', p_as_of::timestamp)::date AS this_week,
      (date_trunc('week', p_as_of::timestamp)::date - 14) AS current_end,
      (date_trunc('week', p_as_of::timestamp)::date - 42) AS current_start,
      (date_trunc('week', p_as_of::timestamp)::date - 42) AS baseline_end,
      (date_trunc('week', p_as_of::timestamp)::date - 98) AS baseline_start
  ),
  bounds AS (
    SELECT bd.*, o.timezone,
      public.metric_period_bounds(
        p_organization_id, 'range', NULL, bd.baseline_start, bd.baseline_end - 1
      ) AS baseline_range,
      public.metric_period_bounds(
        p_organization_id, 'range', NULL, bd.current_start, bd.current_end - 1
      ) AS current_range,
      public.metric_period_bounds(
        p_organization_id, 'range', NULL, bd.baseline_start, bd.current_end - 1
      ) AS observation_range,
      lower(public.metric_period_bounds(
        p_organization_id, 'week', bd.this_week, NULL, NULL
      )) AS analysis_cutoff,
      lower(public.metric_period_bounds(
        p_organization_id, 'day', bd.as_of, NULL, NULL
      )) AS as_of_instant
    FROM bounds_dates bd
    JOIN public.organizations o ON o.id = p_organization_id
  ),
  scoped_leads AS (
    SELECT
      l.id,
      coalesce(l.metrics_period_at, l.created_at) AS cohort_at,
      coalesce(nullif(btrim(l.origin::text), ''), 'sem_origem') AS origin
    FROM public.leads l
    WHERE l.organization_id = p_organization_id
      AND l.deleted_at IS NULL
      AND coalesce(l.is_shadow, false) = false
      AND (
        p_team_member_id IS NULL
        OR l.responsible_id = p_team_member_id
        OR l.sdr_id = p_team_member_id
        OR l.closer_id = p_team_member_id
        OR EXISTS (
          SELECT 1 FROM public.pipeline_entries pe
          WHERE pe.organization_id = p_organization_id
            AND pe.lead_id = l.id
            AND pe.assigned_to = p_team_member_id
        )
      )
  ),
  net_sales AS (
    SELECT se.id, se.lead_id, se.deal_id, se.stage_event_id, se.sale_value, se.sold_at
    FROM public.sale_events se CROSS JOIN bounds b
    WHERE se.organization_id = p_organization_id
      AND se.event_type = 'sale'
      AND se.sale_value > 0
      AND se.sold_at < b.analysis_cutoff
      AND NOT EXISTS (
        SELECT 1 FROM public.sale_events reversal
        WHERE reversal.organization_id = se.organization_id
          AND reversal.event_type = 'sale_reversed'
          AND reversal.reversed_event_id = se.id
          AND reversal.sold_at < b.analysis_cutoff
      )
      AND (
        p_team_member_id IS NULL
        OR se.sale_responsible_id = p_team_member_id
        OR se.pre_sale_responsible_id = p_team_member_id
        OR EXISTS (SELECT 1 FROM scoped_leads sl WHERE sl.id = se.lead_id)
      )
  ),
  first_fact AS (
    SELECT min(fact_at) AS first_at
    FROM (
      SELECT min(sl.cohort_at) AS fact_at FROM scoped_leads sl CROSS JOIN bounds b
      WHERE sl.cohort_at < b.analysis_cutoff
      UNION ALL
      SELECT min(e.occurred_at) FROM public.pipeline_stage_events e CROSS JOIN bounds b
      WHERE e.organization_id = p_organization_id
        AND e.occurred_at < b.analysis_cutoff
        AND EXISTS (SELECT 1 FROM scoped_leads sl WHERE sl.id = e.lead_id)
      UNION ALL
      SELECT min(d.created_at) FROM public.deals d CROSS JOIN bounds b
      WHERE d.organization_id = p_organization_id
        AND d.deleted_at IS NULL
        AND d.created_at < b.analysis_cutoff
        AND (
          p_team_member_id IS NULL OR d.owner_id = p_team_member_id
          OR EXISTS (SELECT 1 FROM scoped_leads sl WHERE sl.id = d.source_lead_id)
        )
    ) facts
  ),
  evidence AS (
    SELECT
      greatest(0, floor((b.this_week - date_trunc(
        'week', coalesce((ff.first_at AT TIME ZONE b.timezone)::date, b.this_week)::timestamp
      )::date) / 7.0))::integer AS available_weeks,
      (date_trunc(
        'week', coalesce((ff.first_at AT TIME ZONE b.timezone)::date, b.this_week)::timestamp
      )::date + 98) AS available_from
    FROM bounds b CROSS JOIN first_fact ff
  ),
  present AS (
    SELECT jsonb_build_object(
      'open_deals', (
        SELECT count(*) FROM public.pipeline_entries pe
        WHERE pe.organization_id = p_organization_id
          AND pe.closed_at IS NULL
          AND (p_team_member_id IS NULL OR pe.assigned_to = p_team_member_id)
      ),
      'stalled_14d', (
        SELECT count(*) FROM public.pipeline_entries pe
        WHERE pe.organization_id = p_organization_id
          AND pe.closed_at IS NULL
          AND pe.stage_changed_at < b.as_of_instant - interval '14 days'
          AND (p_team_member_id IS NULL OR pe.assigned_to = p_team_member_id)
      ),
      'unanswered_proposals_7d', (
        SELECT count(*) FROM public.pipeline_entries pe
        JOIN public.pipelines p ON p.id = pe.pipeline_id
        WHERE pe.organization_id = p_organization_id
          AND p.slug = 'propostas'
          AND pe.closed_at IS NULL
          AND pe.stage_changed_at < b.as_of_instant - interval '7 days'
          AND (p_team_member_id IS NULL OR pe.assigned_to = p_team_member_id)
      ),
      'conversations_without_next_step', (
        SELECT count(DISTINCT cs.lead_id) FROM public.conversation_summaries cs
        WHERE cs.organization_id = p_organization_id
          AND nullif(btrim(cs.next_action), '') IS NULL
          AND EXISTS (SELECT 1 FROM scoped_leads sl WHERE sl.id = cs.lead_id)
      )
    ) AS value
    FROM bounds b
  ),
  origin_rollup AS (
    SELECT
      sl.origin AS key,
      count(*) FILTER (
        WHERE sl.cohort_at <@ b.current_range
      ) AS current_volume,
      count(*) FILTER (
        WHERE sl.cohort_at <@ b.baseline_range
      ) AS baseline_volume,
      count(*) FILTER (
        WHERE sl.cohort_at <@ b.current_range
          AND EXISTS (
            SELECT 1 FROM net_sales ns WHERE ns.lead_id = sl.id
              AND ns.sold_at >= sl.cohort_at AND ns.sold_at < sl.cohort_at + interval '14 days'
          )
      ) AS current_successes,
      count(*) FILTER (
        WHERE sl.cohort_at <@ b.baseline_range
          AND EXISTS (
            SELECT 1 FROM net_sales ns WHERE ns.lead_id = sl.id
              AND ns.sold_at >= sl.cohort_at AND ns.sold_at < sl.cohort_at + interval '14 days'
          )
    ) AS baseline_successes
    FROM scoped_leads sl CROSS JOIN bounds b
    WHERE sl.cohort_at <@ b.observation_range
    GROUP BY sl.origin
  ),
  origin_ticket AS (
    SELECT sl.origin AS key, avg(ns.sale_value) AS average_ticket
    FROM net_sales ns JOIN scoped_leads sl ON sl.id = ns.lead_id CROSS JOIN bounds b
    WHERE ns.sold_at >= lower(b.observation_range)
      AND ns.sold_at < b.analysis_cutoff
    GROUP BY sl.origin
  ),
  stage_arrivals AS (
    SELECT DISTINCT ON (e.entry_id, e.to_stage_key)
      e.id,
      e.organization_id,
      e.entry_id,
      e.lead_id,
      e.pipeline_id,
      e.to_stage_key AS stage_key,
      e.occurred_at
    FROM public.pipeline_stage_events e
    JOIN scoped_leads sl ON sl.id = e.lead_id
    CROSS JOIN bounds b
    WHERE e.organization_id = p_organization_id
      AND e.entry_id IS NOT NULL
      AND e.occurred_at <@ b.observation_range
    ORDER BY e.entry_id, e.to_stage_key, e.occurred_at, e.id
  ),
  stage_entries AS (
    SELECT
      e.id,
      e.entry_id,
      e.lead_id,
      e.pipeline_id,
      e.stage_key,
      e.occurred_at,
      p.name || ' · ' || coalesce(ps.name, e.stage_key) AS label,
      EXISTS (
        SELECT 1 FROM public.pipeline_stage_events next_event
        WHERE next_event.organization_id = e.organization_id
          AND next_event.entry_id = e.entry_id
          AND next_event.from_stage_key = e.stage_key
          AND next_event.occurred_at > e.occurred_at
          AND next_event.occurred_at <= e.occurred_at + interval '14 days'
      ) AS progressed_14d,
      EXISTS (
        SELECT 1
        FROM net_sales ns
        JOIN public.pipeline_stage_events sale_stage
          ON sale_stage.id = ns.stage_event_id
         AND sale_stage.organization_id = e.organization_id
         AND sale_stage.entry_id = e.entry_id
        WHERE ns.lead_id = e.lead_id
          AND ns.sold_at >= e.occurred_at
          AND ns.sold_at < e.occurred_at + interval '42 days'
      ) AS won_downstream
    FROM stage_arrivals e
    JOIN public.pipelines p ON p.id = e.pipeline_id
    LEFT JOIN public.pipeline_stages ps
      ON ps.pipeline_id = e.pipeline_id AND ps.stage_key = e.stage_key
    WHERE coalesce(ps.stage_role::text, 'open') NOT IN ('won', 'lost')
  ),
  stage_rollup AS (
    SELECT
      pipeline_id::text || ':' || stage_key AS key,
      min(label) AS label,
      count(*) FILTER (
        WHERE occurred_at <@ b.current_range
      ) AS current_volume,
      count(*) FILTER (
        WHERE occurred_at <@ b.baseline_range
      ) AS baseline_volume,
      count(*) FILTER (
        WHERE occurred_at <@ b.current_range AND progressed_14d
      ) AS current_successes,
      count(*) FILTER (
        WHERE occurred_at <@ b.baseline_range AND progressed_14d
      ) AS baseline_successes,
      count(*) FILTER (
        WHERE occurred_at <@ b.baseline_range
          AND progressed_14d AND won_downstream
      ) AS baseline_downstream_wins
    FROM stage_entries CROSS JOIN bounds b
    GROUP BY pipeline_id, stage_key
  ),
  stage_ticket AS (
    SELECT DISTINCT se.pipeline_id::text || ':' || se.stage_key AS key, ns.id, ns.sale_value
    FROM stage_entries se
    JOIN public.pipeline_stage_events sale_stage ON sale_stage.entry_id = se.entry_id
    JOIN net_sales ns ON ns.stage_event_id = sale_stage.id AND ns.lead_id = se.lead_id
    WHERE ns.sold_at >= se.occurred_at
      AND ns.sold_at < se.occurred_at + interval '42 days'
  ),
  deal_products AS (
    SELECT
      di.organization_id,
      di.deal_id,
      coalesce(di.product_id::text, 'name:' || lower(btrim(di.product_name))) AS key,
      coalesce(min(p.name), min(di.product_name)) AS label,
      sum(di.total) AS item_value
    FROM public.deal_items di
    LEFT JOIN public.products p
      ON p.id = di.product_id AND p.organization_id = di.organization_id
    WHERE di.organization_id = p_organization_id
      AND coalesce(di.product_id::text, nullif(btrim(di.product_name), '')) IS NOT NULL
    GROUP BY di.organization_id, di.deal_id,
      coalesce(di.product_id::text, 'name:' || lower(btrim(di.product_name)))
  ),
  product_deals AS (
    SELECT
      d.id AS deal_id,
      d.created_at AS cohort_at,
      dp.key,
      dp.label,
      dp.item_value,
      sum(dp.item_value) OVER (PARTITION BY d.id) AS deal_items_value
    FROM public.deals d
    JOIN deal_products dp ON dp.deal_id = d.id AND dp.organization_id = d.organization_id
    CROSS JOIN bounds b
    WHERE d.organization_id = p_organization_id
      AND d.deleted_at IS NULL
      AND d.created_at <@ b.observation_range
      AND (
        p_team_member_id IS NULL OR d.owner_id = p_team_member_id
        OR EXISTS (SELECT 1 FROM scoped_leads sl WHERE sl.id = d.source_lead_id)
      )
  ),
  product_rollup AS (
    SELECT
      pd.key,
      min(pd.label) AS label,
      count(*) FILTER (
        WHERE pd.cohort_at <@ b.current_range
      ) AS current_volume,
      count(*) FILTER (
        WHERE pd.cohort_at <@ b.baseline_range
      ) AS baseline_volume,
      count(*) FILTER (
        WHERE pd.cohort_at <@ b.current_range
          AND EXISTS (
            SELECT 1 FROM net_sales ns WHERE ns.deal_id = pd.deal_id
              AND ns.sold_at >= pd.cohort_at AND ns.sold_at < pd.cohort_at + interval '14 days'
          )
      ) AS current_successes,
      count(*) FILTER (
        WHERE pd.cohort_at <@ b.baseline_range
          AND EXISTS (
            SELECT 1 FROM net_sales ns WHERE ns.deal_id = pd.deal_id
              AND ns.sold_at >= pd.cohort_at AND ns.sold_at < pd.cohort_at + interval '14 days'
          )
      ) AS baseline_successes
    FROM product_deals pd CROSS JOIN bounds b
    GROUP BY pd.key
  ),
  product_ticket AS (
    SELECT pd.key, avg(
      ns.sale_value * pd.item_value / nullif(pd.deal_items_value, 0)
    ) AS average_ticket
    FROM product_deals pd JOIN net_sales ns ON ns.deal_id = pd.deal_id
    WHERE ns.sold_at >= pd.cohort_at AND ns.sold_at < pd.cohort_at + interval '14 days'
    GROUP BY pd.key
  ),
  candidates AS (
    SELECT jsonb_build_object(
      'dimension', 'origin', 'key', r.key, 'label', r.key,
      'current_volume', r.current_volume, 'baseline_volume', r.baseline_volume,
      'current_successes', r.current_successes, 'baseline_successes', r.baseline_successes,
      'downstream_conversion', 1,
      'average_ticket', coalesce(t.average_ticket, 0),
      'min_current', 20, 'min_baseline', 40
    ) AS value
    FROM origin_rollup r LEFT JOIN origin_ticket t USING (key)
    UNION ALL
    SELECT jsonb_build_object(
      'dimension', 'stage', 'key', r.key, 'label', r.label,
      'current_volume', r.current_volume, 'baseline_volume', r.baseline_volume,
      'current_successes', r.current_successes, 'baseline_successes', r.baseline_successes,
      'downstream_conversion', CASE WHEN r.baseline_successes > 0
        THEN r.baseline_downstream_wins::numeric / r.baseline_successes ELSE 0 END,
      'average_ticket', coalesce(t.average_ticket, 0),
      'min_current', 20, 'min_baseline', 40
    )
    FROM stage_rollup r
    LEFT JOIN (SELECT key, avg(sale_value) AS average_ticket FROM stage_ticket GROUP BY key) t USING (key)
    UNION ALL
    SELECT jsonb_build_object(
      'dimension', 'product', 'key', r.key, 'label', r.label,
      'current_volume', r.current_volume, 'baseline_volume', r.baseline_volume,
      'current_successes', r.current_successes, 'baseline_successes', r.baseline_successes,
      'downstream_conversion', 1,
      'average_ticket', coalesce(t.average_ticket, 0),
      'min_current', 10, 'min_baseline', 20
    )
    FROM product_rollup r LEFT JOIN product_ticket t USING (key)
  )
  SELECT public.oraculo_rank_revenue_bottleneck(
    coalesce((SELECT jsonb_agg(value) FROM candidates), '[]'::jsonb),
    e.available_weeks,
    e.available_from,
    p.value || jsonb_build_object(
      'window', jsonb_build_object(
        'baseline_start', b.baseline_start,
        'baseline_end', b.baseline_end,
        'current_start', b.current_start,
        'current_end', b.current_end
      )
    ),
    b.as_of
  )
  FROM bounds b CROSS JOIN evidence e CROSS JOIN present p;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_revenue_bottleneck(
  p_organization_id uuid,
  p_team_member_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.oraculo_revenue_bottleneck_at(
    p_organization_id,
    p_team_member_id,
    (now() AT TIME ZONE o.timezone)::date
  )
  FROM public.organizations o
  WHERE o.id = p_organization_id;
$$;

COMMENT ON FUNCTION public.oraculo_revenue_bottleneck(uuid,uuid) IS
  'Ferramenta gargalo do Oráculo. SQL determinístico sobre fatos canônicos; organização e pessoa chegam somente da edge autenticada.';

REVOKE ALL ON FUNCTION public.oraculo_revenue_bottleneck_at(uuid,uuid,date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_revenue_bottleneck(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_revenue_bottleneck_at(uuid,uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_revenue_bottleneck(uuid,uuid) TO service_role;
