-- SCRUM-602 — benchmark anônimo materializado. A conversa só lê snapshot.

CREATE TABLE public.oraculo_benchmark_weekly (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  snapshot_week date NOT NULL,
  external_benchmark jsonb NOT NULL,
  self_benchmark jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, snapshot_week),
  CONSTRAINT oraculo_benchmark_weekly_monday
    CHECK (extract(isodow FROM snapshot_week) = 1),
  CONSTRAINT oraculo_benchmark_weekly_external_object
    CHECK (jsonb_typeof(external_benchmark) = 'object'),
  CONSTRAINT oraculo_benchmark_weekly_self_object
    CHECK (jsonb_typeof(self_benchmark) = 'object')
);

COMMENT ON TABLE public.oraculo_benchmark_weekly IS
  'Snapshot semanal por organização leitora. Guarda somente agregados anônimos dos pares, já excluindo a leitora, e seu auto-benchmark.';

ALTER TABLE public.oraculo_benchmark_weekly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oraculo_benchmark_weekly FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.oraculo_benchmark_weekly TO service_role;

CREATE OR REPLACE FUNCTION public.oraculo_benchmark_week_is_closed(
  p_week_start date,
  p_at timestamptz,
  p_timezone text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT p_week_start IS NOT NULL
    AND p_at IS NOT NULL
    AND p_week_start::timestamp AT TIME ZONE p_timezone <= p_at;
$$;

CREATE OR REPLACE FUNCTION public.refresh_oraculo_benchmark_weekly(
  p_week_start date DEFAULT date_trunc('week', current_date)::date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '30s'
AS $$
DECLARE
  v_written integer;
BEGIN
  IF p_week_start IS NULL
     OR extract(isodow FROM p_week_start) <> 1
     OR p_week_start > current_date THEN
    RAISE EXCEPTION 'snapshot_week_invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE coalesce(o.is_sandbox, false) = false
      AND o.subscription_status IN ('active', 'trial', 'overdue')
      AND NOT public.oraculo_benchmark_week_is_closed(
        p_week_start, clock_timestamp(), o.timezone
      )
  ) THEN
    RAISE EXCEPTION 'snapshot_week_open_for_organization_timezone';
  END IF;

  WITH org_bounds AS (
    SELECT
      o.id AS organization_id,
      o.timezone,
      ((p_week_start - 98)::timestamp AT TIME ZONE o.timezone) AS baseline_start,
      ((p_week_start - 42)::timestamp AT TIME ZONE o.timezone) AS current_start,
      ((p_week_start - 14)::timestamp AT TIME ZONE o.timezone) AS current_end,
      ((p_week_start - 28)::timestamp AT TIME ZONE o.timezone) AS activity_start,
      (p_week_start::timestamp AT TIME ZONE o.timezone) AS analysis_cutoff,
      greatest(count(tm.id) FILTER (WHERE tm.is_active), 0)::integer AS active_members
    FROM public.organizations o
    LEFT JOIN public.team_members tm ON tm.organization_id = o.id
    WHERE coalesce(o.is_sandbox, false) = false
      AND o.subscription_status IN ('active', 'trial', 'overdue')
    GROUP BY o.id, o.timezone
  ), cohort_leads AS (
    SELECT
      b.organization_id,
      le.id AS lead_id,
      coalesce(le.metrics_period_at, le.created_at) AS cohort_at,
      b.analysis_cutoff,
      CASE
        WHEN coalesce(le.metrics_period_at, le.created_at) >= b.current_start
          THEN 'current'
        ELSE 'baseline'
      END AS cohort
    FROM org_bounds b
    JOIN public.leads le ON le.organization_id = b.organization_id
    WHERE le.deleted_at IS NULL
      AND coalesce(le.is_shadow, false) = false
      AND coalesce(le.excluded_from_metrics, false) = false
      AND coalesce(le.metrics_period_at, le.created_at) >= b.baseline_start
      AND coalesce(le.metrics_period_at, le.created_at) < b.current_end
  ), lead_rollup AS (
    SELECT
      organization_id,
      count(*) FILTER (WHERE cohort = 'current')::integer AS current_leads,
      count(*) FILTER (WHERE cohort = 'baseline')::integer AS baseline_leads
    FROM cohort_leads
    GROUP BY organization_id
  ), sale_rollup AS (
    SELECT
      cl.organization_id,
      count(DISTINCT cl.lead_id) FILTER (
        WHERE cl.cohort = 'current'
      )::integer AS current_converted_leads,
      count(DISTINCT cl.lead_id) FILTER (
        WHERE cl.cohort = 'baseline'
      )::integer AS baseline_converted_leads,
      count(se.id) FILTER (WHERE cl.cohort = 'current')::integer AS current_sales,
      count(se.id) FILTER (WHERE cl.cohort = 'baseline')::integer AS baseline_sales,
      coalesce(sum(se.sale_value) FILTER (WHERE cl.cohort = 'current'), 0) AS current_revenue,
      coalesce(sum(se.sale_value) FILTER (WHERE cl.cohort = 'baseline'), 0) AS baseline_revenue
    FROM cohort_leads cl
    JOIN public.sale_events se
      ON se.organization_id = cl.organization_id
     AND se.lead_id = cl.lead_id
     AND se.event_type = 'sale'
     AND se.currency = 'BRL'
     AND se.sold_at >= cl.cohort_at
     AND se.sold_at < cl.cohort_at + interval '14 days'
     AND NOT EXISTS (
       SELECT 1
       FROM public.sale_events reversal
       WHERE reversal.organization_id = se.organization_id
         AND reversal.event_type = 'sale_reversed'
         AND reversal.reversed_event_id = se.id
         AND reversal.sold_at < cl.analysis_cutoff
     )
    GROUP BY cl.organization_id
  ), org_metrics AS (
    SELECT
      b.*,
      coalesce(l.current_leads, 0)::integer AS current_leads,
      coalesce(l.baseline_leads, 0)::integer AS baseline_leads,
      coalesce(s.current_converted_leads, 0)::integer AS current_converted_leads,
      coalesce(s.baseline_converted_leads, 0)::integer AS baseline_converted_leads,
      coalesce(s.current_sales, 0)::integer AS current_sales,
      coalesce(s.baseline_sales, 0)::integer AS baseline_sales,
      coalesce(s.current_revenue, 0)::numeric AS current_revenue,
      coalesce(s.baseline_revenue, 0)::numeric AS baseline_revenue,
      (
        EXISTS (
          SELECT 1
          FROM public.activities a
          WHERE a.organization_id = b.organization_id
            AND a.created_at >= b.activity_start
            AND a.created_at < b.analysis_cutoff
            AND a.is_automated = false
            AND a.source = 'manual'
            AND a.owner_id IS NOT NULL
        )
        OR EXISTS (
          SELECT 1
          FROM public.pipeline_stage_events pse
          WHERE pse.organization_id = b.organization_id
            AND pse.occurred_at >= b.activity_start
            AND pse.occurred_at < b.analysis_cutoff
            AND pse.source = 'trigger'
            AND pse.actor IS NOT NULL
        )
      ) AS has_recent_human_activity
    FROM org_bounds b
    LEFT JOIN lead_rollup l USING (organization_id)
    LEFT JOIN sale_rollup s USING (organization_id)
  ), measured AS (
    SELECT
      m.*,
      CASE WHEN m.current_leads > 0
        THEN m.current_converted_leads::numeric * 100 / m.current_leads END AS conversion_rate_pct,
      CASE WHEN m.current_sales > 0
        THEN m.current_revenue / m.current_sales END AS average_ticket,
      CASE WHEN m.active_members > 0
        THEN m.current_leads::numeric / m.active_members END AS leads_per_active_member,
      CASE WHEN m.baseline_leads > 0
        THEN m.baseline_converted_leads::numeric * 100 / m.baseline_leads END AS previous_conversion_rate_pct,
      CASE WHEN m.baseline_sales > 0
        THEN m.baseline_revenue / m.baseline_sales END AS previous_average_ticket,
      CASE WHEN m.active_members > 0
        THEN (m.baseline_leads::numeric / 2) / m.active_members END AS previous_leads_per_active_member
    FROM org_metrics m
  ), contributors AS (
    SELECT *
    FROM measured
    WHERE current_leads >= 20
      AND has_recent_human_activity
  ), peer_counts AS (
    SELECT r.organization_id, count(c.organization_id)::integer AS peer_count
    FROM measured r
    LEFT JOIN contributors c ON c.organization_id <> r.organization_id
    GROUP BY r.organization_id
  ), peer_values AS (
    SELECT r.organization_id, 'conversion_rate_pct'::text AS metric, c.conversion_rate_pct AS value
    FROM measured r JOIN contributors c ON c.organization_id <> r.organization_id
    WHERE c.conversion_rate_pct IS NOT NULL
    UNION ALL
    SELECT r.organization_id, 'average_ticket', c.average_ticket
    FROM measured r JOIN contributors c ON c.organization_id <> r.organization_id
    WHERE c.average_ticket IS NOT NULL
    UNION ALL
    SELECT r.organization_id, 'leads_per_active_member', c.leads_per_active_member
    FROM measured r JOIN contributors c ON c.organization_id <> r.organization_id
    WHERE c.leads_per_active_member IS NOT NULL
  ), peer_medians AS (
    SELECT
      organization_id,
      metric,
      count(*)::integer AS contributor_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::numeric AS median_value
    FROM peer_values
    GROUP BY organization_id, metric
  ), peer_stats AS (
    SELECT
      p.organization_id,
      p.metric,
      p.contributor_count,
      p.median_value,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY abs(v.value - p.median_value)
      )::numeric AS median_absolute_deviation
    FROM peer_medians p
    JOIN peer_values v
      ON v.organization_id = p.organization_id
     AND v.metric = p.metric
    GROUP BY p.organization_id, p.metric, p.contributor_count, p.median_value
  ), peer_json AS (
    SELECT
      organization_id,
      jsonb_object_agg(
        metric,
        CASE WHEN contributor_count >= 5 THEN jsonb_build_object(
          'available', true,
          'contributor_count', contributor_count,
          'median', round(median_value, 2),
          'typical_range', jsonb_build_object(
            'lower', round(greatest(0, median_value - median_absolute_deviation), 2),
            'upper', round(median_value + median_absolute_deviation, 2),
            'method', 'median_absolute_deviation'
          )
        ) ELSE jsonb_build_object(
          'available', false,
          'reason', 'insufficient_base',
          'minimum_contributors', 5
        ) END
        ORDER BY metric
      ) AS metrics
    FROM peer_stats
    GROUP BY organization_id
  ), snapshots AS (
    SELECT
      m.organization_id,
      p_week_start AS snapshot_week,
      CASE WHEN pc.peer_count >= 5 THEN jsonb_build_object(
        'available', true,
        'language', 'entre as operações ativas da base Torque',
        'contributor_count', pc.peer_count,
        'eligibility', jsonb_build_object(
          'minimum_leads_in_four_closed_weeks', 20,
          'requires_recent_human_activity', true,
          'minimum_contributors', 5
        ),
        'metrics', coalesce(pj.metrics, '{}'::jsonb)
      ) ELSE jsonb_build_object(
        'available', false,
        'reason', 'insufficient_base',
        'message', 'não tenho base suficiente para comparar',
        'minimum_contributors', 5,
        'language', 'entre as operações ativas da base Torque',
        'metrics', '{}'::jsonb
      ) END AS external_benchmark,
      jsonb_build_object(
        'available', true,
        'current_period', jsonb_build_object(
          'cohort_start', (p_week_start - 42),
          'cohort_end_exclusive', (p_week_start - 14),
          'cohort_weeks', 4,
          'maturation_days', 14,
          'observed_through', p_week_start
        ),
        'previous_period', jsonb_build_object(
          'cohort_start', (p_week_start - 98),
          'cohort_end_exclusive', (p_week_start - 42),
          'cohort_weeks', 8,
          'maturation_days', 14,
          'observed_through', (p_week_start - 28)
        ),
        'metrics', jsonb_build_object(
          'conversion_rate_pct', public.oraculo_benchmark_comparison(
            m.conversion_rate_pct, m.previous_conversion_rate_pct
          ),
          'average_ticket', public.oraculo_benchmark_comparison(
            m.average_ticket, m.previous_average_ticket
          ),
          'leads_per_active_member', public.oraculo_benchmark_comparison(
            m.leads_per_active_member, m.previous_leads_per_active_member
          )
        )
      ) AS self_benchmark
    FROM measured m
    JOIN peer_counts pc USING (organization_id)
    LEFT JOIN peer_json pj USING (organization_id)
  )
  INSERT INTO public.oraculo_benchmark_weekly (
    organization_id, snapshot_week, external_benchmark, self_benchmark, generated_at
  )
  SELECT organization_id, snapshot_week, external_benchmark, self_benchmark, now()
  FROM snapshots
  ON CONFLICT (organization_id, snapshot_week) DO UPDATE
    SET external_benchmark = EXCLUDED.external_benchmark,
        self_benchmark = EXCLUDED.self_benchmark,
        generated_at = EXCLUDED.generated_at;

  GET DIAGNOSTICS v_written = ROW_COUNT;
  RETURN v_written;
END;
$$;

CREATE OR REPLACE FUNCTION public.oraculo_benchmark_comparison(
  p_current numeric,
  p_previous numeric
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'current', CASE WHEN p_current IS NULL THEN NULL ELSE round(p_current, 2) END,
    'previous', CASE WHEN p_previous IS NULL THEN NULL ELSE round(p_previous, 2) END,
    'change_pct', CASE
      WHEN p_previous IS NULL OR p_previous = 0 OR p_current IS NULL THEN NULL
      ELSE round((p_current - p_previous) * 100 / abs(p_previous), 2)
    END,
    'direction', CASE
      WHEN p_previous IS NULL THEN 'no_prior_data'
      WHEN p_current IS NULL THEN 'no_current_data'
      WHEN abs(p_current - p_previous) < 0.005 THEN 'stable'
      WHEN p_current > p_previous THEN 'up'
      ELSE 'down'
    END
  );
$$;

CREATE OR REPLACE FUNCTION public.initialize_oraculo_benchmark_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_week date;
BEGIN
  IF coalesce(NEW.is_sandbox, false)
     OR NEW.subscription_status NOT IN ('active', 'trial', 'overdue') THEN
    RETURN NEW;
  END IF;

  v_week := date_trunc(
    'week', (clock_timestamp() AT TIME ZONE NEW.timezone)::date
  )::date;

  INSERT INTO public.oraculo_benchmark_weekly (
    organization_id, snapshot_week, external_benchmark, self_benchmark, generated_at
  ) VALUES (
    NEW.id,
    v_week,
    jsonb_build_object(
      'available', false,
      'reason', 'snapshot_pending',
      'message', 'benchmark semanal ainda não materializado',
      'minimum_contributors', 5,
      'language', 'entre as operações ativas da base Torque',
      'metrics', '{}'::jsonb
    ),
    jsonb_build_object(
      'available', true,
      'current_period', jsonb_build_object(
        'cohort_start', v_week - 42,
        'cohort_end_exclusive', v_week - 14,
        'cohort_weeks', 4,
        'maturation_days', 14,
        'observed_through', v_week
      ),
      'previous_period', jsonb_build_object(
        'cohort_start', v_week - 98,
        'cohort_end_exclusive', v_week - 42,
        'cohort_weeks', 8,
        'maturation_days', 14,
        'observed_through', v_week - 28
      ),
      'metrics', jsonb_build_object(
        'conversion_rate_pct', public.oraculo_benchmark_comparison(NULL, NULL),
        'average_ticket', public.oraculo_benchmark_comparison(NULL, NULL),
        'leads_per_active_member', public.oraculo_benchmark_comparison(NULL, NULL)
      )
    ),
    clock_timestamp()
  )
  ON CONFLICT (organization_id, snapshot_week) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_initialize_oraculo_benchmark_snapshot
AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.initialize_oraculo_benchmark_snapshot();

CREATE TRIGGER trg_initialize_oraculo_benchmark_on_reactivation
AFTER UPDATE OF is_sandbox, subscription_status ON public.organizations
FOR EACH ROW
WHEN (
  (OLD.is_sandbox OR OLD.subscription_status IN ('suspended', 'cancelled', 'expired'))
  AND NOT NEW.is_sandbox
  AND NEW.subscription_status IN ('active', 'trial', 'overdue')
)
EXECUTE FUNCTION public.initialize_oraculo_benchmark_snapshot();

CREATE OR REPLACE FUNCTION public.oraculo_benchmark(p_organization_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'snapshot_week', b.snapshot_week,
    'generated_at', b.generated_at,
    'external_benchmark', b.external_benchmark,
    'self_benchmark', b.self_benchmark
  )
  FROM public.oraculo_benchmark_weekly b
  WHERE b.organization_id = p_organization_id
  ORDER BY b.snapshot_week DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.refresh_oraculo_benchmark_weekly(date) IS
  'Materializa benchmark semanal. Pares: >=20 leads/4 semanas fechadas + atividade humana; exclui sandbox, bloqueadas e a leitora. Publica somente agregados com k>=5.';
COMMENT ON FUNCTION public.oraculo_benchmark(uuid) IS
  'Leitor server-only do último benchmark já materializado. Não agrega dados durante a conversa.';

REVOKE ALL ON FUNCTION public.oraculo_benchmark_comparison(numeric,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_benchmark_week_is_closed(date,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.initialize_oraculo_benchmark_snapshot()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_oraculo_benchmark_weekly(date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.oraculo_benchmark(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_oraculo_benchmark_weekly(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.oraculo_benchmark(uuid) TO service_role;

-- Existing organizations receive a usable snapshot in the same deployment.
-- Etc/GMT+12 chooses a Monday that has already started in every IANA timezone.
SELECT public.refresh_oraculo_benchmark_weekly(
  date_trunc('week', (clock_timestamp() AT TIME ZONE 'Etc/GMT+12')::date)::date
);

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oraculo-benchmark-weekly') THEN
      PERFORM cron.unschedule('oraculo-benchmark-weekly');
    END IF;
    PERFORM cron.schedule(
      'oraculo-benchmark-weekly',
      '15 13 * * 1',
      $$SELECT public.refresh_oraculo_benchmark_weekly()$$
    );
  END IF;
END
$cron$;
