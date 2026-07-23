-- RPC: get_portfolio_trends
-- Returns time-series data for analytics dashboard sparklines and charts.
-- Single call, all series. SECURITY DEFINER for RLS bypass (org_id param enforces isolation).

CREATE OR REPLACE FUNCTION get_portfolio_trends(p_org_id UUID, p_months INT DEFAULT 6)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_revenue JSONB;
  v_health JSONB;
  v_retention JSONB;
  v_churn JSONB;
  v_segments JSONB;
  v_start_date DATE;
BEGIN
  v_start_date := date_trunc('month', CURRENT_DATE - (p_months || ' months')::interval)::date;

  -- 1. Revenue monthly (approved vs pending)
  SELECT COALESCE(jsonb_agg(row_data ORDER BY month), '[]'::jsonb)
  INTO v_revenue
  FROM (
    SELECT jsonb_build_object(
      'month', to_char(date_trunc('month', o.sold_at), 'YYYY-MM'),
      'approved', COALESCE(SUM(o.sale_value) FILTER (WHERE o.approval_status = 'approved'), 0),
      'pending', COALESCE(SUM(o.sale_value) FILTER (WHERE o.approval_status = 'pending'), 0)
    ) AS row_data,
    date_trunc('month', o.sold_at) AS month
    FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE c.organization_id = p_org_id
      AND o.sold_at >= v_start_date
    GROUP BY date_trunc('month', o.sold_at)
  ) sub;

  -- 2. Health daily (last 30 days, org-wide average)
  SELECT COALESCE(jsonb_agg(row_data ORDER BY d), '[]'::jsonb)
  INTO v_health
  FROM (
    SELECT jsonb_build_object(
      'date', s.snapshot_date::text,
      'avg_score', ROUND(AVG(s.health_score))
    ) AS row_data,
    s.snapshot_date AS d
    FROM client_health_snapshots s
    WHERE s.organization_id = p_org_id
      AND s.snapshot_date >= CURRENT_DATE - 30
    GROUP BY s.snapshot_date
  ) sub;

  -- 3. Retention monthly (M1 retention per cohort from view)
  SELECT COALESCE(jsonb_agg(row_data ORDER BY cm), '[]'::jsonb)
  INTO v_retention
  FROM (
    SELECT jsonb_build_object(
      'month', to_char(cohort_month, 'YYYY-MM'),
      'rate', CASE WHEN SUM(total_clients) > 0
        THEN ROUND(SUM(active_clients)::numeric / SUM(total_clients) * 100)
        ELSE 0
      END
    ) AS row_data,
    cohort_month AS cm
    FROM portfolio_retention_cohorts
    WHERE organization_id = p_org_id
      AND month_offset = 1
      AND cohort_month >= v_start_date
    GROUP BY cohort_month
  ) sub;

  -- 4. Churn summary (clients with churn_probability > 50)
  SELECT jsonb_build_object(
    'count', COUNT(*)::int,
    'total_value', COALESCE(SUM(avg_ticket), 0)::numeric
  )
  INTO v_churn
  FROM upsell_clients
  WHERE organization_id = p_org_id
    AND is_active = true
    AND churn_probability > 50;

  -- 5. Segment monthly (from snapshots)
  SELECT COALESCE(jsonb_agg(row_data ORDER BY m), '[]'::jsonb)
  INTO v_segments
  FROM (
    SELECT jsonb_build_object(
      'month', to_char(date_trunc('month', s.snapshot_date), 'YYYY-MM'),
      'ouro', COUNT(*) FILTER (WHERE s.segment = 'ouro'),
      'prata', COUNT(*) FILTER (WHERE s.segment = 'prata'),
      'novo', COUNT(*) FILTER (WHERE s.segment = 'novo'),
      'resgate', COUNT(*) FILTER (WHERE s.segment = 'resgate'),
      'dormindo', COUNT(*) FILTER (WHERE s.segment = 'dormindo')
    ) AS row_data,
    date_trunc('month', s.snapshot_date) AS m
    FROM client_health_snapshots s
    WHERE s.organization_id = p_org_id
      AND s.snapshot_date >= v_start_date
    GROUP BY date_trunc('month', s.snapshot_date)
  ) sub;

  v_result := jsonb_build_object(
    'revenue_monthly', v_revenue,
    'health_daily', v_health,
    'retention_monthly', v_retention,
    'churn_summary', v_churn,
    'segment_monthly', v_segments
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_portfolio_trends(UUID, INT) TO authenticated, service_role;
