-- =============================================================================
-- Wave 2: Portfolio RPCs for KPIs and paginated client list
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_portfolio_kpis: aggregate stats for KPI cards, alert banner, tab counts
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_portfolio_kpis(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_clients',      COUNT(*)::int,
    'total_recurring',    COALESCE(SUM(avg_ticket), 0)::numeric,
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
    AND is_active = true;
$$;

-- -----------------------------------------------------------------------------
-- get_portfolio_clients: paginated, sorted, filtered client list
-- -----------------------------------------------------------------------------
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
    'next_order_expected', 'lifetime_value', 'order_count'
  ];
  v_sort         TEXT;
  v_dir          TEXT;
  v_where        TEXT;
BEGIN
  -- Validate sort column (whitelist prevents injection)
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

  -- Base WHERE (org scoping + active only)
  v_where := format('organization_id = %L AND is_active = true', p_org_id);

  -- Search filter (name or company ILIKE)
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    );
  END IF;

  -- Tab filter
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

  -- Count total matching rows
  EXECUTE format('SELECT COUNT(*)::int FROM upsell_clients WHERE %s', v_where)
    INTO v_total;

  -- Fetch paginated rows
  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT id, name, company, phone, health_score, health_status, segment,
             avg_ticket, days_since_last_order, reorder_cycle_days,
             next_order_expected, order_count, lifetime_value, lead_id, trend
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
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_portfolio_kpis(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_portfolio_clients(UUID, TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated, service_role;
