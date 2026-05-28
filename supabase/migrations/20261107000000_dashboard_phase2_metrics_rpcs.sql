-- Phase 2: Dashboard 3-layer framework — new metric RPCs
-- ADR-0002: docs/adr/0002-dashboard-consolidation-three-layers.md

-- ============================================================
-- 1. get_pipeline_coverage
--    Ratio of open pipeline value to monthly sales goal
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_pipeline_coverage(
  p_org_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_value NUMERIC;
  v_goal_value NUMERIC;
BEGIN
  -- Sum of sale_value for proposals still in play
  SELECT COALESCE(SUM(pp.sale_value), 0)
  INTO v_open_value
  FROM pipe_propostas pp
  JOIN leads l ON l.id = pp.lead_id
  WHERE l.organization_id = p_org_id
    AND pp.status NOT IN ('vendido', 'perdido')
    AND (p_member_id IS NULL OR l.responsible_id = p_member_id);

  -- Monthly goal: individual vendas goal if member specified, else team faturamento
  IF p_member_id IS NOT NULL THEN
    SELECT COALESCE(g.target_value, 0)
    INTO v_goal_value
    FROM goals g
    WHERE g.organization_id = p_org_id
      AND g.month = p_month
      AND g.year = p_year
      AND g.team_member_id = p_member_id
      AND g.type = 'vendas'
    LIMIT 1;
  ELSE
    SELECT COALESCE(g.target_value, 0)
    INTO v_goal_value
    FROM goals g
    WHERE g.organization_id = p_org_id
      AND g.month = p_month
      AND g.year = p_year
      AND g.team_member_id IS NULL
      AND g.type = 'faturamento'
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'open_value', COALESCE(v_open_value, 0),
    'goal_value', COALESCE(v_goal_value, 0)
  );
END;
$$;

-- ============================================================
-- 2. get_stale_leads
--    Leads with no activity for N days
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_stale_leads(
  p_org_id UUID,
  p_days_threshold INTEGER DEFAULT 7,
  p_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      l.id,
      l.name,
      l.company_name,
      l.responsible_id,
      EXTRACT(DAY FROM NOW() - GREATEST(
        l.updated_at,
        COALESCE(
          (SELECT MAX(cm.created_at)
           FROM conversation_messages cm
           JOIN conversations c ON c.id = cm.conversation_id
           WHERE c.lead_id = l.id),
          l.created_at
        ),
        COALESCE(
          (SELECT MAX(lh.created_at)
           FROM lead_history lh
           WHERE lh.lead_id = l.id),
          l.created_at
        )
      ))::INTEGER AS days_inactive
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND l.status IS DISTINCT FROM 'perdido'
      AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
    HAVING EXTRACT(DAY FROM NOW() - GREATEST(
      l.updated_at,
      COALESCE(
        (SELECT MAX(cm.created_at)
         FROM conversation_messages cm
         JOIN conversations c ON c.id = cm.conversation_id
         WHERE c.lead_id = l.id),
        l.created_at
      ),
      COALESCE(
        (SELECT MAX(lh.created_at)
         FROM lead_history lh
         WHERE lh.lead_id = l.id),
        l.created_at
      )
    )) >= p_days_threshold
    ORDER BY days_inactive DESC
    LIMIT 100
  ) sub;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 3. get_win_streak
--    Consecutive days with a sale (closer) or meeting (SDR)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_win_streak(
  p_org_id UUID,
  p_member_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metric_type TEXT;
  v_dates DATE[];
  v_streak INTEGER := 0;
  v_today DATE := CURRENT_DATE;
  v_check_date DATE;
BEGIN
  -- Detect role: sales (closer) or meetings (SDR)
  SELECT COALESCE(tm.metric_type, 'meetings')
  INTO v_metric_type
  FROM team_members tm
  WHERE tm.id = p_member_id
    AND tm.organization_id = p_org_id;

  IF v_metric_type = 'sales' THEN
    SELECT ARRAY_AGG(DISTINCT d ORDER BY d DESC)
    INTO v_dates
    FROM (
      SELECT (COALESCE(pp.metrics_period_at, pp.closed_at, pp.created_at))::DATE AS d
      FROM pipe_propostas pp
      JOIN leads l ON l.id = pp.lead_id
      WHERE l.organization_id = p_org_id
        AND pp.status = 'vendido'
        AND (l.closer_id = p_member_id OR l.responsible_id = p_member_id)
        AND (COALESCE(pp.metrics_period_at, pp.closed_at, pp.created_at))::DATE
            >= v_today - INTERVAL '90 days'
    ) sub;
  ELSE
    SELECT ARRAY_AGG(DISTINCT d ORDER BY d DESC)
    INTO v_dates
    FROM (
      SELECT (COALESCE(pc.metrics_period_at, pc.updated_at))::DATE AS d
      FROM pipe_confirmacao pc
      JOIN leads l ON l.id = pc.lead_id
      WHERE l.organization_id = p_org_id
        AND pc.status = 'compareceu'
        AND (COALESCE(l.pre_sale_responsible_id, l.sdr_id) = p_member_id)
        AND (COALESCE(pc.metrics_period_at, pc.updated_at))::DATE
            >= v_today - INTERVAL '90 days'
    ) sub;
  END IF;

  IF v_dates IS NULL OR array_length(v_dates, 1) IS NULL THEN
    RETURN jsonb_build_object('streak', 0, 'metric_type', v_metric_type, 'dates', '[]'::jsonb);
  END IF;

  -- Count consecutive days starting from today
  IF v_dates[1] != v_today THEN
    RETURN jsonb_build_object('streak', 0, 'metric_type', v_metric_type, 'dates', to_jsonb(v_dates));
  END IF;

  v_streak := 1;
  FOR i IN 2..array_length(v_dates, 1) LOOP
    IF v_dates[i] = v_dates[i-1] - 1 THEN
      v_streak := v_streak + 1;
    ELSE
      EXIT;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'streak', v_streak,
    'metric_type', v_metric_type,
    'dates', to_jsonb(v_dates)
  );
END;
$$;
