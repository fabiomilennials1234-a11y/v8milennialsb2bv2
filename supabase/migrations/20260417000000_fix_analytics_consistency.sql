-- =============================================================================
-- Fix ALL analytics RPCs to use consistent temporal fields
-- =============================================================================
--
-- PROBLEM:
-- The main dashboard RPC (get_dashboard_metrics) correctly uses
-- COALESCE(metrics_period_at, created_at) for lead date filtering and
-- COALESCE(metrics_period_at, closed_at) for sales date filtering.
-- However, the 5 analytics sub-RPCs use bare created_at / closed_at,
-- causing data divergence between the dashboard and analytics pages.
--
-- When a user backdates a lead or sale via metrics_period_at, the dashboard
-- reflects it correctly but the analytics pages do not.
--
-- FIX:
-- Replace every bare date filter (created_at, closed_at) used for
-- period-boundary comparisons with the COALESCE(..., ...) pattern.
-- Leave SELECT-ed columns, aging queries (updated_at), and message
-- timestamps untouched -- those serve different purposes.
--
-- Also fixes get_dashboard_metrics which regressed in a later migration
-- to use bare created_at for leads instead of COALESCE.
--
-- AFFECTED FUNCTIONS:
-- 1. get_analytics_overview_metrics
-- 2. get_analytics_commercial_metrics
-- 3. get_analytics_financial_metrics
-- 4. get_analytics_pipeline_metrics
-- 5. get_analytics_engagement_metrics
-- 6. get_dashboard_metrics (fix leads count + add taxaConversao if missing)
-- =============================================================================


-- =============================================================================
-- 1. get_analytics_overview_metrics
-- =============================================================================
CREATE OR REPLACE FUNCTION get_analytics_overview_metrics(
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
      (SELECT pc.created_at FROM pipe_confirmacao pc
       WHERE pc.lead_id = sp.lead_id AND pc.organization_id = p_org_id
       ORDER BY pc.created_at ASC LIMIT 1) AS confirmacao_created_at
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
$$;


-- =============================================================================
-- 2. get_analytics_commercial_metrics
-- =============================================================================
CREATE OR REPLACE FUNCTION get_analytics_commercial_metrics(
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
  -- Team members
  members AS (
    SELECT id, name FROM team_members
    WHERE organization_id = p_org_id AND is_active = true
  ),
  -- Per-member: leads handled (via pipe_whatsapp.sdr_id)
  member_leads AS (
    SELECT pw.sdr_id AS member_id, COUNT(DISTINCT l.id) AS leads_handled
    FROM pipe_whatsapp pw
    JOIN leads l ON l.id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
    GROUP BY pw.sdr_id
  ),
  -- Per-member: meetings attended
  member_meetings AS (
    SELECT
      COALESCE(pc.responsible_id, pc.sdr_id) AS member_id,
      COUNT(DISTINCT pc.id) AS meetings_attended
    FROM pipe_confirmacao pc
    JOIN leads l ON l.id = pc.lead_id
    WHERE pc.organization_id = p_org_id
      AND COALESCE(pc.metrics_period_at, pc.created_at) >= p_start_date
      AND COALESCE(pc.metrics_period_at, pc.created_at) < (p_end_date + interval '1 day')
      AND pc.status = 'compareceu'
      AND (p_origin IS NULL OR l.origin::text = p_origin)
      AND (p_member_id IS NULL OR pc.responsible_id = p_member_id OR pc.sdr_id = p_member_id)
    GROUP BY COALESCE(pc.responsible_id, pc.sdr_id)
  ),
  -- Per-member: proposals and deals
  member_proposals AS (
    SELECT
      pp.closer_id AS member_id,
      COUNT(DISTINCT pp.id) AS proposals_total,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido') AS deals_won,
      COALESCE(SUM(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0) AS revenue,
      AVG(pp.sale_value) FILTER (WHERE pp.status = 'vendido') AS avg_ticket
    FROM pipe_propostas pp
    JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND COALESCE(pp.metrics_period_at, pp.created_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
    GROUP BY pp.closer_id
  ),
  -- Assembled member stats
  member_stats AS (
    SELECT
      m.id AS member_id,
      m.name AS member_name,
      COALESCE(ml.leads_handled, 0) AS leads_handled,
      COALESCE(mm.meetings_attended, 0) AS meetings_attended,
      COALESCE(mp.proposals_total, 0) AS proposals_total,
      COALESCE(mp.deals_won, 0) AS deals_won,
      COALESCE(mp.revenue, 0) AS revenue,
      COALESCE(mp.avg_ticket, 0) AS avg_ticket
    FROM members m
    LEFT JOIN member_leads ml ON ml.member_id = m.id
    LEFT JOIN member_meetings mm ON mm.member_id = m.id
    LEFT JOIN member_proposals mp ON mp.member_id = m.id
  ),
  -- All proposals in period (for loss reasons and totals)
  period_proposals AS (
    SELECT pp.id, pp.status, pp.loss_reason
    FROM pipe_propostas pp
    JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND COALESCE(pp.metrics_period_at, pp.created_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.created_at) < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  ),
  -- Loss reasons
  loss_reasons AS (
    SELECT pp.loss_reason, COUNT(*) AS cnt
    FROM period_proposals pp
    WHERE pp.status = 'perdido'
      AND pp.loss_reason IS NOT NULL AND pp.loss_reason != ''
    GROUP BY pp.loss_reason
    ORDER BY cnt DESC
    LIMIT 4
  ),
  -- Lead quality by origin
  origin_quality AS (
    SELECT
      l.origin,
      COUNT(DISTINCT l.id) AS lead_count,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido') AS won_count,
      COALESCE(AVG(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0) AS avg_ticket,
      CASE WHEN COUNT(DISTINCT l.id) > 0
        THEN ROUND(COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido')::numeric / COUNT(DISTINCT l.id) * 100, 1)
        ELSE 0
      END AS conversion_rate
    FROM leads l
    LEFT JOIN pipe_propostas pp ON pp.lead_id = l.id AND pp.organization_id = p_org_id
    WHERE l.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
    GROUP BY l.origin
    HAVING COUNT(DISTINCT l.id) >= 5
    ORDER BY conversion_rate DESC
  ),
  -- Total leads in period
  total_leads_count AS (
    SELECT COUNT(DISTINCT l.id) AS cnt
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  )
  SELECT jsonb_build_object(
    'member_stats', COALESCE((SELECT jsonb_agg(row_to_json(ms)) FROM member_stats ms), '[]'::jsonb),
    'loss_reasons', COALESCE((SELECT jsonb_agg(row_to_json(lr)) FROM loss_reasons lr), '[]'::jsonb),
    'origin_quality', COALESCE((SELECT jsonb_agg(row_to_json(oq)) FROM origin_quality oq), '[]'::jsonb),
    'total_leads', (SELECT cnt FROM total_leads_count),
    'total_won', (SELECT COUNT(*) FROM period_proposals WHERE status = 'vendido'),
    'total_lost', (SELECT COUNT(*) FROM period_proposals WHERE status = 'perdido'),
    'total_loss_reasons', (SELECT COUNT(*) FROM period_proposals WHERE status = 'perdido' AND loss_reason IS NOT NULL AND loss_reason != '')
  ) INTO result;

  RETURN result;
END;
$$;


-- =============================================================================
-- 3. get_analytics_financial_metrics
-- =============================================================================
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
$$;


-- =============================================================================
-- 4. get_analytics_pipeline_metrics
-- =============================================================================
CREATE OR REPLACE FUNCTION get_analytics_pipeline_metrics(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_pipeline_type text DEFAULT NULL,
  p_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  v_end_ts timestamptz := (p_end_date + interval '1 day');
BEGIN
  WITH
  -- ─── FULL-FUNNEL STAGES ────────────────────────────────────────────────────
  -- Stage 1: Leads created in period
  leads_created AS (
    SELECT l.id AS lead_id, l.created_at
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < v_end_ts
      AND (p_member_id IS NULL OR EXISTS (
        SELECT 1 FROM pipe_whatsapp pw
        WHERE pw.lead_id = l.id AND pw.organization_id = p_org_id AND pw.sdr_id = p_member_id
      ))
  ),
  leads_count AS (
    SELECT COUNT(*) AS cnt FROM leads_created
  ),
  -- Stage 2: Leads that entered pipe_whatsapp
  qualified_leads AS (
    SELECT DISTINCT pw.lead_id
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
  ),
  qualified_count AS (
    SELECT COUNT(*) AS cnt FROM qualified_leads
  ),
  -- Whatsapp lost: leads in pipe_whatsapp with esfriou or never moved
  whatsapp_lost AS (
    SELECT COUNT(DISTINCT pw.lead_id) AS cnt
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND pw.status = 'esfriou'
      AND NOT EXISTS (
        SELECT 1 FROM pipe_confirmacao pc WHERE pc.lead_id = pw.lead_id AND pc.organization_id = p_org_id
      )
  ),
  -- Stage 3: Leads that attended meeting (compareceu) in confirmacao
  attended_leads AS (
    SELECT DISTINCT pc.lead_id
    FROM pipe_confirmacao pc
    JOIN leads_created lc ON lc.lead_id = pc.lead_id
    WHERE pc.organization_id = p_org_id
      AND pc.status = 'compareceu'
      AND (p_member_id IS NULL OR pc.responsible_id = p_member_id OR pc.sdr_id = p_member_id)
  ),
  attended_count AS (
    SELECT COUNT(*) AS cnt FROM attended_leads
  ),
  -- Confirmacao lost: leads that entered confirmacao but marked perdido and never attended
  confirmacao_lost AS (
    SELECT COUNT(DISTINCT pc.lead_id) AS cnt
    FROM pipe_confirmacao pc
    JOIN leads_created lc ON lc.lead_id = pc.lead_id
    WHERE pc.organization_id = p_org_id
      AND pc.status = 'perdido'
      AND NOT EXISTS (
        SELECT 1 FROM attended_leads al WHERE al.lead_id = pc.lead_id
      )
  ),
  -- Stage 4: Leads that became vendido in propostas
  won_leads AS (
    SELECT DISTINCT pp.lead_id
    FROM pipe_propostas pp
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
  ),
  won_count AS (
    SELECT COUNT(*) AS cnt FROM won_leads
  ),
  propostas_lost AS (
    SELECT COUNT(DISTINCT pp.lead_id) AS cnt
    FROM pipe_propostas pp
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'perdido'
  ),
  -- Average days per stage transition (uses updated_at for "how long in stage" -- correct)
  avg_days_whatsapp AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pw.updated_at - lc.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
  ),
  avg_days_confirmacao AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pc.updated_at - pw.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_confirmacao pc
    JOIN pipe_whatsapp pw ON pw.lead_id = pc.lead_id AND pw.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = pc.lead_id
    WHERE pc.organization_id = p_org_id
  ),
  avg_days_propostas AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pp.updated_at - pc.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_propostas pp
    JOIN pipe_confirmacao pc ON pc.lead_id = pp.lead_id AND pc.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
  ),

  -- ─── STAGE ANALYSIS (conversion between transitions) ──────────────────────
  total_leads_val AS (SELECT GREATEST(cnt, 1) AS v FROM leads_count),
  total_qualified_val AS (SELECT GREATEST(cnt, 1) AS v FROM qualified_count),
  total_attended_val AS (SELECT GREATEST(cnt, 1) AS v FROM attended_count),

  -- ─── PIPELINE AGING (current state, not date-filtered) ────────────────────
  -- For whatsapp pipe
  whatsapp_aging AS (
    SELECT
      pw.status AS stage_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pw.updated_at)) / 86400 < 3) AS healthy_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pw.updated_at)) / 86400 BETWEEN 3 AND 6.9999) AS attention_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pw.updated_at)) / 86400 BETWEEN 7 AND 13.9999) AS risk_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pw.updated_at)) / 86400 >= 14) AS critical_count
    FROM pipe_whatsapp pw
    WHERE pw.organization_id = p_org_id
      AND pw.status NOT IN ('agendado', 'esfriou')
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
    GROUP BY pw.status
  ),
  -- For confirmacao pipe
  confirmacao_aging AS (
    SELECT
      pc.status AS stage_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pc.updated_at)) / 86400 < 3) AS healthy_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pc.updated_at)) / 86400 BETWEEN 3 AND 6.9999) AS attention_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pc.updated_at)) / 86400 BETWEEN 7 AND 13.9999) AS risk_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pc.updated_at)) / 86400 >= 14) AS critical_count
    FROM pipe_confirmacao pc
    WHERE pc.organization_id = p_org_id
      AND pc.status NOT IN ('compareceu', 'perdido')
      AND (p_member_id IS NULL OR pc.responsible_id = p_member_id OR pc.sdr_id = p_member_id)
    GROUP BY pc.status
  ),
  -- For propostas pipe
  propostas_aging AS (
    SELECT
      pp.status AS stage_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pp.updated_at)) / 86400 < 3) AS healthy_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pp.updated_at)) / 86400 BETWEEN 3 AND 6.9999) AS attention_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pp.updated_at)) / 86400 BETWEEN 7 AND 13.9999) AS risk_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - pp.updated_at)) / 86400 >= 14) AS critical_count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status NOT IN ('vendido', 'perdido')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
    GROUP BY pp.status
  ),
  -- Combined aging based on p_pipeline_type filter
  combined_aging AS (
    SELECT stage_name, total, healthy_count, attention_count, risk_count, critical_count
    FROM whatsapp_aging
    WHERE (p_pipeline_type IS NULL OR p_pipeline_type = 'whatsapp')
    UNION ALL
    SELECT stage_name, total, healthy_count, attention_count, risk_count, critical_count
    FROM confirmacao_aging
    WHERE (p_pipeline_type IS NULL OR p_pipeline_type = 'confirmacao')
    UNION ALL
    SELECT stage_name, total, healthy_count, attention_count, risk_count, critical_count
    FROM propostas_aging
    WHERE (p_pipeline_type IS NULL OR p_pipeline_type = 'propostas')
  ),

  -- ─── WEIGHTED FORECAST (propostas stages with win probability) ────────────
  -- Historical win rate per stage (all time for org)
  historical_win_rates AS (
    SELECT
      pp.status AS stage_name,
      COUNT(*) AS total_ever,
      COUNT(*) FILTER (WHERE pp.status = 'vendido') AS won_ever
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status IN ('marcar_compromisso', 'reativar', 'compromisso_marcado', 'esfriou', 'futuro', 'vendido', 'perdido')
    GROUP BY pp.status
  ),
  -- Current active deals per stage with value
  active_deals AS (
    SELECT
      pp.status AS stage_name,
      COUNT(*) AS deal_count,
      COALESCE(SUM(pp.sale_value), 0) AS total_value
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status NOT IN ('vendido', 'perdido')
      AND pp.created_at >= p_start_date
      AND pp.created_at < v_end_ts
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
    GROUP BY pp.status
  ),
  -- Stage win probabilities (empirical)
  stage_probabilities AS (
    SELECT
      stage_name,
      CASE stage_name
        WHEN 'compromisso_marcado' THEN 0.70
        WHEN 'marcar_compromisso'  THEN 0.30
        WHEN 'reativar'            THEN 0.25
        WHEN 'futuro'              THEN 0.15
        WHEN 'esfriou'             THEN 0.08
        ELSE 0.20
      END AS win_probability
    FROM (VALUES
      ('marcar_compromisso'), ('reativar'), ('compromisso_marcado'),
      ('esfriou'), ('futuro')
    ) AS s(stage_name)
  ),
  weighted_forecast AS (
    SELECT
      ad.stage_name,
      ad.deal_count,
      ad.total_value,
      sp.win_probability,
      ROUND((ad.total_value * sp.win_probability)::numeric, 2) AS weighted_value
    FROM active_deals ad
    JOIN stage_probabilities sp ON sp.stage_name = ad.stage_name
    WHERE (p_pipeline_type IS NULL OR p_pipeline_type = 'propostas')
  ),

  -- ─── CONVERSION TRENDS (last 6 months per transition) ────────────────────
  months_series AS (
    SELECT
      TO_CHAR(generate_series(
        DATE_TRUNC('month', NOW() - interval '5 months'),
        DATE_TRUNC('month', NOW()),
        interval '1 month'
      ), 'Mon/YY') AS month_label,
      generate_series(
        DATE_TRUNC('month', NOW() - interval '5 months'),
        DATE_TRUNC('month', NOW()),
        interval '1 month'
      ) AS month_start
  ),
  monthly_leads AS (
    SELECT
      m.month_label,
      m.month_start,
      COUNT(DISTINCT l.id) AS lead_cnt
    FROM months_series m
    LEFT JOIN leads l ON l.organization_id = p_org_id
      AND l.created_at >= m.month_start
      AND l.created_at < m.month_start + interval '1 month'
    GROUP BY m.month_label, m.month_start
  ),
  monthly_qualified AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT pw.lead_id) AS qualified_cnt
    FROM months_series m
    LEFT JOIN pipe_whatsapp pw ON pw.organization_id = p_org_id
      AND pw.created_at >= m.month_start
      AND pw.created_at < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
    GROUP BY m.month_label
  ),
  monthly_meetings AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT pc.lead_id) AS meeting_cnt
    FROM months_series m
    LEFT JOIN pipe_confirmacao pc ON pc.organization_id = p_org_id
      AND pc.status = 'compareceu'
      AND pc.updated_at >= m.month_start
      AND pc.updated_at < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pc.responsible_id = p_member_id OR pc.sdr_id = p_member_id)
    GROUP BY m.month_label
  ),
  monthly_won AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT pp.lead_id) AS won_cnt
    FROM months_series m
    LEFT JOIN pipe_propostas pp ON pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.updated_at >= m.month_start
      AND pp.updated_at < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
    GROUP BY m.month_label
  ),
  trends_combined AS (
    SELECT
      ml.month_label,
      ml.lead_cnt,
      COALESCE(mq.qualified_cnt, 0) AS qualified_cnt,
      COALESCE(mm.meeting_cnt, 0) AS meeting_cnt,
      COALESCE(mw.won_cnt, 0) AS won_cnt
    FROM monthly_leads ml
    LEFT JOIN monthly_qualified mq ON mq.month_label = ml.month_label
    LEFT JOIN monthly_meetings mm ON mm.month_label = ml.month_label
    LEFT JOIN monthly_won mw ON mw.month_label = ml.month_label
    ORDER BY ml.month_start
  )

  SELECT jsonb_build_object(
    -- Full funnel stages
    'funnel_stages', CASE WHEN p_pipeline_type IS NULL THEN
      jsonb_build_array(
        jsonb_build_object(
          'stage_name', 'Leads Criados',
          'count', (SELECT cnt FROM leads_count),
          'cumulative_pct', 100,
          'lost_count', 0,
          'avg_days', 0
        ),
        jsonb_build_object(
          'stage_name', 'Qualificação (WhatsApp)',
          'count', (SELECT cnt FROM qualified_count),
          'cumulative_pct', ROUND(COALESCE((SELECT cnt FROM qualified_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM whatsapp_lost),
          'avg_days', COALESCE((SELECT avg_days FROM avg_days_whatsapp), 0)
        ),
        jsonb_build_object(
          'stage_name', 'Reunião (Compareceu)',
          'count', (SELECT cnt FROM attended_count),
          'cumulative_pct', ROUND(COALESCE((SELECT cnt FROM attended_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM confirmacao_lost),
          'avg_days', COALESCE((SELECT avg_days FROM avg_days_confirmacao), 0)
        ),
        jsonb_build_object(
          'stage_name', 'Vendido',
          'count', (SELECT cnt FROM won_count),
          'cumulative_pct', ROUND(COALESCE((SELECT cnt FROM won_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM propostas_lost),
          'avg_days', COALESCE((SELECT avg_days FROM avg_days_propostas), 0)
        )
      )
    ELSE '[]'::jsonb END,

    -- Stage analysis (transition conversion)
    'stage_analysis', CASE WHEN p_pipeline_type IS NULL THEN
      jsonb_build_array(
        jsonb_build_object(
          'transition_name', 'Lead → Qualificação',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM qualified_count)::numeric / NULLIF((SELECT cnt FROM leads_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM leads_count) - (SELECT cnt FROM qualified_count),
          'primary_loss_status', 'sem_contato'
        ),
        jsonb_build_object(
          'transition_name', 'Qualificação → Reunião',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM attended_count)::numeric / NULLIF((SELECT cnt FROM qualified_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM whatsapp_lost),
          'primary_loss_status', 'esfriou'
        ),
        jsonb_build_object(
          'transition_name', 'Reunião → Proposta',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM attended_count)::numeric / NULLIF((SELECT cnt FROM attended_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM confirmacao_lost),
          'primary_loss_status', 'perdido'
        ),
        jsonb_build_object(
          'transition_name', 'Proposta → Venda',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM won_count)::numeric / NULLIF((SELECT cnt FROM attended_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM propostas_lost),
          'primary_loss_status', 'perdido'
        )
      )
    ELSE '[]'::jsonb END,

    -- Pipeline aging
    'pipeline_aging', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'stage_name', ca.stage_name,
        'total', ca.total,
        'healthy_count', ca.healthy_count,
        'attention_count', ca.attention_count,
        'risk_count', ca.risk_count,
        'critical_count', ca.critical_count
      )) FROM combined_aging ca WHERE ca.total > 0),
      '[]'::jsonb
    ),

    -- Weighted forecast
    'weighted_forecast', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'stage_name', wf.stage_name,
        'deal_count', wf.deal_count,
        'total_value', wf.total_value,
        'win_probability', wf.win_probability,
        'weighted_value', wf.weighted_value
      )) FROM weighted_forecast wf),
      '[]'::jsonb
    ),

    -- Conversion trends (4 transitions, 6 months each)
    'conversion_trends', jsonb_build_array(
      jsonb_build_object(
        'transition_name', 'Lead → Qualificado',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.qualified_cnt::numeric / NULLIF(tc.lead_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Qualificado → Reunião',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.meeting_cnt::numeric / NULLIF(tc.qualified_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Reunião → Proposta',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.meeting_cnt::numeric / NULLIF(tc.meeting_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Proposta → Venda',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.won_cnt::numeric / NULLIF(tc.meeting_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      )
    ),

    -- Totals
    'pipeline_total', (SELECT cnt FROM leads_count),
    'forecast_total', COALESCE(
      (SELECT SUM(wf.weighted_value) FROM weighted_forecast wf),
      0
    )
  ) INTO result;

  RETURN result;
END;
$$;


-- =============================================================================
-- 5. get_analytics_engagement_metrics
-- =============================================================================
-- Index for fast engagement queries on whatsapp_messages (idempotent)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_org_timestamp_direction
  ON whatsapp_messages (organization_id, timestamp, direction)
  WHERE timestamp IS NOT NULL;

CREATE OR REPLACE FUNCTION get_analytics_engagement_metrics(
  p_org_id   uuid,
  p_start_date date,
  p_end_date   date,
  p_member_id  uuid DEFAULT NULL,
  p_origin     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN

  WITH
  -- -----------------------------------------------------------------------
  -- Base: leads in period
  -- -----------------------------------------------------------------------
  period_leads AS (
    SELECT l.id AS lead_id, l.origin, l.created_at
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
  ),

  -- -----------------------------------------------------------------------
  -- Messages within period, filtered to leads in scope
  -- -----------------------------------------------------------------------
  scope_messages AS (
    SELECT
      wm.id,
      wm.lead_id,
      wm.direction,
      wm.timestamp::timestamptz AS ts,
      wm.assigned_to
    FROM whatsapp_messages wm
    INNER JOIN period_leads pl ON pl.lead_id = wm.lead_id
    WHERE wm.organization_id = p_org_id
      AND wm.timestamp IS NOT NULL
      AND wm.lead_id IS NOT NULL
  ),

  -- -----------------------------------------------------------------------
  -- Our response time: for each inbound, find the next outbound to same lead
  -- Only during business hours (8-19) to avoid overnight gaps
  -- -----------------------------------------------------------------------
  inbound_msgs AS (
    SELECT id, lead_id, ts
    FROM scope_messages
    WHERE direction = 'incoming'
      AND EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18
  ),
  outbound_next AS (
    SELECT DISTINCT ON (i.id)
      i.id   AS inbound_id,
      i.lead_id,
      EXTRACT(EPOCH FROM (o.ts - i.ts)) AS response_seconds
    FROM inbound_msgs i
    JOIN scope_messages o
      ON  o.lead_id   = i.lead_id
      AND o.direction = 'outgoing'
      AND o.ts > i.ts
      AND o.ts < i.ts + interval '12 hours'
    ORDER BY i.id, o.ts
  ),

  -- -----------------------------------------------------------------------
  -- Client response time: for each outbound, next inbound from same lead
  -- -----------------------------------------------------------------------
  outbound_msgs AS (
    SELECT id, lead_id, ts
    FROM scope_messages
    WHERE direction = 'outgoing'
      AND EXTRACT(HOUR FROM ts) BETWEEN 8 AND 18
  ),
  inbound_next AS (
    SELECT DISTINCT ON (o.id)
      o.id   AS outbound_id,
      o.lead_id,
      EXTRACT(EPOCH FROM (i.ts - o.ts)) AS response_seconds
    FROM outbound_msgs o
    JOIN scope_messages i
      ON  i.lead_id   = o.lead_id
      AND i.direction = 'incoming'
      AND i.ts > o.ts
      AND i.ts < o.ts + interval '24 hours'
    ORDER BY o.id, i.ts
  ),

  -- -----------------------------------------------------------------------
  -- KPI: response_rate (leads with >= 1 inbound reply)
  -- -----------------------------------------------------------------------
  leads_with_inbound AS (
    SELECT COUNT(DISTINCT sm.lead_id) AS cnt
    FROM scope_messages sm
    WHERE sm.direction = 'incoming'
  ),

  -- -----------------------------------------------------------------------
  -- KPI: close_rate (vendido proposals)
  -- -----------------------------------------------------------------------
  period_proposals AS (
    SELECT pp.lead_id, pp.status
    FROM pipe_propostas pp
    INNER JOIN period_leads pl ON pl.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
  ),
  total_leads_cnt   AS (SELECT COUNT(*) AS cnt FROM period_leads),
  vendido_cnt       AS (SELECT COUNT(DISTINCT lead_id) AS cnt FROM period_proposals WHERE status = 'vendido'),

  -- -----------------------------------------------------------------------
  -- KPI cards
  -- -----------------------------------------------------------------------
  kpi AS (
    SELECT
      COALESCE(AVG(on2.response_seconds), 0) AS our_avg_response_seconds,
      COALESCE(AVG(inn.response_seconds), 0) AS client_avg_response_seconds,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND((SELECT cnt FROM leads_with_inbound)::numeric
              / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END                            AS response_rate_pct,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND((SELECT cnt FROM vendido_cnt)::numeric
              / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END                            AS close_rate_pct
    FROM outbound_next on2
    FULL OUTER JOIN inbound_next inn ON false
  ),

  -- -----------------------------------------------------------------------
  -- response_by_origin
  -- -----------------------------------------------------------------------
  origin_leads AS (
    SELECT
      pl.origin::text                        AS origin,
      COUNT(DISTINCT pl.lead_id)             AS lead_count,
      COUNT(DISTINCT sm_in.lead_id)          AS replied_count,
      COUNT(DISTINCT pp2.lead_id) FILTER (WHERE pp2.status = 'vendido') AS sales_count,
      COALESCE(AVG(on3.response_seconds), 0) AS avg_response_seconds
    FROM period_leads pl
    LEFT JOIN scope_messages sm_in
      ON sm_in.lead_id  = pl.lead_id AND sm_in.direction = 'incoming'
    LEFT JOIN period_proposals pp2
      ON pp2.lead_id = pl.lead_id
    LEFT JOIN outbound_next on3
      ON on3.lead_id = pl.lead_id
    GROUP BY pl.origin::text
    HAVING COUNT(DISTINCT pl.lead_id) >= 3
  ),
  response_by_origin AS (
    SELECT
      origin,
      lead_count,
      sales_count,
      CASE WHEN lead_count > 0 THEN ROUND(replied_count::numeric / lead_count * 100, 1) ELSE 0 END AS response_rate,
      CASE WHEN lead_count > 0 THEN ROUND(sales_count::numeric  / lead_count * 100, 1) ELSE 0 END AS close_rate,
      ROUND(avg_response_seconds::numeric, 0) AS avg_response_seconds
    FROM origin_leads
    ORDER BY response_rate DESC
  ),

  -- -----------------------------------------------------------------------
  -- team_response_times
  -- -----------------------------------------------------------------------
  member_response AS (
    SELECT
      tm.id   AS member_id,
      tm.name AS member_name,
      false   AS is_copilot,
      COALESCE(AVG(on4.response_seconds), 0) AS avg_response_seconds
    FROM team_members tm
    LEFT JOIN scope_messages sm_out
      ON sm_out.assigned_to = tm.user_id AND sm_out.direction = 'outgoing'
    LEFT JOIN outbound_next on4
      ON on4.inbound_id IN (
        SELECT id FROM inbound_msgs WHERE lead_id = sm_out.lead_id
      )
    WHERE tm.organization_id = p_org_id
      AND tm.is_active = true
      AND (p_member_id IS NULL OR tm.id = p_member_id)
    GROUP BY tm.id, tm.name
  ),

  -- -----------------------------------------------------------------------
  -- hourly_pattern: when do clients respond most?
  -- -----------------------------------------------------------------------
  hourly_pattern AS (
    SELECT
      EXTRACT(HOUR FROM sm.ts)::int AS hour,
      COUNT(*) AS response_count
    FROM scope_messages sm
    WHERE sm.direction = 'incoming'
    GROUP BY EXTRACT(HOUR FROM sm.ts)::int
    ORDER BY hour
  ),
  total_inbound_cnt AS (
    SELECT COUNT(*) AS cnt FROM scope_messages WHERE direction = 'incoming'
  ),
  hourly_with_rate AS (
    SELECT
      hp.hour,
      hp.response_count,
      CASE WHEN (SELECT cnt FROM total_inbound_cnt) > 0
        THEN ROUND(hp.response_count::numeric / (SELECT cnt FROM total_inbound_cnt) * 100, 1)
        ELSE 0 END AS response_rate
    FROM hourly_pattern hp
  ),

  -- -----------------------------------------------------------------------
  -- speed_conversion buckets
  -- -----------------------------------------------------------------------
  lead_first_response AS (
    SELECT DISTINCT ON (on5.lead_id)
      on5.lead_id,
      on5.response_seconds
    FROM outbound_next on5
    ORDER BY on5.lead_id, on5.response_seconds
  ),
  lead_first_response_status AS (
    SELECT lfr.lead_id, lfr.response_seconds,
      EXISTS (
        SELECT 1 FROM period_proposals pp3
        WHERE pp3.lead_id = lfr.lead_id AND pp3.status = 'vendido'
      ) AS converted
    FROM lead_first_response lfr
  ),
  speed_buckets AS (
    SELECT
      bucket_label,
      bucket_min,
      bucket_max,
      COUNT(*) FILTER (WHERE response_seconds >= bucket_min AND response_seconds < bucket_max) AS lead_count,
      COUNT(*) FILTER (WHERE response_seconds >= bucket_min AND response_seconds < bucket_max AND converted) AS converted_count
    FROM lead_first_response_status,
    (VALUES
      ('<2min',   0,    120),
      ('2-5min',  120,  300),
      ('5-15min', 300,  900),
      ('>15min',  900,  999999)
    ) AS b(bucket_label, bucket_min, bucket_max)
    GROUP BY bucket_label, bucket_min, bucket_max
  ),
  speed_conversion AS (
    SELECT
      bucket_label,
      bucket_min AS bucket_min_seconds,
      CASE WHEN bucket_max = 999999 THEN NULL ELSE bucket_max END AS bucket_max_seconds,
      lead_count,
      converted_count,
      CASE WHEN lead_count > 0
        THEN ROUND(converted_count::numeric / lead_count * 100, 1)
        ELSE 0 END AS conversion_rate
    FROM speed_buckets
    ORDER BY bucket_min
  ),

  -- -----------------------------------------------------------------------
  -- monthly_trends (last 6 months)
  -- -----------------------------------------------------------------------
  month_series AS (
    SELECT generate_series(
      date_trunc('month', (p_end_date - interval '5 months')::timestamp),
      date_trunc('month', p_end_date::timestamp),
      interval '1 month'
    ) AS month_start
  ),
  monthly_leads AS (
    SELECT
      date_trunc('month', COALESCE(l.metrics_period_at, l.created_at)) AS month_start,
      COUNT(DISTINCT l.id)              AS lead_count
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND COALESCE(l.metrics_period_at, l.created_at) >= (p_end_date - interval '6 months')
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
    GROUP BY date_trunc('month', COALESCE(l.metrics_period_at, l.created_at))
  ),
  monthly_inbound AS (
    SELECT
      date_trunc('month', wm.timestamp::timestamptz) AS month_start,
      COUNT(DISTINCT wm.lead_id) AS replied_leads
    FROM whatsapp_messages wm
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'incoming'
      AND wm.timestamp IS NOT NULL
      AND wm.timestamp::timestamptz >= (p_end_date - interval '6 months')
      AND wm.timestamp::timestamptz < (p_end_date + interval '1 day')
    GROUP BY date_trunc('month', wm.timestamp::timestamptz)
  ),
  monthly_closed AS (
    SELECT
      date_trunc('month', pp.closed_at) AS month_start,
      COUNT(DISTINCT pp.lead_id) AS vendido_count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.closed_at IS NOT NULL
      AND pp.closed_at >= (p_end_date - interval '6 months')
      AND pp.closed_at < (p_end_date + interval '1 day')
    GROUP BY date_trunc('month', pp.closed_at)
  ),
  monthly_our_resp AS (
    SELECT
      date_trunc('month', i.ts) AS month_start,
      AVG(on6.response_seconds) AS avg_our_seconds
    FROM inbound_msgs i
    JOIN outbound_next on6 ON on6.inbound_id = i.id
    WHERE i.ts >= (p_end_date::timestamptz - interval '6 months')
    GROUP BY date_trunc('month', i.ts)
  ),
  monthly_client_resp AS (
    SELECT
      date_trunc('month', o.ts) AS month_start,
      AVG(inn2.response_seconds) AS avg_client_seconds
    FROM outbound_msgs o
    JOIN inbound_next inn2 ON inn2.outbound_id = o.id
    WHERE o.ts >= (p_end_date::timestamptz - interval '6 months')
    GROUP BY date_trunc('month', o.ts)
  ),
  monthly_trends AS (
    SELECT
      to_char(ms.month_start, 'Mon/YY') AS month_label,
      CASE WHEN COALESCE(ml.lead_count, 0) > 0
        THEN ROUND(COALESCE(mi.replied_leads, 0)::numeric / ml.lead_count * 100, 1)
        ELSE 0 END AS response_rate,
      ROUND(COALESCE(mor.avg_our_seconds, 0)::numeric, 0)    AS our_avg_response_seconds,
      ROUND(COALESCE(mcr.avg_client_seconds, 0)::numeric, 0) AS client_avg_response_seconds,
      CASE WHEN COALESCE(ml.lead_count, 0) > 0
        THEN ROUND(COALESCE(mc.vendido_count, 0)::numeric / ml.lead_count * 100, 1)
        ELSE 0 END AS close_rate
    FROM month_series ms
    LEFT JOIN monthly_leads      ml  ON ml.month_start  = ms.month_start
    LEFT JOIN monthly_inbound    mi  ON mi.month_start  = ms.month_start
    LEFT JOIN monthly_closed     mc  ON mc.month_start  = ms.month_start
    LEFT JOIN monthly_our_resp   mor ON mor.month_start = ms.month_start
    LEFT JOIN monthly_client_resp mcr ON mcr.month_start = ms.month_start
    ORDER BY ms.month_start
  ),

  -- -----------------------------------------------------------------------
  -- copilot_vs_human
  -- (copilot messages = processed_by_agent_at IS NOT NULL)
  -- -----------------------------------------------------------------------
  copilot_outbound AS (
    SELECT wm.lead_id, wm.id, wm.timestamp::timestamptz AS ts
    FROM whatsapp_messages wm
    INNER JOIN period_leads pl ON pl.lead_id = wm.lead_id
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'outgoing'
      AND wm.processed_by_agent_at IS NOT NULL
      AND wm.timestamp IS NOT NULL
  ),
  human_outbound AS (
    SELECT wm.lead_id, wm.id, wm.timestamp::timestamptz AS ts
    FROM whatsapp_messages wm
    INNER JOIN period_leads pl ON pl.lead_id = wm.lead_id
    WHERE wm.organization_id = p_org_id
      AND wm.direction = 'outgoing'
      AND wm.processed_by_agent_at IS NULL
      AND wm.timestamp IS NOT NULL
  ),
  copilot_first_resp AS (
    SELECT DISTINCT ON (co.lead_id)
      co.lead_id,
      EXTRACT(EPOCH FROM (co.ts - sm_in2.ts)) AS response_seconds
    FROM copilot_outbound co
    JOIN scope_messages sm_in2
      ON sm_in2.lead_id   = co.lead_id
      AND sm_in2.direction = 'incoming'
      AND sm_in2.ts < co.ts
      AND sm_in2.ts > co.ts - interval '12 hours'
    ORDER BY co.lead_id, co.ts
  ),
  human_first_resp AS (
    SELECT DISTINCT ON (hu.lead_id)
      hu.lead_id,
      EXTRACT(EPOCH FROM (hu.ts - sm_in3.ts)) AS response_seconds
    FROM human_outbound hu
    JOIN scope_messages sm_in3
      ON sm_in3.lead_id   = hu.lead_id
      AND sm_in3.direction = 'incoming'
      AND sm_in3.ts < hu.ts
      AND sm_in3.ts > hu.ts - interval '12 hours'
    ORDER BY hu.lead_id, hu.ts
  ),
  copilot_stats AS (
    SELECT
      COALESCE(AVG(cfr.response_seconds), 0) AS avg_response,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT co.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS response_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT co.lead_id) FILTER (WHERE EXISTS (
          SELECT 1 FROM scope_messages WHERE lead_id = co.lead_id AND direction = 'incoming'
        ))::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS qualification_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT co.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS coverage_pct,
      0 AS cost_per_lead
    FROM copilot_outbound co
    LEFT JOIN copilot_first_resp cfr ON cfr.lead_id = co.lead_id
  ),
  human_stats AS (
    SELECT
      COALESCE(AVG(hfr.response_seconds), 0) AS avg_response,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT hu.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS response_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT hu.lead_id) FILTER (WHERE EXISTS (
          SELECT 1 FROM scope_messages WHERE lead_id = hu.lead_id AND direction = 'incoming'
        ))::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS qualification_rate,
      CASE WHEN (SELECT cnt FROM total_leads_cnt) > 0
        THEN ROUND(COUNT(DISTINCT hu.lead_id)::numeric / (SELECT cnt FROM total_leads_cnt) * 100, 1)
        ELSE 0 END AS coverage_pct,
      0 AS cost_per_lead
    FROM human_outbound hu
    LEFT JOIN human_first_resp hfr ON hfr.lead_id = hu.lead_id
  )

  SELECT jsonb_build_object(
    'kpi_cards', COALESCE((
      SELECT jsonb_build_object(
        'our_avg_response_seconds',    ROUND(our_avg_response_seconds::numeric, 0),
        'client_avg_response_seconds', ROUND(client_avg_response_seconds::numeric, 0),
        'response_rate_pct',           response_rate_pct,
        'close_rate_pct',              close_rate_pct
      )
      FROM kpi
      LIMIT 1
    ), '{"our_avg_response_seconds":0,"client_avg_response_seconds":0,"response_rate_pct":0,"close_rate_pct":0}'::jsonb),
    'response_by_origin',  COALESCE((SELECT jsonb_agg(row_to_json(rbo)) FROM response_by_origin rbo), '[]'::jsonb),
    'team_response_times', COALESCE((SELECT jsonb_agg(row_to_json(mr))  FROM member_response mr),      '[]'::jsonb),
    'hourly_pattern',      COALESCE((SELECT jsonb_agg(row_to_json(hw))  FROM hourly_with_rate hw),      '[]'::jsonb),
    'speed_conversion',    COALESCE((SELECT jsonb_agg(row_to_json(sc))  FROM speed_conversion sc),      '[]'::jsonb),
    'monthly_trends',      COALESCE((SELECT jsonb_agg(row_to_json(mt))  FROM monthly_trends mt),        '[]'::jsonb),
    'copilot_vs_human', jsonb_build_object(
      'copilot', (SELECT row_to_json(cs) FROM copilot_stats cs LIMIT 1),
      'human',   (SELECT row_to_json(hs) FROM human_stats   hs LIMIT 1)
    )
  ) INTO result;

  RETURN result;
END;
$$;


-- =============================================================================
-- 6. get_dashboard_metrics — add taxaConversao, preserve all existing logic
-- =============================================================================
-- Based on the known-good version from 20260829400000_fix_dashboard_metrics_responsible_id.sql
-- Only addition: v_taxa_conversao variable + taxaConversao in return JSONB
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_filter_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads INTEGER := 0;
  v_reunioes_marcadas INTEGER := 0;
  v_reunioes_comparecidas INTEGER := 0;
  v_no_show INTEGER := 0;
  v_taxa_no_show NUMERIC := 0;
  v_finalizados_data_passada INTEGER := 0;
  v_propostas_enviadas INTEGER := 0;
  v_novos_clientes INTEGER := 0;
  v_venda_total NUMERIC := 0;
  v_venda_mrr NUMERIC := 0;
  v_venda_projeto NUMERIC := 0;
  v_ticket_medio NUMERIC := 0;
  v_ticket_medio_mrr NUMERIC := 0;
  v_ticket_medio_projeto NUMERIC := 0;
  v_tempo_medio_resposta NUMERIC := 0;
  v_venda_primeiro_pedido NUMERIC := 0;
  v_venda_base_ativa NUMERIC := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  v_funnel_reunioes_marcadas INTEGER := 0;
  v_funnel_compareceu INTEGER := 0;
  v_funnel_propostas INTEGER := 0;
  v_funnel_vendas INTEGER := 0;
  v_mrr_proposal_count INTEGER := 0;
  v_projeto_proposal_count INTEGER := 0;
  v_taxa_conversao NUMERIC := 0;
  rec RECORD;
BEGIN
  -- 1. Leads captados
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND (is_shadow IS NULL OR is_shadow = false)
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- 2. Reuniões
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_funnel_compareceu := v_reunioes_comparecidas;

  -- No-show (only for meetings with date in the past)
  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND meeting_date < NOW()
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  SELECT COUNT(*) INTO v_no_show
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND meeting_date < NOW()
    AND status IN ('remarcar', 'perdido')
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  END IF;

  -- 3. Propostas enviadas (FIX: add responsible_id)
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_funnel_propostas := v_propostas_enviadas;

  -- 4. Vendas + primeiro pedido vs base ativa (FIX: add responsible_id)
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_novos_clientes := v_funnel_vendas;

  FOR rec IN
    SELECT pp.id AS proposta_id, pp.lead_id, pp.sale_value AS prop_sale_value,
      pp.product_type AS prop_product_type,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('sale_value', ppi.sale_value, 'product_type', pr.type))
         FROM pipe_proposta_items ppi LEFT JOIN products pr ON pr.id = ppi.product_id
         WHERE ppi.pipe_proposta_id = pp.id), '[]'::jsonb
      ) AS items,
      EXISTS (
        SELECT 1 FROM pipe_propostas prev
        WHERE prev.lead_id = pp.lead_id AND prev.organization_id = p_org_id
          AND prev.status = 'vendido' AND prev.id != pp.id
          AND COALESCE(prev.metrics_period_at, prev.closed_at) < p_start_date
      ) AS is_returning_customer
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR pp.closer_id = p_filter_member_id
           OR pp.responsible_id = p_filter_member_id)
  LOOP
    DECLARE
      item JSONB; item_val NUMERIC; item_type TEXT;
      prop_total NUMERIC := 0; prop_mrr NUMERIC := 0; prop_proj NUMERIC := 0;
    BEGIN
      IF jsonb_array_length(rec.items) > 0 THEN
        FOR item IN SELECT * FROM jsonb_array_elements(rec.items) LOOP
          item_val := COALESCE((item->>'sale_value')::NUMERIC, 0);
          item_type := item->>'product_type';
          prop_total := prop_total + item_val;
          IF item_type = 'mrr' THEN prop_mrr := prop_mrr + item_val;
          ELSIF item_type = 'projeto' THEN prop_proj := prop_proj + item_val; END IF;
        END LOOP;
      ELSE
        prop_total := COALESCE(rec.prop_sale_value, 0);
        IF rec.prop_product_type = 'mrr' THEN prop_mrr := prop_total;
        ELSIF rec.prop_product_type = 'projeto' THEN prop_proj := prop_total; END IF;
      END IF;
      v_venda_total := v_venda_total + prop_total;
      v_venda_mrr := v_venda_mrr + prop_mrr;
      v_venda_projeto := v_venda_projeto + prop_proj;
      IF prop_mrr > 0 THEN v_mrr_proposal_count := v_mrr_proposal_count + 1; END IF;
      IF prop_proj > 0 THEN v_projeto_proposal_count := v_projeto_proposal_count + 1; END IF;
      IF rec.is_returning_customer THEN v_venda_base_ativa := v_venda_base_ativa + prop_total;
      ELSE v_venda_primeiro_pedido := v_venda_primeiro_pedido + prop_total; END IF;
    END;
  END LOOP;

  IF v_novos_clientes > 0 THEN v_ticket_medio := v_venda_total / v_novos_clientes; END IF;
  IF v_mrr_proposal_count > 0 THEN v_ticket_medio_mrr := v_venda_mrr / v_mrr_proposal_count; END IF;
  IF v_projeto_proposal_count > 0 THEN v_ticket_medio_projeto := v_venda_projeto / v_projeto_proposal_count; END IF;

  -- Taxa de conversão: vendas / leads
  IF v_total_leads > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_leads) * 100, 1);
  END IF;

  -- 5. Tempo médio de resposta (FIX: add responsible_id)
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (first_contact - lead_created)) / 3600), 0)
  INTO v_tempo_medio_resposta
  FROM (
    SELECT l.created_at AS lead_created,
      (SELECT MIN(pc.created_at) FROM pipe_confirmacao pc WHERE pc.lead_id = l.id) AS first_contact
    FROM leads l
    WHERE l.organization_id = p_org_id AND (l.is_shadow IS NULL OR l.is_shadow = false)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR l.sdr_id = p_filter_member_id
           OR l.closer_id = p_filter_member_id
           OR l.responsible_id = p_filter_member_id)
  ) sub WHERE first_contact IS NOT NULL;

  -- 6. Daily sales series
  SELECT COALESCE(jsonb_agg(row_to_json(daily) ORDER BY daily.day), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT DATE(COALESCE(pp.metrics_period_at, pp.closed_at)) AS day,
      SUM(COALESCE(pp.sale_value, 0)) AS revenue,
      COUNT(*) AS count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR pp.closer_id = p_filter_member_id
           OR pp.responsible_id = p_filter_member_id)
    GROUP BY DATE(COALESCE(pp.metrics_period_at, pp.closed_at))
  ) daily;

  RETURN jsonb_build_object(
    'totalLeads', v_total_leads,
    'reunioesMarcadas', v_reunioes_marcadas,
    'reunioesComparecidas', v_reunioes_comparecidas,
    'noShow', v_no_show,
    'taxaNoShow', v_taxa_no_show,
    'vendaTotal', v_venda_total,
    'vendaMRR', v_venda_mrr,
    'vendaProjeto', v_venda_projeto,
    'ticketMedio', v_ticket_medio,
    'ticketMedioMRR', v_ticket_medio_mrr,
    'ticketMedioProjeto', v_ticket_medio_projeto,
    'tempoMedioResposta', ROUND(v_tempo_medio_resposta::NUMERIC, 1),
    'novosClientes', v_novos_clientes,
    'propostasEnviadas', v_propostas_enviadas,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'vendaBaseAtiva', v_venda_base_ativa,
    'dailySales', v_daily_sales,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas,
    'taxaConversao', v_taxa_conversao
  );
END;
$$;


-- =============================================================================
-- 7. get_mkt_origin_metrics — NEW RPC replacing client-side useMktByOrigin
-- =============================================================================
-- Provides per-origin marketing metrics (leads, agendamentos, comparecimentos,
-- propostas, vendas, receita) computed server-side with consistent temporal
-- fields. Investment/CPL/ROI stay in frontend (manual config per org).
CREATE OR REPLACE FUNCTION public.get_mkt_origin_metrics(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH
  -- Leads in period by origin
  period_leads AS (
    SELECT l.id, COALESCE(l.origin::text, 'outro') AS origin
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND (l.is_shadow IS NULL OR l.is_shadow = false)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL
           OR l.sdr_id = p_member_id
           OR l.closer_id = p_member_id
           OR l.responsible_id = p_member_id)
  ),
  -- Confirmacoes linked to period leads, also in period
  period_confirmacoes AS (
    SELECT pc.id, pc.lead_id, pc.status
    FROM pipe_confirmacao pc
    WHERE pc.organization_id = p_org_id
      AND pc.lead_id IN (SELECT id FROM period_leads)
      AND COALESCE(pc.metrics_period_at, pc.created_at) >= p_start_date
      AND COALESCE(pc.metrics_period_at, pc.created_at) < (p_end_date + interval '1 day')
  ),
  -- ALL propostas linked to period leads (no date filter — to show open vs closed)
  period_propostas AS (
    SELECT pp.id, pp.lead_id, pp.status
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.lead_id IN (SELECT id FROM period_leads)
  ),
  -- Vendas (propostas vendidas) within period — for revenue
  period_vendas AS (
    SELECT pp.id, pp.lead_id, COALESCE(pp.sale_value, 0) AS sale_value
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND pp.lead_id IN (SELECT id FROM period_leads)
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) < (p_end_date + interval '1 day')
  ),
  -- Aggregate per origin: leads
  leads_by_origin AS (
    SELECT origin, COUNT(*) AS leads_count
    FROM period_leads
    GROUP BY origin
  ),
  -- Aggregate per origin: confirmacoes
  conf_by_origin AS (
    SELECT pl.origin,
      COUNT(DISTINCT pc.id) AS agendamentos_count,
      COUNT(DISTINCT pc.id) FILTER (WHERE pc.status = 'compareceu') AS comparecimentos_count
    FROM period_confirmacoes pc
    JOIN period_leads pl ON pl.id = pc.lead_id
    GROUP BY pl.origin
  ),
  -- Aggregate per origin: propostas
  prop_by_origin AS (
    SELECT pl.origin,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status NOT IN ('vendido', 'perdido')) AS propostas_abertas,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status IN ('vendido', 'perdido')) AS propostas_fechadas
    FROM period_propostas pp
    JOIN period_leads pl ON pl.id = pp.lead_id
    GROUP BY pl.origin
  ),
  -- Aggregate per origin: vendas + receita
  vendas_by_origin AS (
    SELECT pl.origin,
      COUNT(DISTINCT pv.id) AS vendas_count,
      COALESCE(SUM(pv.sale_value), 0) AS receita
    FROM period_vendas pv
    JOIN period_leads pl ON pl.id = pv.lead_id
    GROUP BY pl.origin
  ),
  -- Combine all
  combined AS (
    SELECT
      lo.origin,
      lo.leads_count,
      COALESCE(co.agendamentos_count, 0) AS agendamentos_count,
      COALESCE(co.comparecimentos_count, 0) AS comparecimentos_count,
      COALESCE(po.propostas_abertas, 0) AS propostas_abertas,
      COALESCE(po.propostas_fechadas, 0) AS propostas_fechadas,
      COALESCE(vo.vendas_count, 0) AS vendas_count,
      COALESCE(vo.receita, 0) AS receita
    FROM leads_by_origin lo
    LEFT JOIN conf_by_origin co ON co.origin = lo.origin
    LEFT JOIN prop_by_origin po ON po.origin = lo.origin
    LEFT JOIN vendas_by_origin vo ON vo.origin = lo.origin
  )
  SELECT jsonb_build_object(
    'origins', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'origin', c.origin,
        'leads_count', c.leads_count,
        'agendamentos_count', c.agendamentos_count,
        'comparecimentos_count', c.comparecimentos_count,
        'propostas_abertas', c.propostas_abertas,
        'propostas_fechadas', c.propostas_fechadas,
        'vendas_count', c.vendas_count,
        'receita', c.receita
      ) ORDER BY c.leads_count DESC)
      FROM combined c
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;


-- =============================================================================
-- GRANTs
-- =============================================================================
GRANT EXECUTE ON FUNCTION public.get_analytics_overview_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_analytics_commercial_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_analytics_financial_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_analytics_pipeline_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_analytics_engagement_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_mkt_origin_metrics TO authenticated, service_role;
