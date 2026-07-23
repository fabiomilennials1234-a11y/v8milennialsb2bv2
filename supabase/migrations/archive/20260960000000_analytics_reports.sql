-- Wave 3 — Analytics & Reporting
-- Custom reports, scheduled reports, funnel conversion, sales cycle, revenue attribution.

-- ============================================================================
-- 1. reports — saved custom reports
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  entity_type text NOT NULL CHECK (entity_type IN ('leads', 'deals', 'contacts', 'activities', 'pipelines')),
  chart_type text NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'line', 'pie', 'table', 'number', 'funnel', 'area')),
  config jsonb NOT NULL DEFAULT '{}',
  filters jsonb DEFAULT '[]',
  dimensions jsonb DEFAULT '[]',
  metrics jsonb DEFAULT '[]',
  date_range jsonb DEFAULT '{"type": "last_30_days"}',
  is_shared boolean NOT NULL DEFAULT false,
  is_favorite boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_org ON reports (organization_id);
CREATE INDEX idx_reports_owner ON reports (owner_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org reports"
  ON reports FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage own reports"
  ON reports FOR ALL
  USING (
    owner_id = auth.uid()
    OR is_shared = true
    OR is_system = true
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 2. report_schedules — automated report delivery
-- ============================================================================

CREATE TABLE IF NOT EXISTS report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
  day_of_week int CHECK (day_of_week >= 0 AND day_of_week <= 6),
  day_of_month int CHECK (day_of_month >= 1 AND day_of_month <= 28),
  hour int NOT NULL DEFAULT 8 CHECK (hour >= 0 AND hour <= 23),
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  recipients jsonb NOT NULL DEFAULT '[]',
  is_active boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_schedules_next ON report_schedules (next_run_at) WHERE is_active = true;

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org schedules"
  ON report_schedules FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage org schedules"
  ON report_schedules FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 3. dashboards — custom dashboard layouts
-- ============================================================================

CREATE TABLE IF NOT EXISTS dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  layout jsonb NOT NULL DEFAULT '[]',
  is_default boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboards_org ON dashboards (organization_id);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see org dashboards"
  ON dashboards FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage dashboards"
  ON dashboards FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- 4. RPCs for analytics
-- ============================================================================

-- Funnel conversion rates per pipeline
CREATE OR REPLACE FUNCTION get_funnel_conversion(
  p_pipeline_type text,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  stage_id uuid,
  stage_name text,
  stage_order int,
  total_entered bigint,
  total_current bigint,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH org_check AS (
    SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  ),
  stage_counts AS (
    SELECT
      ps.id AS sid,
      ps.name AS sname,
      ps.order_index,
      COUNT(DISTINCT lh.lead_id) FILTER (
        WHERE lh.action = 'stage_changed'
        AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
        AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
      ) AS entered
    FROM pipeline_stages ps
    CROSS JOIN org_check oc
    LEFT JOIN lead_history lh ON lh.metadata->>'to_stage_id' = ps.id::text
      AND lh.organization_id = oc.organization_id
    WHERE ps.pipeline_type = p_pipeline_type
      AND ps.organization_id = oc.organization_id
    GROUP BY ps.id, ps.name, ps.order_index
  )
  SELECT
    sc.sid,
    sc.sname,
    sc.order_index,
    sc.entered,
    sc.entered,
    CASE
      WHEN LAG(sc.entered) OVER (ORDER BY sc.order_index) > 0
      THEN ROUND(sc.entered::numeric / LAG(sc.entered) OVER (ORDER BY sc.order_index) * 100, 1)
      ELSE 100.0
    END AS conv_rate
  FROM stage_counts sc
  ORDER BY sc.order_index;
END;
$$;

-- Pipeline velocity metric
CREATE OR REPLACE FUNCTION get_pipeline_velocity(
  p_pipeline_type text,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Velocity = (num_deals * win_rate * avg_value) / avg_cycle_days
  WITH won_deals AS (
    SELECT
      COUNT(*) AS num_won,
      COALESCE(AVG(pp.sale_value), 0) AS avg_value
    FROM pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND (p_start_date IS NULL OR pp.created_at >= p_start_date)
      AND (p_end_date IS NULL OR pp.created_at <= p_end_date)
  ),
  all_deals AS (
    SELECT COUNT(*) AS total
    FROM pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status IN ('vendido', 'perdido')
      AND (p_start_date IS NULL OR pp.created_at >= p_start_date)
  )
  SELECT jsonb_build_object(
    'num_won', COALESCE(w.num_won, 0),
    'total_closed', COALESCE(a.total, 0),
    'win_rate', CASE WHEN a.total > 0 THEN ROUND(w.num_won::numeric / a.total * 100, 1) ELSE 0 END,
    'avg_deal_value', ROUND(w.avg_value::numeric, 2)
  ) INTO v_result
  FROM won_deals w, all_deals a;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Revenue attribution by origin
CREATE OR REPLACE FUNCTION get_revenue_attribution(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  origin text,
  lead_count bigint,
  won_count bigint,
  total_revenue numeric,
  avg_deal_value numeric,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    COALESCE(l.origin, 'unknown') AS origin,
    COUNT(DISTINCT l.id) AS lead_count,
    COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido') AS won_count,
    COALESCE(SUM(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0)::numeric AS total_revenue,
    COALESCE(AVG(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0)::numeric AS avg_deal_value,
    CASE
      WHEN COUNT(DISTINCT l.id) > 0
      THEN ROUND(COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido')::numeric / COUNT(DISTINCT l.id) * 100, 1)
      ELSE 0
    END AS conversion_rate
  FROM leads l
  LEFT JOIN pipe_propostas pp ON pp.lead_id = l.id
    AND (p_start_date IS NULL OR pp.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pp.created_at <= p_end_date)
  WHERE l.organization_id = v_org_id
    AND l.deleted_at IS NULL
    AND (p_start_date IS NULL OR l.created_at >= p_start_date)
    AND (p_end_date IS NULL OR l.created_at <= p_end_date)
  GROUP BY l.origin
  ORDER BY total_revenue DESC;
END;
$$;

-- Sales cycle: average time per stage transition
CREATE OR REPLACE FUNCTION get_sales_cycle_analysis(
  p_pipeline_type text DEFAULT 'propostas',
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  from_stage text,
  to_stage text,
  avg_hours numeric,
  median_hours numeric,
  transition_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH transitions AS (
    SELECT
      lh.metadata->>'from_stage' AS from_s,
      lh.metadata->>'to_stage' AS to_s,
      EXTRACT(EPOCH FROM (
        lh.created_at - LAG(lh.created_at) OVER (PARTITION BY lh.lead_id ORDER BY lh.created_at)
      )) / 3600.0 AS hours_diff
    FROM lead_history lh
    WHERE lh.organization_id = v_org_id
      AND lh.action = 'stage_changed'
      AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
      AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
  )
  SELECT
    t.from_s,
    t.to_s,
    ROUND(AVG(t.hours_diff)::numeric, 1) AS avg_h,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.hours_diff)::numeric, 1) AS median_h,
    COUNT(*) AS cnt
  FROM transitions t
  WHERE t.hours_diff IS NOT NULL AND t.hours_diff > 0
  GROUP BY t.from_s, t.to_s
  ORDER BY cnt DESC;
END;
$$;

-- Win/Loss analysis
CREATE OR REPLACE FUNCTION get_win_loss_analysis(
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE(
  loss_reason text,
  count bigint,
  total_value numeric,
  pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id uuid;
  v_total bigint;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_total
  FROM pipe_propostas pp
  WHERE pp.organization_id = v_org_id
    AND pp.status = 'perdido'
    AND (p_start_date IS NULL OR pp.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pp.created_at <= p_end_date);

  RETURN QUERY
  SELECT
    COALESCE(pp.loss_reason, 'Não informado') AS reason,
    COUNT(*) AS cnt,
    COALESCE(SUM(pp.sale_value), 0)::numeric AS total_val,
    CASE WHEN v_total > 0
      THEN ROUND(COUNT(*)::numeric / v_total * 100, 1)
      ELSE 0
    END AS pct
  FROM pipe_propostas pp
  WHERE pp.organization_id = v_org_id
    AND pp.status = 'perdido'
    AND (p_start_date IS NULL OR pp.created_at >= p_start_date)
    AND (p_end_date IS NULL OR pp.created_at <= p_end_date)
  GROUP BY pp.loss_reason
  ORDER BY cnt DESC;
END;
$$;
