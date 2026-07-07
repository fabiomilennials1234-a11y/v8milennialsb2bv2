-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.
-- Nota: reuniões event-sourced (ADR-0007); vendas ainda por estado com fallback
-- updated_at e COALESCE de atribuição (findings #2/#3) — migrado no SP-3 (#997).

CREATE OR REPLACE FUNCTION public.get_ranking_data(p_month integer, p_year integer, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_sales_ranking JSONB;
  v_meetings_ranking JSONB;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    v_org_id := p_organization_id;
  ELSE
    SELECT tm.organization_id INTO v_org_id
    FROM public.team_members tm WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('salesRanking', '[]'::jsonb, 'meetingsRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date + time '23:59:59.999') AT TIME ZONE 'UTC';

  WITH sales_agg AS (
    SELECT COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id) AS member_id,
           SUM(COALESCE(pp.sale_value, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id) IS NOT NULL
      AND (
        (pp.metrics_period_at IS NOT NULL AND pp.metrics_period_at >= v_start_ts AND pp.metrics_period_at <= v_end_ts)
        OR (pp.metrics_period_at IS NULL AND COALESCE(pp.closed_at, pp.updated_at) >= v_start_ts AND COALESCE(pp.closed_at, pp.updated_at) <= v_end_ts)
      )
    GROUP BY 1
  ),
  sales_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'sales') AS metric_type,
      COALESCE(sa.total_value, 0) AS total_value,
      COALESCE(sa.conversions, 0) AS conversions,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'vendas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND (tm.metric_type = 'sales' OR tm.metric_type IS NULL)
  ),
  sales_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, conversions, goal_target,
      ROW_NUMBER() OVER (ORDER BY total_value DESC) AS pos
    FROM sales_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value, 'conversions', conversions,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((total_value / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Vendas'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_sales_ranking
  FROM sales_sorted;

  -- Reuniões — event-sourced (ADR-0007): held no período da reunião,
  -- booked no período da marcação, atribuição canônica = pré-vendas (snapshot)
  WITH held_agg AS (
    SELECT me.pre_sale_responsible_id AS member_id, COUNT(*)::int AS total_meetings
    FROM public.meeting_events me
    WHERE me.organization_id = v_org_id
      AND me.event_type = 'meeting_held'
      AND me.pre_sale_responsible_id IS NOT NULL
      AND COALESCE(me.meeting_date, me.occurred_at) >= v_start_ts
      AND COALESCE(me.meeting_date, me.occurred_at) <= v_end_ts
    GROUP BY 1
  ),
  booked_agg AS (
    SELECT me.pre_sale_responsible_id AS member_id, COUNT(*)::int AS total_booked
    FROM public.meeting_events me
    WHERE me.organization_id = v_org_id
      AND me.event_type = 'meeting_booked'
      AND me.pre_sale_responsible_id IS NOT NULL
      AND me.occurred_at >= v_start_ts
      AND me.occurred_at <= v_end_ts
    GROUP BY 1
  ),
  meetings_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'meetings') AS metric_type,
      0::numeric AS total_value,
      COALESCE(ha.total_meetings, 0) AS meetings,
      COALESCE(ba.total_booked, 0) AS meetings_booked,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year
         AND g.type IN ('reunioes_realizadas', 'reunioes')
       ORDER BY CASE g.type WHEN 'reunioes_realizadas' THEN 0 ELSE 1 END, g.created_at DESC
       LIMIT 1) AS goal_target,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes_marcadas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_booked_target
    FROM public.team_members tm
    LEFT JOIN held_agg ha ON ha.member_id = tm.id
    LEFT JOIN booked_agg ba ON ba.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND tm.metric_type = 'meetings'
  ),
  meetings_sorted AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY meetings DESC, meetings_booked DESC) AS pos
    FROM meetings_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value,
      'meetings', meetings,
      'meetingsBooked', meetings_booked,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((meetings::numeric / goal_target) * 100)::int ELSE 0 END,
      'goalBooked', COALESCE(goal_booked_target, 0),
      'goalBookedProgress', CASE WHEN goal_booked_target IS NOT NULL AND goal_booked_target > 0
        THEN ROUND((meetings_booked::numeric / goal_booked_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Reuniões'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_meetings_ranking
  FROM meetings_sorted;

  RETURN jsonb_build_object('salesRanking', v_sales_ranking, 'meetingsRanking', v_meetings_ranking);
END;
$function$;
