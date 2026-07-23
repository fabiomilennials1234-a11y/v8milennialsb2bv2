-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708133230  name: metrics_get_funnel_flow
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000060 (#996, ADR-0017 §1,§5,§7,§8)
CREATE OR REPLACE FUNCTION public.fn_funnel_flow_step(
  p_role text, p_reached integer, p_cohort_size integer, p_prev integer
)
RETURNS jsonb LANGUAGE sql IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'role', p_role, 'reached_count', p_reached,
    'conversion_from_top', CASE WHEN p_cohort_size > 0 THEN round(p_reached::numeric / p_cohort_size * 100, 1) ELSE NULL END,
    'conversion_from_prev', CASE WHEN p_prev IS NULL OR p_prev = 0 THEN NULL ELSE round(p_reached::numeric / p_prev * 100, 1) END
  );
$$;
COMMENT ON FUNCTION public.fn_funnel_flow_step(text, integer, integer, integer) IS 'ADR-0017 §8 / #996 — helper puro de degrau de funil. conversion_from_prev NULL-safe (prev=0 → NULL, nunca 100 forjado — mata #6).';
REVOKE ALL ON FUNCTION public.fn_funnel_flow_step(text, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_funnel_flow_step(text, integer, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_funnel_flow(
  p_org_id uuid, p_pipeline_id uuid, p_period text, p_ref date DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bounds tstzrange; v_cohort_size integer;
  v_reached_open integer; v_reached_book integer; v_reached_held integer; v_reached_won integer;
  v_lost_count integer; v_pre_cutover boolean;
BEGIN
  IF p_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'get_funnel_flow: p_pipeline_id é obrigatório (funil é por-pipeline)' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_org_access(p_org_id);
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  WITH pipe_events AS (
    SELECT e.lead_id, e.from_stage_key, e.occurred_at,
      public.metric_stage_role(p_org_id, p_pipeline_id, e.to_stage_key) AS role
    FROM public.pipeline_stage_events e
    WHERE e.organization_id = p_org_id AND e.pipeline_id = p_pipeline_id
  ),
  entry AS (
    SELECT pe.lead_id,
      COALESCE(min(pe.occurred_at) FILTER (WHERE pe.from_stage_key IS NULL), min(pe.occurred_at)) AS entry_at
    FROM pipe_events pe GROUP BY pe.lead_id
  ),
  cohort AS (SELECT en.lead_id FROM entry en WHERE en.entry_at <@ v_bounds),
  lead_reach AS (
    SELECT pe.lead_id,
      max(CASE pe.role WHEN 'meeting_booked' THEN 1 WHEN 'meeting_held' THEN 2 WHEN 'won' THEN 3 ELSE 0 END) AS max_rank,
      bool_or(pe.role = 'lost') AS ever_lost
    FROM pipe_events pe JOIN cohort c ON c.lead_id = pe.lead_id
    GROUP BY pe.lead_id
  )
  SELECT count(*),
    count(*) FILTER (WHERE lr.max_rank >= 0), count(*) FILTER (WHERE lr.max_rank >= 1),
    count(*) FILTER (WHERE lr.max_rank >= 2), count(*) FILTER (WHERE lr.max_rank >= 3),
    count(*) FILTER (WHERE lr.ever_lost)
  INTO v_cohort_size, v_reached_open, v_reached_book, v_reached_held, v_reached_won, v_lost_count
  FROM lead_reach lr;

  v_cohort_size := COALESCE(v_cohort_size, 0);
  v_reached_open := COALESCE(v_reached_open, 0);
  v_reached_book := COALESCE(v_reached_book, 0);
  v_reached_held := COALESCE(v_reached_held, 0);
  v_reached_won := COALESCE(v_reached_won, 0);
  v_lost_count := COALESCE(v_lost_count, 0);
  v_pre_cutover := lower(v_bounds) < '2026-12-01T00:00:00Z'::timestamptz;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'pipeline_id', p_pipeline_id, 'cohort_size', v_cohort_size, 'lost_count', v_lost_count,
    'pre_cutover_caveat', v_pre_cutover,
    'steps', jsonb_build_array(
      public.fn_funnel_flow_step('open', v_reached_open, v_cohort_size, NULL),
      public.fn_funnel_flow_step('meeting_booked', v_reached_book, v_cohort_size, v_reached_open),
      public.fn_funnel_flow_step('meeting_held', v_reached_held, v_cohort_size, v_reached_book),
      public.fn_funnel_flow_step('won', v_reached_won, v_cohort_size, v_reached_held)
    ),
    'lost', jsonb_build_object('role', 'lost', 'lost_count', v_lost_count,
      'conversion_from_top', CASE WHEN v_cohort_size > 0 THEN round(v_lost_count::numeric / v_cohort_size * 100, 1) ELSE NULL END)
  );
END;
$$;
COMMENT ON FUNCTION public.get_funnel_flow(uuid, uuid, text, date, date, date) IS 'ADR-0017 §1,§5,§7,§8 / #996 — leitor canônico de FUNIL coorte/fluxo (SP-3). Lê SÓ pipeline_stage_events.';
REVOKE ALL ON FUNCTION public.get_funnel_flow(uuid, uuid, text, date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_funnel_flow(uuid, uuid, text, date, date, date) TO authenticated, service_role;
