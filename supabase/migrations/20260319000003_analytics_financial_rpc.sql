CREATE OR REPLACE FUNCTION get_analytics_financial_metrics(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_member_id uuid DEFAULT NULL,
  p_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH
  -- ── Sold proposals in the filter period ──────────────────────────────────
  sold_proposals AS (
    SELECT
      pp.id,
      pp.sale_value,
      pp.product_type,
      pp.closer_id,
      pp.closed_at,
      pp.contract_duration,
      l.origin
    FROM pipe_propostas pp
    JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.closed_at >= p_start_date
      AND pp.closed_at < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  ),

  -- ── Revenue by product_type (group small types as "outros") ─────────────
  revenue_raw AS (
    SELECT
      COALESCE(product_type::text, 'outros') AS product_type,
      COALESCE(SUM(sale_value), 0)           AS total_revenue,
      COUNT(*)                               AS deal_count
    FROM sold_proposals
    GROUP BY product_type
  ),
  grand_total AS (
    SELECT SUM(total_revenue) AS total FROM revenue_raw
  ),
  revenue_by_type AS (
    SELECT
      CASE
        WHEN gt.total > 0 AND rv.total_revenue / gt.total < 0.05
          AND rv.product_type NOT IN ('mrr', 'projeto', 'unitario')
        THEN 'outros'
        ELSE rv.product_type
      END AS product_type,
      SUM(rv.total_revenue) AS total_revenue,
      SUM(rv.deal_count)    AS deal_count
    FROM revenue_raw rv
    CROSS JOIN grand_total gt
    GROUP BY 1
  ),
  revenue_by_type_pct AS (
    SELECT
      rbt.product_type,
      rbt.total_revenue,
      rbt.deal_count,
      CASE
        WHEN gt.total > 0
        THEN ROUND(rbt.total_revenue / gt.total * 100, 1)
        ELSE 0
      END AS pct
    FROM revenue_by_type rbt
    CROSS JOIN grand_total gt
    ORDER BY rbt.total_revenue DESC
  ),

  -- ── MRR Evolution: last 6 complete months ────────────────────────────────
  month_series AS (
    SELECT
      generate_series(
        date_trunc('month', (p_end_date - interval '5 months'))::date,
        date_trunc('month', p_end_date)::date,
        '1 month'
      ) AS month_start
  ),
  mrr_evolution AS (
    SELECT
      ms.month_start,
      to_char(ms.month_start, 'Mon/YY') AS month_label,
      COALESCE(SUM(pp.sale_value) FILTER (
        WHERE pp.organization_id = p_org_id
          AND pp.status = 'vendido'
          AND pp.product_type = 'mrr'
          AND pp.closed_at >= ms.month_start
          AND pp.closed_at < ms.month_start + interval '1 month'
          AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
      ), 0) AS new_mrr,
      -- Churned MRR estimate: MRR deals whose contract would have ended this month
      COALESCE(SUM(pp.sale_value) FILTER (
        WHERE pp.organization_id = p_org_id
          AND pp.status = 'vendido'
          AND pp.product_type = 'mrr'
          AND pp.contract_duration IS NOT NULL
          AND (pp.closed_at + (pp.contract_duration || ' months')::interval)::date >= ms.month_start
          AND (pp.closed_at + (pp.contract_duration || ' months')::interval)::date < ms.month_start + interval '1 month'
          AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
      ), 0) AS churned_mrr_estimate
    FROM month_series ms
    CROSS JOIN pipe_propostas pp
    GROUP BY ms.month_start
    ORDER BY ms.month_start
  ),
  mrr_evolution_final AS (
    SELECT
      month_label,
      new_mrr,
      churned_mrr_estimate,
      new_mrr - churned_mrr_estimate AS net_mrr
    FROM mrr_evolution
  ),

  -- ── Seller profitability ─────────────────────────────────────────────────
  seller_revenue AS (
    SELECT
      pp.closer_id AS member_id,
      COALESCE(SUM(pp.sale_value), 0) AS revenue
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.closed_at >= p_start_date
      AND pp.closed_at < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
    GROUP BY pp.closer_id
  ),
  seller_commissions AS (
    SELECT
      c.team_member_id AS member_id,
      COALESCE(SUM(c.amount), 0) AS commission_total
    FROM commissions c
    WHERE c.organization_id = p_org_id
      AND (
        (c.year * 100 + c.month) >= (EXTRACT(YEAR FROM p_start_date)::int * 100 + EXTRACT(MONTH FROM p_start_date)::int)
        AND (c.year * 100 + c.month) <= (EXTRACT(YEAR FROM p_end_date)::int * 100 + EXTRACT(MONTH FROM p_end_date)::int)
      )
      AND (p_member_id IS NULL OR c.team_member_id = p_member_id)
    GROUP BY c.team_member_id
  ),
  seller_profitability AS (
    SELECT
      tm.id AS member_id,
      tm.name AS member_name,
      COALESCE(sr.revenue, 0) AS revenue,
      COALESCE(sc.commission_total, 0) AS commission_total,
      CASE
        WHEN COALESCE(sr.revenue, 0) > 0
        THEN ROUND((1 - COALESCE(sc.commission_total, 0) / sr.revenue) * 100, 1)
        ELSE 0
      END AS margin,
      CASE
        WHEN COALESCE(sc.commission_total, 0) > 0
        THEN ROUND(COALESCE(sr.revenue, 0) / sc.commission_total, 2)
        ELSE 0
      END AS roi
    FROM team_members tm
    LEFT JOIN seller_revenue sr ON sr.member_id = tm.id
    LEFT JOIN seller_commissions sc ON sc.member_id = tm.id
    WHERE tm.organization_id = p_org_id
      AND tm.is_active = true
      AND (COALESCE(sr.revenue, 0) > 0 OR COALESCE(sc.commission_total, 0) > 0)
    ORDER BY revenue DESC
  ),

  -- ── CAC by origin ────────────────────────────────────────────────────────
  cac_origin AS (
    SELECT
      l.origin,
      COUNT(DISTINCT l.id)                                                    AS lead_count,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido')              AS sales_count,
      COALESCE(SUM(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0)   AS total_sales_value,
      CASE
        WHEN COUNT(DISTINCT l.id) > 0 AND COALESCE(SUM(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0) > 0
        THEN ROUND(COUNT(DISTINCT l.id)::numeric / COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido'), 2)
        ELSE 0
      END AS cac_estimate
    FROM leads l
    LEFT JOIN pipe_propostas pp
      ON pp.lead_id = l.id
      AND pp.organization_id = p_org_id
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
    WHERE l.organization_id = p_org_id
      AND l.created_at >= p_start_date
      AND l.created_at < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
    GROUP BY l.origin
    HAVING COUNT(DISTINCT l.id) >= 3
    ORDER BY cac_estimate ASC
  ),

  -- ── Avg ticket by product_type per month (last 6 months) ─────────────────
  ticket_months AS (
    SELECT
      generate_series(
        date_trunc('month', (p_end_date - interval '5 months'))::date,
        date_trunc('month', p_end_date)::date,
        '1 month'
      ) AS month_start
  ),
  ticket_evolution_raw AS (
    SELECT
      to_char(tm2.month_start, 'Mon/YY') AS month_label,
      COALESCE(pp.product_type::text, 'outros') AS product_type,
      COALESCE(AVG(pp.sale_value), 0) AS avg_ticket
    FROM ticket_months tm2
    JOIN pipe_propostas pp
      ON pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.closed_at >= tm2.month_start
      AND pp.closed_at < tm2.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
    GROUP BY tm2.month_start, pp.product_type
    ORDER BY tm2.month_start, pp.product_type
  ),

  -- ── Totals ───────────────────────────────────────────────────────────────
  totals AS (
    SELECT
      COALESCE(SUM(sale_value), 0)                                           AS total_revenue,
      COALESCE(SUM(sale_value) FILTER (WHERE product_type = 'mrr'), 0)      AS total_mrr,
      COUNT(*)                                                               AS new_customers
    FROM sold_proposals
  )

  SELECT jsonb_build_object(
    'revenue_by_type',      COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM revenue_by_type_pct r), '[]'::jsonb),
    'mrr_evolution',        COALESCE((SELECT jsonb_agg(row_to_json(m)) FROM mrr_evolution_final m), '[]'::jsonb),
    'seller_profitability', COALESCE((SELECT jsonb_agg(row_to_json(s)) FROM seller_profitability s), '[]'::jsonb),
    'cac_by_origin',        COALESCE((SELECT jsonb_agg(row_to_json(c)) FROM cac_origin c), '[]'::jsonb),
    'ticket_by_type',       COALESCE((SELECT jsonb_agg(row_to_json(t)) FROM ticket_evolution_raw t), '[]'::jsonb),
    'total_revenue',        (SELECT total_revenue FROM totals),
    'total_mrr',            (SELECT total_mrr FROM totals),
    'new_customers',        (SELECT new_customers FROM totals)
  ) INTO result;

  RETURN result;
END;
$$;
