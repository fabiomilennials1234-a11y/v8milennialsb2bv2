-- SCRUM-604 — Perfil de Atuação por prática observada; ADR-0033.

ALTER FUNCTION public.oraculo_revenue_bottleneck(uuid,uuid)
  RENAME TO oraculo_revenue_bottleneck_without_people;

CREATE FUNCTION public.oraculo_person_profile_at(
  p_organization_id uuid,
  p_subject_team_member_id uuid,
  p_as_of date
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '10s'
AS $$
  WITH dates AS (
    SELECT date_trunc('week', p_as_of::timestamp)::date AS this_week
  ), bounds AS (
    SELECT
      public.metric_period_bounds(p_organization_id, 'range', NULL,
        d.this_week - 98, d.this_week - 42 - 1) AS baseline_range,
      public.metric_period_bounds(p_organization_id, 'range', NULL,
        d.this_week - 42, d.this_week - 14 - 1) AS current_range
    FROM dates d
  ), outcomes AS (
    SELECT se.sold_at AS occurred_at, x.metric, x.member_id,
      CASE WHEN se.event_type = 'sale' AND reversal.found IS NULL THEN 1 ELSE 0 END AS success,
      CASE WHEN se.event_type = 'sale' AND se.sale_value > 0 AND reversal.found IS NULL
        THEN se.sale_value END AS ticket
    FROM public.sale_events se
    CROSS JOIN LATERAL (VALUES
      ('meetings'::text, se.pre_sale_responsible_id),
      ('sales'::text, se.sale_responsible_id)
    ) x(metric, member_id)
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
      SELECT true AS found FROM public.sale_events r
      WHERE r.organization_id = se.organization_id
        AND r.event_type = 'sale_reversed'
        AND r.reversed_event_id = se.id
      LIMIT 1
    ) reversal ON true
    WHERE se.organization_id = p_organization_id
      AND se.event_type IN ('sale', 'sale_lost')
      AND x.member_id IS NOT NULL
      AND (se.sold_at <@ b.baseline_range OR se.sold_at <@ b.current_range)
  ), members AS (
    SELECT tm.id, tm.name, tm.metric_type::text AS declared_metric
    FROM public.team_members tm
    WHERE tm.organization_id = p_organization_id AND tm.is_active
  ), metrics(metric) AS (VALUES ('meetings'::text), ('sales'::text)), rollup AS (
    SELECT m.id, m.name, m.declared_metric, metric.metric,
      count(o.*) FILTER (WHERE o.occurred_at <@ b.current_range)::integer AS current_assignments,
      coalesce(sum(o.success) FILTER (WHERE o.occurred_at <@ b.current_range), 0)::integer AS current_successes,
      count(o.*) FILTER (WHERE o.occurred_at <@ b.baseline_range)::integer AS baseline_assignments,
      coalesce(sum(o.success) FILTER (WHERE o.occurred_at <@ b.baseline_range), 0)::integer AS baseline_successes,
      coalesce(avg(o.ticket) FILTER (WHERE o.ticket IS NOT NULL), 0)::numeric AS average_ticket
    FROM members m CROSS JOIN metrics metric CROSS JOIN bounds b
    LEFT JOIN outcomes o ON o.member_id = m.id AND o.metric = metric.metric
    GROUP BY m.id, m.name, m.declared_metric, metric.metric
  ), metric_ticket AS (
    SELECT metric, coalesce(avg(ticket) FILTER (WHERE ticket IS NOT NULL), 0)::numeric AS average_ticket
    FROM outcomes GROUP BY metric
  ), rates AS (
    SELECT r.id, r.name, r.declared_metric, r.metric,
      r.current_assignments, r.current_successes, r.baseline_assignments, r.baseline_successes,
      coalesce(nullif(r.average_ticket, 0), mt.average_ticket, 0)::numeric AS average_ticket,
      r.current_successes::numeric / nullif(r.current_assignments, 0) AS current_rate,
      r.baseline_successes::numeric / nullif(r.baseline_assignments, 0) AS baseline_rate
    FROM rollup r LEFT JOIN metric_ticket mt USING (metric)
  ), team AS (
    SELECT metric,
      count(*) FILTER (WHERE current_assignments >= 10) AS evaluable_people,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY current_rate)
        FILTER (WHERE current_assignments >= 10) AS median_rate
    FROM rates GROUP BY metric
  ), evaluated AS (
    SELECT r.*, t.evaluable_people, t.median_rate::numeric,
      CASE WHEN t.evaluable_people >= 4 THEN 'team_median'
           WHEN r.baseline_assignments >= 10 THEN 'own_history' END AS comparison_basis,
      CASE WHEN t.evaluable_people >= 4 THEN t.median_rate::numeric
           WHEN r.baseline_assignments >= 10 THEN r.baseline_rate END AS benchmark_rate,
      CASE WHEN r.current_assignments < 10 THEN 'insufficient_volume'
           WHEN t.evaluable_people < 4 AND r.baseline_assignments < 10 THEN 'insufficient_benchmark'
           ELSE 'evaluable' END AS evaluation_status
    FROM rates r JOIN team t USING (metric)
  ), shaped AS (
    SELECT e.*,
      greatest(0, coalesce(e.benchmark_rate, 0) - coalesce(e.current_rate, 0)) AS rate_gap,
      greatest(0, e.current_assignments *
        (coalesce(e.benchmark_rate, 0) - coalesce(e.current_rate, 0)) * e.average_ticket) AS leaked_revenue
    FROM evaluated e
  ), profiles AS (
    SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'team_member_id', CASE WHEN p_subject_team_member_id IS NULL THEN id END,
      'team_member_name', CASE WHEN p_subject_team_member_id IS NULL THEN name END,
      'subject', CASE WHEN p_subject_team_member_id IS NOT NULL THEN 'self' END,
      'metric', metric,
      'declared_metric', declared_metric,
      'declared_absence', declared_metric = metric AND current_assignments + baseline_assignments = 0,
      'status', evaluation_status,
      'minimum_participation', 10,
      'current_assignments', current_assignments,
      'baseline_assignments', baseline_assignments,
      'current_conversion', round(current_rate, 4),
      'benchmark_conversion', round(benchmark_rate, 4),
      'comparison_basis', comparison_basis,
      'team_sample_size', evaluable_people
    )) ORDER BY name, metric), '[]'::jsonb) AS value
    FROM shaped
    WHERE p_subject_team_member_id IS NULL OR id = p_subject_team_member_id
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY leaked_revenue DESC, id, metric) AS position
    FROM shaped
    WHERE evaluation_status = 'evaluable' AND rate_gap >= 0.05 AND leaked_revenue >= 1000
      AND (p_subject_team_member_id IS NULL OR id = p_subject_team_member_id)
  )
  SELECT jsonb_build_object(
    'status', CASE WHEN EXISTS (SELECT 1 FROM ranked) THEN 'bottleneck' ELSE 'none' END,
    'bottleneck', (SELECT jsonb_strip_nulls(jsonb_build_object(
      'dimension', CASE WHEN p_subject_team_member_id IS NULL THEN 'person' ELSE 'self' END,
      'key', CASE WHEN p_subject_team_member_id IS NULL THEN id::text ELSE 'self' END,
      'label', CASE WHEN p_subject_team_member_id IS NULL THEN name ELSE 'Seu desempenho' END,
      'team_member_id', CASE WHEN p_subject_team_member_id IS NULL THEN id END,
      'team_member_name', CASE WHEN p_subject_team_member_id IS NULL THEN name END,
      'metric', metric, 'current_volume', current_assignments,
      'current_conversion', round(current_rate, 4),
      'baseline_conversion', round(benchmark_rate, 4),
      'comparison_basis', comparison_basis, 'team_sample_size', evaluable_people,
      'rate_gap_pp', round(rate_gap * 100, 2), 'average_ticket', round(average_ticket, 2),
      'estimated_leaked_revenue', round(leaked_revenue, 2)
    )) FROM ranked WHERE position = 1),
    'profiles', (SELECT value FROM profiles),
    'evidence', jsonb_build_object('minimum_participation', 10, 'minimum_team_size', 4)
  );
$$;

CREATE FUNCTION public.oraculo_revenue_bottleneck(
  p_organization_id uuid,
  p_team_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
DECLARE
  v_base jsonb;
  v_people jsonb;
  v_person jsonb;
  v_base_revenue numeric := 0;
  v_person_revenue numeric := 0;
BEGIN
  IF p_team_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.id = p_team_member_id AND tm.organization_id = p_organization_id AND tm.is_active
  ) THEN RAISE EXCEPTION 'membro fora da organização' USING ERRCODE = '42501'; END IF;

  v_base := public.oraculo_revenue_bottleneck_without_people(p_organization_id, p_team_member_id);
  v_people := public.oraculo_person_profile_at(
    p_organization_id, p_team_member_id,
    (now() AT TIME ZONE (SELECT timezone FROM public.organizations WHERE id = p_organization_id))::date
  );
  v_person := v_people->'bottleneck';
  v_base_revenue := coalesce((v_base->'bottleneck'->>'estimated_leaked_revenue')::numeric, 0);
  v_person_revenue := coalesce((v_person->>'estimated_leaked_revenue')::numeric, 0);

  IF v_person_revenue > v_base_revenue THEN
    v_base := jsonb_set(jsonb_set(v_base, '{status}', '"bottleneck"'), '{bottleneck}', v_person);
  END IF;
  RETURN v_base || CASE WHEN p_team_member_id IS NULL
    THEN jsonb_build_object('people', v_people->'profiles', 'people_evidence', v_people->'evidence')
    ELSE jsonb_build_object('self_profile', v_people->'profiles', 'people_evidence', v_people->'evidence')
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.oraculo_person_profile_at(uuid,uuid,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_revenue_bottleneck_without_people(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_revenue_bottleneck(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.oraculo_person_profile_at(uuid,uuid,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_revenue_bottleneck_without_people(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_revenue_bottleneck(uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.oraculo_person_profile_at(uuid,uuid,date) IS
  'Perfil de Atuação: prática observada em desfechos atribuídos; pisos 10/4; declarado apenas explica ausência.';
