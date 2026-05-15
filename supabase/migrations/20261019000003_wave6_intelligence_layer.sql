-- =============================================================================
-- Wave 6: Intelligence Layer — churn prediction, cohorts, revenue at risk,
-- vendedor ranking, AI next-best-action cache
-- =============================================================================

-- W6.1: Churn probability on upsell_clients
ALTER TABLE upsell_clients ADD COLUMN IF NOT EXISTS churn_probability INTEGER DEFAULT 0
  CHECK (churn_probability >= 0 AND churn_probability <= 100);

-- W6.5: Cache for AI-generated retention suggestions
CREATE TABLE IF NOT EXISTS retention_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  action_type TEXT NOT NULL,
  message TEXT NOT NULL,
  reasoning TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE(client_id)
);

ALTER TABLE retention_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retention_suggestions_select_org" ON retention_suggestions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "retention_suggestions_service_all" ON retention_suggestions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT ALL ON retention_suggestions TO service_role;
GRANT SELECT ON retention_suggestions TO authenticated;

-- W6.2: Cohort retention view
CREATE OR REPLACE VIEW portfolio_retention_cohorts AS
WITH cohort_base AS (
  SELECT
    c.id AS client_id,
    c.organization_id,
    c.closer_id,
    c.segment,
    date_trunc('month', c.first_sale_at) AS cohort_month,
    c.first_sale_at
  FROM upsell_clients c
  WHERE c.is_active = true
    AND c.first_sale_at IS NOT NULL
),
months AS (
  SELECT generate_series(0, 11) AS month_offset
),
cohort_orders AS (
  SELECT
    cb.client_id,
    cb.organization_id,
    cb.cohort_month,
    cb.closer_id,
    cb.segment,
    m.month_offset,
    EXISTS (
      SELECT 1 FROM upsell_orders o
      WHERE o.client_id = cb.client_id
        AND date_trunc('month', o.sold_at) = cb.cohort_month + (m.month_offset || ' months')::interval
    ) AS had_order
  FROM cohort_base cb
  CROSS JOIN months m
  WHERE cb.cohort_month + (m.month_offset || ' months')::interval <= date_trunc('month', now())
)
SELECT
  organization_id,
  cohort_month,
  closer_id,
  segment,
  month_offset,
  COUNT(DISTINCT client_id) FILTER (WHERE had_order) AS active_clients,
  COUNT(DISTINCT client_id) AS total_clients,
  ROUND(
    COUNT(DISTINCT client_id) FILTER (WHERE had_order)::numeric
    / NULLIF(COUNT(DISTINCT client_id), 0) * 100
  ) AS retention_pct
FROM cohort_orders
GROUP BY organization_id, cohort_month, closer_id, segment, month_offset;

-- W6.3: Revenue at Risk RPC
CREATE OR REPLACE FUNCTION get_revenue_at_risk(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH risk_windows AS (
    SELECT
      c.id,
      c.name,
      c.segment,
      c.avg_ticket,
      c.next_order_expected,
      c.health_score,
      c.churn_probability,
      CASE
        WHEN c.next_order_expected::date <= CURRENT_DATE + 7 THEN '7d'
        WHEN c.next_order_expected::date <= CURRENT_DATE + 14 THEN '14d'
        WHEN c.next_order_expected::date <= CURRENT_DATE + 30 THEN '30d'
        ELSE NULL
      END AS risk_window
    FROM upsell_clients c
    WHERE c.organization_id = p_org_id
      AND c.is_active = true
      AND c.next_order_expected IS NOT NULL
      AND c.next_order_expected::date <= CURRENT_DATE + 30
      AND c.avg_ticket IS NOT NULL
  )
  SELECT jsonb_build_object(
    'windows', jsonb_build_object(
      '7d', jsonb_build_object(
        'total', COALESCE(SUM(avg_ticket) FILTER (WHERE risk_window = '7d' OR next_order_expected::date <= CURRENT_DATE + 7), 0),
        'count', COUNT(*) FILTER (WHERE risk_window = '7d' OR next_order_expected::date <= CURRENT_DATE + 7),
        'ouro_total', COALESCE(SUM(avg_ticket) FILTER (WHERE (risk_window = '7d' OR next_order_expected::date <= CURRENT_DATE + 7) AND segment = 'ouro'), 0)
      ),
      '14d', jsonb_build_object(
        'total', COALESCE(SUM(avg_ticket) FILTER (WHERE next_order_expected::date <= CURRENT_DATE + 14), 0),
        'count', COUNT(*) FILTER (WHERE next_order_expected::date <= CURRENT_DATE + 14),
        'ouro_total', COALESCE(SUM(avg_ticket) FILTER (WHERE next_order_expected::date <= CURRENT_DATE + 14 AND segment = 'ouro'), 0)
      ),
      '30d', jsonb_build_object(
        'total', COALESCE(SUM(avg_ticket), 0),
        'count', COUNT(*),
        'ouro_total', COALESCE(SUM(avg_ticket) FILTER (WHERE segment = 'ouro'), 0)
      )
    ),
    'top_risk_clients', (
      SELECT jsonb_agg(jsonb_build_object(
        'id', sub.id,
        'name', sub.name,
        'segment', sub.segment,
        'avg_ticket', sub.avg_ticket,
        'next_order_expected', sub.next_order_expected,
        'churn_probability', sub.churn_probability
      ) ORDER BY sub.avg_ticket DESC)
      FROM (
        SELECT * FROM risk_windows
        WHERE segment = 'ouro'
        ORDER BY avg_ticket DESC
        LIMIT 5
      ) sub
    )
  )
  FROM risk_windows;
$$;

GRANT EXECUTE ON FUNCTION get_revenue_at_risk(UUID) TO authenticated, service_role;

-- W6.4: Vendedor ranking RPC
CREATE OR REPLACE FUNCTION get_vendedor_ranking(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_health DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'closer_id', tm.id,
      'name', tm.name,
      'role', tm.role,
      'total_clients', COUNT(c.id),
      'avg_health', ROUND(AVG(c.health_score)),
      'avg_churn', ROUND(AVG(c.churn_probability)),
      'avg_ticket', ROUND(AVG(c.avg_ticket)::numeric, 2),
      'total_revenue', SUM(c.lifetime_value),
      'on_time_pct', ROUND(
        COUNT(*) FILTER (
          WHERE c.days_since_last_order <= c.reorder_cycle_days
        )::numeric / NULLIF(COUNT(*) FILTER (WHERE c.reorder_cycle_days > 0), 0) * 100
      ),
      'segments', jsonb_build_object(
        'ouro', COUNT(*) FILTER (WHERE c.segment = 'ouro'),
        'prata', COUNT(*) FILTER (WHERE c.segment = 'prata'),
        'novo', COUNT(*) FILTER (WHERE c.segment = 'novo'),
        'resgate', COUNT(*) FILTER (WHERE c.segment = 'resgate'),
        'dormindo', COUNT(*) FILTER (WHERE c.segment = 'dormindo')
      )
    ) AS row_data
    FROM team_members tm
    JOIN upsell_clients c ON c.closer_id = tm.id AND c.is_active = true
    WHERE c.organization_id = p_org_id
      AND tm.is_active = true
    GROUP BY tm.id, tm.name, tm.role
    HAVING COUNT(c.id) > 0
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION get_vendedor_ranking(UUID) TO authenticated, service_role;
