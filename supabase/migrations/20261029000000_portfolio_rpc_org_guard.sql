-- =============================================================================
-- Migration: Add org membership guard to all portfolio SECURITY DEFINER RPCs
-- Fixes: any authenticated user could call RPCs with arbitrary org UUID
-- =============================================================================

-- 1. Reusable helper: raises exception if caller is not a member of the org
CREATE OR REPLACE FUNCTION assert_org_member(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM team_members
    WHERE organization_id = p_org_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'access_denied'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION assert_org_member(UUID) TO authenticated;

-- 2. Recreate get_portfolio_kpis with org guard + fixed recurring revenue formula
CREATE OR REPLACE FUNCTION get_portfolio_kpis(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_org_member(p_org_id);

  RETURN (
    SELECT jsonb_build_object(
      'total_clients',      COUNT(*)::int,
      'total_recurring',    COALESCE(SUM(
                              avg_ticket * (30.0 / GREATEST(COALESCE(reorder_cycle_days, 30), 1))
                            ), 0)::numeric,
      'overdue_count',      COUNT(*) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order > reorder_cycle_days * 1.15
                            )::int,
      'overdue_revenue',    COALESCE(SUM(avg_ticket) FILTER (
                              WHERE days_since_last_order IS NOT NULL
                                AND reorder_cycle_days IS NOT NULL
                                AND days_since_last_order > reorder_cycle_days * 1.15
                            ), 0)::numeric,
      'avg_health',         COALESCE(ROUND(AVG(health_score)), 0)::int,
      'avg_ticket',         CASE WHEN COUNT(*) > 0
                              THEN ROUND(COALESCE(SUM(avg_ticket), 0) / COUNT(*))::numeric
                              ELSE 0
                            END,
      'expected_this_week', COUNT(*) FILTER (
                              WHERE next_order_expected IS NOT NULL
                                AND next_order_expected >= NOW()
                                AND next_order_expected <= NOW() + INTERVAL '7 days'
                            )::int,
      'segment_counts',     jsonb_build_object(
                              'ouro',     COUNT(*) FILTER (WHERE segment = 'ouro')::int,
                              'prata',    COUNT(*) FILTER (WHERE segment = 'prata')::int,
                              'novo',     COUNT(*) FILTER (WHERE segment = 'novo')::int,
                              'resgate',  COUNT(*) FILTER (WHERE segment = 'resgate')::int,
                              'dormindo', COUNT(*) FILTER (WHERE segment = 'dormindo')::int
                            )
    )
    FROM upsell_clients
    WHERE organization_id = p_org_id
      AND is_active = true
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN NULL; END IF;
    RAISE;
END;
$$;

-- 3. Recreate get_portfolio_clients with org guard
CREATE OR REPLACE FUNCTION get_portfolio_clients(
  p_org_id    UUID,
  p_filter    TEXT    DEFAULT 'all',
  p_search    TEXT    DEFAULT '',
  p_sort_by   TEXT    DEFAULT 'name',
  p_sort_dir  TEXT    DEFAULT 'asc',
  p_page      INT     DEFAULT 1,
  p_page_size INT     DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset       INT := (p_page - 1) * p_page_size;
  v_total        INT;
  v_rows         JSONB;
  v_allowed_sorts TEXT[] := ARRAY[
    'name', 'health_score', 'avg_ticket', 'days_since_last_order',
    'next_order_expected', 'lifetime_value', 'order_count', 'churn_probability'
  ];
  v_sort         TEXT;
  v_dir          TEXT;
  v_where        TEXT;
BEGIN
  PERFORM assert_org_member(p_org_id);

  IF p_sort_by = ANY(v_allowed_sorts) THEN
    v_sort := p_sort_by;
  ELSE
    v_sort := 'name';
  END IF;

  IF lower(p_sort_dir) = 'desc' THEN
    v_dir := 'DESC';
  ELSE
    v_dir := 'ASC';
  END IF;

  v_where := format('organization_id = %L AND is_active = true', p_org_id);

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    );
  END IF;

  IF p_filter = 'overdue' THEN
    v_where := v_where
      || ' AND days_since_last_order IS NOT NULL'
      || ' AND reorder_cycle_days IS NOT NULL'
      || ' AND days_since_last_order > reorder_cycle_days * 1.15';
  ELSIF p_filter = 'expected' THEN
    v_where := v_where
      || ' AND next_order_expected IS NOT NULL'
      || ' AND next_order_expected >= NOW()'
      || ' AND next_order_expected <= NOW() + INTERVAL ''7 days''';
  ELSIF p_filter IN ('ouro', 'prata', 'novo', 'resgate', 'dormindo') THEN
    v_where := v_where || format(' AND segment = %L', p_filter);
  END IF;

  EXECUTE format('SELECT COUNT(*)::int FROM upsell_clients WHERE %s', v_where)
    INTO v_total;

  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT id, name, company, phone, health_score, health_status, segment,
             avg_ticket, days_since_last_order, reorder_cycle_days,
             next_order_expected, order_count, lifetime_value, lead_id, trend,
             churn_probability
      FROM upsell_clients
      WHERE %s
      ORDER BY %I %s NULLS LAST
      LIMIT %s OFFSET %s
    ) t
    $q$,
    v_where, v_sort, v_dir, p_page_size, v_offset
  ) INTO v_rows;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total',       v_total,
    'page',        p_page,
    'page_size',   p_page_size,
    'total_pages', GREATEST(CEIL(v_total::numeric / p_page_size)::int, 1)
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN
      RETURN jsonb_build_object(
        'rows', '[]'::jsonb, 'total', 0,
        'page', p_page, 'page_size', p_page_size, 'total_pages', 1
      );
    END IF;
    RAISE;
END;
$$;

-- 4. Recreate get_revenue_at_risk with org guard
CREATE OR REPLACE FUNCTION get_revenue_at_risk(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_org_member(p_org_id);

  RETURN (
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
    FROM risk_windows
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN NULL; END IF;
    RAISE;
END;
$$;

-- 5. Recreate get_vendedor_ranking with org guard
CREATE OR REPLACE FUNCTION get_vendedor_ranking(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM assert_org_member(p_org_id);

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_health DESC), '[]'::jsonb)
    FROM (
      SELECT
        ROUND(AVG(c.health_score)) AS sort_health,
        jsonb_build_object(
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
    ) sub
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN RETURN '[]'::jsonb; END IF;
    RAISE;
END;
$$;

-- 6. Grants (re-affirm)
GRANT EXECUTE ON FUNCTION get_portfolio_kpis(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_portfolio_clients(UUID, TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_revenue_at_risk(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_vendedor_ranking(UUID) TO authenticated, service_role;
