-- Extend get_ranking_data to include goal (target) in output for Metas display.
-- Add get_metas_podium_data RPC for Metas tab: returns closerGoals/sdrGoals
-- with current, goal, percentage for all org members (SECURITY DEFINER bypasses RLS).
-- Enables public visibility of everyone's goals and sales within the organization.
-- Data: 2026-03-14

-- 1. Extend get_ranking_data to output goal (target) for both closers and SDRs
CREATE OR REPLACE FUNCTION public.get_ranking_data(p_month INT, p_year INT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id UUID;
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_closer_ranking JSONB := '[]'::jsonb;
  v_sdr_ranking JSONB := '[]'::jsonb;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND is_active = true
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('closerRanking', '[]'::jsonb, 'sdrRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date + time '23:59:59.999') AT TIME ZONE 'UTC';

  WITH sales_agg AS (
    SELECT closer_id, SUM(COALESCE(pp.sale_value, 0))::numeric AS total_value, COUNT(*)::int AS conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND pp.closer_id IS NOT NULL
      AND (
        (pp.metrics_period_at IS NOT NULL AND pp.metrics_period_at >= v_start_ts AND pp.metrics_period_at <= v_end_ts)
        OR (pp.metrics_period_at IS NULL AND pp.closed_at >= v_start_ts AND pp.closed_at <= v_end_ts)
      )
    GROUP BY closer_id
  ),
  closers_data AS (
    SELECT tm.id, tm.name,
      COALESCE(sa.total_value, 0) AS total_value,
      COALESCE(sa.conversions, 0) AS conversions,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'vendas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.closer_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true AND tm.role = 'closer'
  ),
  closers_sorted AS (
    SELECT id, name, total_value, conversions, goal_target,
      ROW_NUMBER() OVER (ORDER BY total_value DESC) AS pos
    FROM closers_data
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'value', total_value, 'conversions', conversions,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((total_value / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Closer'
    ) ORDER BY pos
  ) INTO v_closer_ranking
  FROM closers_sorted;

  IF v_closer_ranking IS NULL THEN
    v_closer_ranking := '[]'::jsonb;
  END IF;

  WITH meetings_agg AS (
    SELECT sdr_id, COUNT(*)::int AS meeting_count
    FROM public.pipe_confirmacao
    WHERE organization_id = v_org_id
      AND status = 'compareceu'
      AND sdr_id IS NOT NULL
      AND (
        (metrics_period_at IS NOT NULL AND metrics_period_at >= v_start_ts AND metrics_period_at <= v_end_ts)
        OR (metrics_period_at IS NULL AND created_at >= v_start_ts AND created_at <= v_end_ts)
      )
    GROUP BY sdr_id
  ),
  sdrs_data AS (
    SELECT tm.id, tm.name,
      COALESCE(ma.meeting_count, 0) AS meeting_count,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN meetings_agg ma ON ma.sdr_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true AND tm.role = 'sdr'
  ),
  sdrs_sorted AS (
    SELECT id, name, meeting_count, goal_target,
      ROW_NUMBER() OVER (ORDER BY meeting_count DESC) AS pos
    FROM sdrs_data
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'value', 0, 'meetings', meeting_count,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((meeting_count::numeric / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'SDR'
    ) ORDER BY pos
  ) INTO v_sdr_ranking
  FROM sdrs_sorted;

  IF v_sdr_ranking IS NULL THEN
    v_sdr_ranking := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object('closerRanking', v_closer_ranking, 'sdrRanking', v_sdr_ranking);
END;
$$;

COMMENT ON FUNCTION public.get_ranking_data(INT, INT) IS
  'Retorna ranking agregado de closers (vendas) e SDRs (reuniões comparecidas) para o pódio. Inclui goal para exibição na aba Metas. SECURITY DEFINER permite que todos os roles vejam dados da equipe.';
