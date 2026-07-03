CREATE OR REPLACE FUNCTION public.get_analytics_financial_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
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
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) < (p_end_date + interval '1 day')
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
          AND COALESCE(pp.metrics_period_at, pp.closed_at) >= ms.month_start
          AND COALESCE(pp.metrics_period_at, pp.closed_at) < ms.month_start + interval '1 month'
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
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) < (p_end_date + interval '1 day')
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
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
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
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= tm2.month_start
      AND COALESCE(pp.metrics_period_at, pp.closed_at) < tm2.month_start + interval '1 month'
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
$function$;

CREATE OR REPLACE FUNCTION public.get_analytics_overview_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  result jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  WITH

  -- ── Base: sold proposals in the period ───────────────────────────────────
  sold_proposals AS (
    SELECT
      pp.id,
      pp.lead_id,
      pp.sale_value,
      pp.product_type,
      pp.closer_id,
      pp.closed_at,
      pp.contract_duration,
      pp.created_at AS proposal_created_at,
      l.origin,
      l.created_at AS lead_created_at
    FROM pipe_propostas pp
    JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  ),

  -- ── Cohort: last 6 acquisition months ────────────────────────────────────
  cohort_months AS (
    SELECT
      generate_series(
        date_trunc('month', (p_end_date - interval '5 months'))::date,
        date_trunc('month', p_end_date)::date,
        '1 month'
      ) AS cohort_start
  ),
  cohort_customers AS (
    SELECT
      date_trunc('month', sp.closed_at)::date AS cohort_start,
      sp.lead_id,
      sp.closed_at,
      sp.contract_duration,
      COALESCE(sp.sale_value, 0) AS sale_value
    FROM sold_proposals sp
    WHERE date_trunc('month', sp.closed_at)::date >= (
      SELECT MIN(cohort_start) FROM cohort_months
    )
  ),
  -- Count customers per cohort
  cohort_sizes AS (
    SELECT cohort_start, COUNT(DISTINCT lead_id) AS total_customers
    FROM cohort_customers
    GROUP BY cohort_start
    HAVING COUNT(DISTINCT lead_id) > 0
  ),
  -- For each (cohort, month_index) pair, count retained customers
  cohort_retention AS (
    SELECT
      cc.cohort_start,
      EXTRACT(YEAR FROM age(
        (date_trunc('month', cc.cohort_start) + (mn.month_index || ' months')::interval)::date,
        cc.cohort_start
      ))::int * 12 +
      EXTRACT(MONTH FROM age(
        (date_trunc('month', cc.cohort_start) + (mn.month_index || ' months')::interval)::date,
        cc.cohort_start
      ))::int AS month_index,
      COUNT(DISTINCT cc.lead_id) AS retained
    FROM cohort_customers cc
    CROSS JOIN (SELECT generate_series(0, 5) AS month_index) mn
    WHERE
      -- contract still active OR made another purchase in that month
      (
        cc.contract_duration IS NOT NULL AND
        (cc.closed_at + (cc.contract_duration || ' months')::interval)::date >
          (date_trunc('month', cc.cohort_start) + (mn.month_index || ' months')::interval + interval '1 month' - interval '1 day')::date
      )
      OR mn.month_index = 0
    GROUP BY cc.cohort_start, mn.month_index
  ),
  cohort_data_raw AS (
    SELECT
      cs.cohort_start,
      to_char(cs.cohort_start, 'Mon/YY') AS cohort_month,
      cs.total_customers,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'month_index', cr2.month_index,
              'pct', CASE WHEN cs.total_customers > 0
                THEN ROUND(cr2.retained::numeric / cs.total_customers * 100, 1)
                ELSE 0
              END
            ) ORDER BY cr2.month_index
          )
          FROM cohort_retention cr2
          WHERE cr2.cohort_start = cs.cohort_start
            AND cr2.month_index <= (
              EXTRACT(YEAR FROM age(date_trunc('month', p_end_date)::date, cs.cohort_start))::int * 12 +
              EXTRACT(MONTH FROM age(date_trunc('month', p_end_date)::date, cs.cohort_start))::int
            )
        ),
        '[]'::jsonb
      ) AS retention
    FROM cohort_sizes cs
    WHERE cs.cohort_start IN (SELECT cohort_start FROM cohort_months)
    ORDER BY cs.cohort_start
  ),
  cohort_count AS (SELECT COUNT(*) AS cnt FROM cohort_data_raw),

  -- ── Unit Economics ────────────────────────────────────────────────────────
  all_customers AS (
    SELECT DISTINCT lead_id
    FROM pipe_propostas
    WHERE organization_id = p_org_id
      AND status = 'vendido'
  ),
  total_customers_all AS (
    SELECT COUNT(*) AS cnt FROM all_customers
  ),
  team_size AS (
    SELECT COUNT(*) AS cnt
    FROM team_members
    WHERE organization_id = p_org_id AND is_active = true
  ),
  period_commissions AS (
    SELECT COALESCE(SUM(amount), 0) AS total_commissions
    FROM commissions
    WHERE organization_id = p_org_id
      AND (
        (year * 100 + month) >= (EXTRACT(YEAR FROM p_start_date)::int * 100 + EXTRACT(MONTH FROM p_start_date)::int)
        AND (year * 100 + month) <= (EXTRACT(YEAR FROM p_end_date)::int * 100 + EXTRACT(MONTH FROM p_end_date)::int)
      )
      AND (p_member_id IS NULL OR team_member_id = p_member_id)
  ),
  new_customers_period AS (
    SELECT COUNT(DISTINCT lead_id) AS cnt
    FROM sold_proposals
  ),
  avg_ticket_all AS (
    SELECT COALESCE(AVG(sale_value), 0) AS avg_ticket
    FROM pipe_propostas
    WHERE organization_id = p_org_id
      AND status = 'vendido'
      AND sale_value IS NOT NULL
  ),
  -- Churn: customers whose contract ended in the last 90 days and didn't renew
  churn_base AS (
    SELECT
      pp.lead_id,
      pp.closed_at,
      pp.contract_duration,
      (pp.closed_at + (COALESCE(pp.contract_duration, 12) || ' months')::interval)::date AS contract_end_date
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.contract_duration IS NOT NULL
      AND (pp.closed_at + (pp.contract_duration || ' months')::interval)::date >= (p_end_date - interval '90 days')::date
      AND (pp.closed_at + (pp.contract_duration || ' months')::interval)::date <= p_end_date
  ),
  churned_leads AS (
    SELECT cb.lead_id
    FROM churn_base cb
    WHERE NOT EXISTS (
      SELECT 1 FROM pipe_propostas pp2
      WHERE pp2.lead_id = cb.lead_id
        AND pp2.organization_id = p_org_id
        AND pp2.status = 'vendido'
        AND pp2.closed_at > cb.contract_end_date
    )
  ),
  churn_metrics AS (
    SELECT
      COUNT(*) AS churned_count,
      (SELECT COUNT(*) FROM churn_base) AS eligible_count
    FROM churned_leads
  ),
  unit_econ AS (
    SELECT
      -- CAC estimate: total commissions / new customers
      CASE WHEN (SELECT cnt FROM new_customers_period) > 0
        THEN ROUND((SELECT total_commissions FROM period_commissions) / (SELECT cnt FROM new_customers_period), 2)
        ELSE 0
      END AS cac_estimate,
      -- Churn rate
      CASE WHEN (SELECT eligible_count FROM churn_metrics) > 0
        THEN ROUND((SELECT churned_count FROM churn_metrics)::numeric / (SELECT eligible_count FROM churn_metrics) * 100, 1)
        ELSE 0
      END AS churn_rate_estimate
  ),
  unit_econ_final AS (
    SELECT
      ue.cac_estimate,
      ue.churn_rate_estimate,
      -- LTV = avg_ticket / (churn_rate / 100), capped at 10x avg ticket when churn = 0
      CASE
        WHEN ue.churn_rate_estimate > 0
        THEN ROUND((SELECT avg_ticket FROM avg_ticket_all) / (ue.churn_rate_estimate / 100.0), 2)
        ELSE ROUND((SELECT avg_ticket FROM avg_ticket_all) * 10, 2)
      END AS ltv_estimate,
      -- Revenue churn estimate
      CASE WHEN (SELECT eligible_count FROM churn_metrics) > 0
        THEN ROUND(
          (SELECT churned_count FROM churn_metrics)::numeric /
          NULLIF((SELECT eligible_count FROM churn_metrics), 0) *
          (SELECT avg_ticket FROM avg_ticket_all),
          2
        )
        ELSE 0
      END AS revenue_churn_estimate
    FROM unit_econ ue
  ),
  unit_econ_with_ratios AS (
    SELECT
      cac_estimate,
      ltv_estimate,
      revenue_churn_estimate,
      churn_rate_estimate,
      CASE WHEN cac_estimate > 0
        THEN ROUND(ltv_estimate / cac_estimate, 2)
        ELSE 0
      END AS ltv_cac_ratio,
      CASE WHEN (SELECT avg_ticket FROM avg_ticket_all) > 0 AND cac_estimate > 0
        THEN ROUND(cac_estimate / ((SELECT avg_ticket FROM avg_ticket_all) / 12.0), 1)
        ELSE 0
      END AS payback_months
    FROM unit_econ_final
  ),

  -- ── Attribution by origin ─────────────────────────────────────────────────
  period_leads AS (
    SELECT l.id, l.origin, l.created_at
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  ),
  attribution_raw AS (
    SELECT
      pl.origin,
      COUNT(DISTINCT pl.id) AS lead_count,
      COUNT(DISTINCT sp.lead_id) AS sales_count,
      COALESCE(SUM(sp.sale_value), 0) AS revenue,
      CASE WHEN COUNT(DISTINCT pl.id) > 0
        THEN ROUND(COUNT(DISTINCT sp.lead_id)::numeric / COUNT(DISTINCT pl.id) * 100, 1)
        ELSE 0
      END AS conversion_rate,
      CASE WHEN COUNT(DISTINCT sp.lead_id) > 0
        THEN ROUND(COUNT(DISTINCT pl.id)::numeric / COUNT(DISTINCT sp.lead_id), 2)
        ELSE 0
      END AS cac_estimate
    FROM period_leads pl
    LEFT JOIN sold_proposals sp ON sp.lead_id = pl.id
    GROUP BY pl.origin
    ORDER BY revenue DESC
  ),

  -- ── Sales Velocity ────────────────────────────────────────────────────────
  -- Only leads that completed the full journey to 'vendido' in the period
  complete_journeys AS (
    SELECT
      sp.lead_id,
      sp.lead_created_at,
      sp.proposal_created_at,
      sp.closed_at,
      sp.sale_value,
      -- First whatsapp entry for this lead
      (SELECT pw.created_at FROM pipe_whatsapp pw
       WHERE pw.lead_id = sp.lead_id AND pw.organization_id = p_org_id
       ORDER BY pw.created_at ASC LIMIT 1) AS whatsapp_created_at,
      -- First confirmacao for this lead
      (SELECT MIN(me.occurred_at) FROM meeting_events me
       WHERE me.lead_id = sp.lead_id AND me.organization_id = p_org_id
         AND me.event_type = 'meeting_booked') AS confirmacao_created_at
    FROM sold_proposals sp
    WHERE sp.lead_created_at IS NOT NULL
      AND sp.closed_at IS NOT NULL
  ),
  velocity_stats AS (
    SELECT
      -- Stage: lead → whatsapp
      COALESCE(AVG(
        CASE WHEN whatsapp_created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (whatsapp_created_at - lead_created_at)) / 86400.0
          ELSE NULL
        END
      ), 0) AS lead_to_whatsapp_days,
      -- Stage: whatsapp → confirmacao
      COALESCE(AVG(
        CASE WHEN confirmacao_created_at IS NOT NULL AND whatsapp_created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (confirmacao_created_at - whatsapp_created_at)) / 86400.0
          ELSE NULL
        END
      ), 0) AS whatsapp_to_confirmacao_days,
      -- Stage: confirmacao → proposal
      COALESCE(AVG(
        CASE WHEN proposal_created_at IS NOT NULL AND confirmacao_created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (proposal_created_at - confirmacao_created_at)) / 86400.0
          ELSE NULL
        END
      ), 0) AS confirmacao_to_proposal_days,
      -- Stage: proposal → closed
      COALESCE(AVG(
        CASE WHEN closed_at IS NOT NULL AND proposal_created_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (closed_at - proposal_created_at)) / 86400.0
          ELSE NULL
        END
      ), 0) AS proposal_to_close_days,
      -- Total cycle
      COALESCE(AVG(
        EXTRACT(EPOCH FROM (closed_at - lead_created_at)) / 86400.0
      ), 1) AS total_cycle_days,
      COUNT(*) AS deal_count,
      COALESCE(AVG(sale_value), 0) AS avg_ticket
    FROM complete_journeys
  ),
  -- Pipeline: all active deals (proposals not closed yet)
  active_pipeline AS (
    SELECT COUNT(*) AS deal_count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status NOT IN ('vendido', 'perdido')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
  ),
  all_proposals_period AS (
    SELECT COUNT(*) AS total_cnt,
           COUNT(*) FILTER (WHERE status = 'vendido') AS won_cnt
    FROM pipe_propostas
    WHERE organization_id = p_org_id
      AND created_at >= p_start_date
      AND created_at < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL OR closer_id = p_member_id)
  ),
  velocity_final AS (
    SELECT
      vs.lead_to_whatsapp_days,
      vs.whatsapp_to_confirmacao_days,
      vs.confirmacao_to_proposal_days,
      vs.proposal_to_close_days,
      GREATEST(vs.total_cycle_days, 1) AS total_cycle_days,
      -- Win rate
      CASE WHEN (SELECT total_cnt FROM all_proposals_period) > 0
        THEN (SELECT won_cnt FROM all_proposals_period)::numeric / (SELECT total_cnt FROM all_proposals_period)
        ELSE 0
      END AS win_rate,
      -- Pipeline velocity = (deals_in_pipeline × win_rate × avg_ticket) / avg_cycle_days
      CASE WHEN GREATEST(vs.total_cycle_days, 1) > 0
        THEN ROUND(
          (SELECT deal_count FROM active_pipeline) *
          CASE WHEN (SELECT total_cnt FROM all_proposals_period) > 0
            THEN (SELECT won_cnt FROM all_proposals_period)::numeric / (SELECT total_cnt FROM all_proposals_period)
            ELSE 0
          END *
          vs.avg_ticket / GREATEST(vs.total_cycle_days, 1),
          2
        )
        ELSE 0
      END AS pipeline_velocity_per_day,
      vs.avg_ticket,
      -- Bottleneck = biggest stage
      GREATEST(
        vs.lead_to_whatsapp_days,
        vs.whatsapp_to_confirmacao_days,
        vs.confirmacao_to_proposal_days,
        vs.proposal_to_close_days
      ) AS max_stage_days
    FROM velocity_stats vs
  ),
  velocity_obj AS (
    SELECT
      jsonb_build_object(
        'transitions', jsonb_build_array(
          jsonb_build_object('from_stage', 'Lead', 'to_stage', 'WhatsApp', 'avg_days', ROUND(vf.lead_to_whatsapp_days::numeric, 1)),
          jsonb_build_object('from_stage', 'WhatsApp', 'to_stage', 'Confirmação', 'avg_days', ROUND(vf.whatsapp_to_confirmacao_days::numeric, 1)),
          jsonb_build_object('from_stage', 'Confirmação', 'to_stage', 'Proposta', 'avg_days', ROUND(vf.confirmacao_to_proposal_days::numeric, 1)),
          jsonb_build_object('from_stage', 'Proposta', 'to_stage', 'Fechamento', 'avg_days', ROUND(vf.proposal_to_close_days::numeric, 1))
        ),
        'total_cycle_days', ROUND(vf.total_cycle_days::numeric, 1),
        'bottleneck_stage', CASE
          WHEN vf.lead_to_whatsapp_days = vf.max_stage_days THEN 'Lead → WhatsApp'
          WHEN vf.whatsapp_to_confirmacao_days = vf.max_stage_days THEN 'WhatsApp → Confirmação'
          WHEN vf.confirmacao_to_proposal_days = vf.max_stage_days THEN 'Confirmação → Proposta'
          ELSE 'Proposta → Fechamento'
        END,
        'bottleneck_pct', CASE
          WHEN vf.total_cycle_days > 0
          THEN ROUND(vf.max_stage_days / vf.total_cycle_days * 100, 1)
          ELSE 0
        END,
        'pipeline_velocity_per_day', vf.pipeline_velocity_per_day,
        'forecast_30d', ROUND(vf.pipeline_velocity_per_day * 30, 2)
      ) AS obj
    FROM velocity_final vf
  ),

  -- ── Insights ──────────────────────────────────────────────────────────────
  total_lead_count AS (
    SELECT COUNT(*) AS cnt FROM period_leads
  ),
  -- Insight 1: origin with highest conv rate but < 15% of total lead volume
  insight_opportunity AS (
    SELECT origin, lead_count, conversion_rate
    FROM attribution_raw
    WHERE conversion_rate > 0
      AND (SELECT cnt FROM total_lead_count) > 0
      AND lead_count::numeric / NULLIF((SELECT cnt FROM total_lead_count), 0) < 0.15
    ORDER BY conversion_rate DESC
    LIMIT 1
  ),
  -- Insight 2: funnel stage with biggest drop
  insight_bottleneck AS (
    SELECT
      CASE
        WHEN vf.lead_to_whatsapp_days = vf.max_stage_days THEN 'Lead → WhatsApp'
        WHEN vf.whatsapp_to_confirmacao_days = vf.max_stage_days THEN 'WhatsApp → Confirmação'
        WHEN vf.confirmacao_to_proposal_days = vf.max_stage_days THEN 'Confirmação → Proposta'
        ELSE 'Proposta → Fechamento'
      END AS stage,
      CASE WHEN vf.total_cycle_days > 0
        THEN ROUND(vf.max_stage_days / vf.total_cycle_days * 100, 1)
        ELSE 0
      END AS bottleneck_pct
    FROM velocity_final vf
    WHERE vf.total_cycle_days > 0
      AND ROUND(vf.max_stage_days / vf.total_cycle_days * 100, 1) > 40
    LIMIT 1
  ),
  -- Insight 3: revenue trending up 3+ months
  monthly_revenue AS (
    SELECT
      date_trunc('month', COALESCE(pp.metrics_period_at, pp.closed_at))::date AS m,
      COALESCE(SUM(pp.sale_value), 0) AS rev
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= (p_end_date - interval '3 months')::date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
    GROUP BY date_trunc('month', COALESCE(pp.metrics_period_at, pp.closed_at))::date
    ORDER BY m
  ),
  revenue_trend AS (
    SELECT
      COUNT(*) AS month_count,
      MIN(rev) AS min_rev,
      MAX(rev) AS max_rev,
      CASE WHEN COUNT(*) >= 3 AND MIN(rev) > 0
        THEN ROUND((MAX(rev) - MIN(rev))::numeric / MIN(rev) * 100, 1)
        ELSE 0
      END AS growth_pct
    FROM monthly_revenue
  ),
  -- Insight 4: origin with best avg ticket
  insight_best_ticket AS (
    SELECT origin, revenue / NULLIF(sales_count, 0) AS avg_ticket
    FROM attribution_raw
    WHERE sales_count > 0
    ORDER BY avg_ticket DESC NULLS LAST
    LIMIT 1
  ),
  insights_raw AS (
    SELECT jsonb_agg(insight ORDER BY sort_order) AS arr
    FROM (
      SELECT 1 AS sort_order, jsonb_build_object(
        'type', 'oportunidade',
        'title', 'Origem com alto potencial',
        'description', 'A origem "' || io.origin || '" tem taxa de conversão de ' || io.conversion_rate || '% mas representa menos de 15% dos leads. Considere aumentar o investimento nesse canal.'
      ) AS insight
      FROM insight_opportunity io
      UNION ALL
      SELECT 2, jsonb_build_object(
        'type', 'alerta',
        'title', 'Gargalo no funil identificado',
        'description', 'O estágio "' || ib.stage || '" concentra ' || ib.bottleneck_pct || '% do tempo total do ciclo de vendas. Priorize ações para agilizar esta etapa.'
      )
      FROM insight_bottleneck ib
      UNION ALL
      SELECT 3, jsonb_build_object(
        'type', 'tendencia',
        'title', 'Receita em tendência de alta',
        'description', 'A receita cresceu ' || rt.growth_pct || '% nos últimos 3 meses. Mantenha o ritmo e antecipe recursos para sustentar o crescimento.'
      )
      FROM revenue_trend rt
      WHERE rt.growth_pct > 5 AND rt.month_count >= 3
      UNION ALL
      SELECT 4, jsonb_build_object(
        'type', 'padrao',
        'title', 'Melhor ticket médio por origem',
        'description', 'A origem "' || ibt.origin || '" apresenta o maior ticket médio (R$ ' || ROUND(ibt.avg_ticket, 0) || '). Leads dessa origem têm maior valor por venda.'
      )
      FROM insight_best_ticket ibt
    ) sub
  )

  SELECT jsonb_build_object(
    'cohort_data',
      CASE WHEN (SELECT cnt FROM cohort_count) >= 2
        THEN COALESCE((SELECT jsonb_agg(row_to_json(cd)) FROM cohort_data_raw cd), '[]'::jsonb)
        ELSE '[]'::jsonb
      END,
    'unit_economics',
      (SELECT jsonb_build_object(
        'cac_estimate',          uew.cac_estimate,
        'ltv_estimate',          uew.ltv_estimate,
        'ltv_cac_ratio',         uew.ltv_cac_ratio,
        'payback_months',        uew.payback_months,
        'churn_rate_estimate',   uew.churn_rate_estimate,
        'revenue_churn_estimate', uew.revenue_churn_estimate
      ) FROM unit_econ_with_ratios uew),
    'attribution',
      COALESCE((SELECT jsonb_agg(row_to_json(a)) FROM attribution_raw a), '[]'::jsonb),
    'sales_velocity',
      (SELECT obj FROM velocity_obj),
    'insights',
      COALESCE((SELECT arr FROM insights_raw), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$function$;
