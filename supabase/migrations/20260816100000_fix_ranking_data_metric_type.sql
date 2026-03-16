-- Fix: get_ranking_data agora filtra por metric_type ('sales'/'meetings') ao invés de
-- role ('closer'/'sdr') que não existem mais após a migration 20260804.
-- Também adiciona fallback responsible_id nos JOINs e retorna salesRanking/meetingsRanking.

-- Drop a versão antiga (assinatura idêntica, mas precisa recriar para mudar corpo)
DROP FUNCTION IF EXISTS public.get_ranking_data(INT, INT, UUID);

CREATE OR REPLACE FUNCTION public.get_ranking_data(
  p_month INT,
  p_year INT,
  p_organization_id UUID DEFAULT NULL
)
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
  v_sales_ranking JSONB := '[]'::jsonb;
  v_meetings_ranking JSONB := '[]'::jsonb;
BEGIN
  -- Validar organização do usuário autenticado
  IF p_organization_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid()
      AND organization_id = p_organization_id
      AND is_active = true
    LIMIT 1;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid()
      AND is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('salesRanking', '[]'::jsonb, 'meetingsRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date + time '23:59:59.999') AT TIME ZONE 'UTC';

  -- Ranking de Vendas (metric_type = 'sales')
  WITH sales_agg AS (
    SELECT COALESCE(pp.responsible_id, pp.closer_id) AS member_id,
           SUM(COALESCE(pp.sale_value, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.responsible_id, pp.closer_id) IS NOT NULL
      AND (
        (pp.metrics_period_at IS NOT NULL AND pp.metrics_period_at >= v_start_ts AND pp.metrics_period_at <= v_end_ts)
        OR (pp.metrics_period_at IS NULL AND pp.closed_at >= v_start_ts AND pp.closed_at <= v_end_ts)
      )
    GROUP BY member_id
  ),
  sales_data AS (
    SELECT tm.id, tm.name, tm.job_title, tm.metric_type,
      COALESCE(sa.total_value, 0) AS total_value,
      COALESCE(sa.conversions, 0) AS conversions,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'vendas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true AND tm.metric_type = 'sales'
  ),
  sales_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, conversions, goal_target,
      ROW_NUMBER() OVER (ORDER BY total_value DESC) AS pos
    FROM sales_data
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value, 'conversions', conversions,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((total_value / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Vendas'
    ) ORDER BY pos
  ) INTO v_sales_ranking
  FROM sales_sorted;

  IF v_sales_ranking IS NULL THEN
    v_sales_ranking := '[]'::jsonb;
  END IF;

  -- Ranking de Reuniões (metric_type = 'meetings')
  WITH meetings_agg AS (
    SELECT COALESCE(pc.responsible_id, pc.sdr_id) AS member_id,
           COUNT(*)::int AS meeting_count
    FROM public.pipe_confirmacao pc
    WHERE pc.organization_id = v_org_id
      AND pc.status = 'compareceu'
      AND COALESCE(pc.responsible_id, pc.sdr_id) IS NOT NULL
      AND (
        (pc.metrics_period_at IS NOT NULL AND pc.metrics_period_at >= v_start_ts AND pc.metrics_period_at <= v_end_ts)
        OR (pc.metrics_period_at IS NULL AND pc.created_at >= v_start_ts AND pc.created_at <= v_end_ts)
      )
    GROUP BY member_id
  ),
  meetings_data AS (
    SELECT tm.id, tm.name, tm.job_title, tm.metric_type,
      COALESCE(ma.meeting_count, 0) AS meeting_count,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN meetings_agg ma ON ma.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true AND tm.metric_type = 'meetings'
  ),
  meetings_sorted AS (
    SELECT id, name, job_title, metric_type, meeting_count, goal_target,
      ROW_NUMBER() OVER (ORDER BY meeting_count DESC) AS pos
    FROM meetings_data
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', 0, 'meetings', meeting_count,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((meeting_count::numeric / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Reuniões'
    ) ORDER BY pos
  ) INTO v_meetings_ranking
  FROM meetings_sorted;

  IF v_meetings_ranking IS NULL THEN
    v_meetings_ranking := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object('salesRanking', v_sales_ranking, 'meetingsRanking', v_meetings_ranking);
END;
$$;

COMMENT ON FUNCTION public.get_ranking_data(INT, INT, UUID) IS
  'Retorna ranking de vendas (metric_type=sales) e reuniões (metric_type=meetings) filtrado por organização. Corrigido para usar metric_type ao invés de role após refatoração 20260804.';

COMMENT ON COLUMN public.goals.current_value IS
  'Deprecated — progresso calculado em tempo real via pipe_propostas e pipe_confirmacao. Esta coluna não é atualizada.';
