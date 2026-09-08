-- Rollback de 20271008000000_leitores_saem_dos_espelhos.sql
-- Corpos exatos capturados de PROD antes da troca. Reintroduz leitores dos
-- espelhos; usar somente para rollback da janela, antes da demolição.

BEGIN;

-- restore bulk_delete_leads(uuid[])
CREATE OR REPLACE FUNCTION public.bulk_delete_leads(p_lead_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_count integer;
BEGIN
  v_user_id := auth.uid();

  IF public.is_master_user() THEN
    -- master: no org pin; scope is bounded by the explicit p_lead_ids
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = v_user_id AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  -- Soft-delete leads (caller's org for members; any matching id for master)
  UPDATE public.leads
  SET deleted_at = now(), deleted_by = v_user_id
  WHERE id = ANY(p_lead_ids)
    AND (v_org_id IS NULL OR organization_id = v_org_id)
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Remove from pipeline_entries so kanban is clean
  DELETE FROM public.pipeline_entries
  WHERE lead_id = ANY(p_lead_ids)
    AND (v_org_id IS NULL OR organization_id = v_org_id);

  -- Remove from legacy pipe tables
  DELETE FROM public.pipe_whatsapp    WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);
  DELETE FROM public.pipe_confirmacao WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);
  DELETE FROM public.pipe_propostas   WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);
  DELETE FROM public.custom_pipe_entries WHERE lead_id = ANY(p_lead_ids) AND (v_org_id IS NULL OR organization_id = v_org_id);

  RETURN v_count;
END;
$function$;

-- restore custom_pipeline_stages_insert_fn()
CREATE OR REPLACE FUNCTION public.custom_pipeline_stages_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.id := public.fn_etapa_custom_criar(to_jsonb(NEW));
  SELECT cps.* INTO NEW FROM public.custom_pipeline_stages cps WHERE cps.id = NEW.id;
  RETURN NEW;
END;
$function$;

-- restore custom_pipelines_insert_fn()
CREATE OR REPLACE FUNCTION public.custom_pipelines_insert_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.id := public.fn_funil_custom_criar(to_jsonb(NEW));
  SELECT cp.* INTO NEW FROM public.custom_pipelines cp WHERE cp.id = NEW.id;
  RETURN NEW;
END;
$function$;

-- restore get_analytics_commercial_metrics(uuid,date,date,uuid,text)
CREATE OR REPLACE FUNCTION public.get_analytics_commercial_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
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
      me.pre_sale_responsible_id AS member_id,
      COUNT(DISTINCT me.id) AS meetings_attended
    FROM meeting_events me
    JOIN leads l ON l.id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND COALESCE(me.meeting_date, me.occurred_at) >= p_start_date
      AND COALESCE(me.meeting_date, me.occurred_at) < (p_end_date + interval '1 day')
      AND me.pre_sale_responsible_id IS NOT NULL
      AND (p_origin IS NULL OR l.origin::text = p_origin)
      AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)
    GROUP BY me.pre_sale_responsible_id
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
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
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
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
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
$function$;

-- restore get_analytics_financial_metrics(uuid,date,date,uuid,text)
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
      AND (l.deleted_at IS NULL) AND (l.is_shadow IS NULL OR l.is_shadow = false)
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
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
      AND (l.deleted_at IS NULL) AND (l.is_shadow IS NULL OR l.is_shadow = false)
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

-- restore get_analytics_overview_metrics(uuid,date,date,uuid,text)
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
      AND (l.deleted_at IS NULL) AND (l.is_shadow IS NULL OR l.is_shadow = false)
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
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin::text = p_origin)
      AND (l.deleted_at IS NULL) AND (l.is_shadow IS NULL OR l.is_shadow = false)
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

-- restore get_analytics_pipeline_metrics(uuid,date,date,text,uuid,uuid)
CREATE OR REPLACE FUNCTION public.get_analytics_pipeline_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_pipeline_type text DEFAULT NULL::text, p_member_id uuid DEFAULT NULL::uuid, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  result jsonb;
  v_end_ts timestamptz := (p_end_date + interval '1 day');
  v_pipeline_id uuid;
  v_filtered boolean := (p_pipeline_id IS NOT NULL OR p_pipeline_type IS NOT NULL);
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF v_filtered THEN
    SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
    WHERE p.organization_id = p_org_id
      AND ((p_pipeline_id IS NOT NULL AND p.id = p_pipeline_id)
        OR (p_pipeline_id IS NULL AND p.slug = p_pipeline_type));
    -- Filtro pedido e inexistente: recortes filtrados ficam vazios (idêntico
    -- ao legado com p_pipeline_type fora do trio).
  END IF;

  WITH
  -- ─── FULL-FUNNEL (jornada da org — inalterado byte-a-byte) ────────────────
  leads_created AS (
    SELECT l.id AS lead_id, l.created_at
    FROM leads l
    WHERE l.organization_id = p_org_id
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
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
  whatsapp_lost AS (
    SELECT COUNT(DISTINCT pw.lead_id) AS cnt
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND pw.status = 'esfriou'
      AND NOT EXISTS (
        SELECT 1 FROM meeting_events me WHERE me.lead_id = pw.lead_id AND me.organization_id = p_org_id AND me.event_type = 'meeting_booked'
      )
  ),
  attended_leads AS (
    SELECT DISTINCT me.lead_id
    FROM meeting_events me
    JOIN leads_created lc ON lc.lead_id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)
  ),
  attended_count AS (
    SELECT COUNT(*) AS cnt FROM attended_leads
  ),
  proposta_leads AS (SELECT DISTINCT pp.lead_id FROM pipe_propostas pp JOIN leads_created lc ON lc.lead_id = pp.lead_id WHERE pp.organization_id = p_org_id AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)),
  proposta_count AS (SELECT COUNT(*) AS cnt FROM proposta_leads),
  confirmacao_lost AS (
    SELECT COUNT(DISTINCT me.lead_id) AS cnt
    FROM meeting_events me
    JOIN leads_created lc ON lc.lead_id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_booked'
      AND me.meeting_date IS NOT NULL
      AND me.meeting_date < NOW()
      AND NOT EXISTS (
        SELECT 1 FROM meeting_events h
        WHERE h.event_type = 'meeting_held' AND h.booked_event_id = me.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM attended_leads al WHERE al.lead_id = me.lead_id
      )
  ),
  -- B2c: ganho lido do NEGÓCIO. Antes vinha de `pipe_propostas.status =
  -- 'vendido'` — um slug de etapa da view legada, cego para funil custom e
  -- para venda decidida pelo botão sem mover o card.
  won_leads AS (
    SELECT DISTINCT pe.lead_id
    FROM pipeline_entries pe
    JOIN deals d ON d.id = pe.deal_id
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = pe.lead_id
    WHERE pe.organization_id = p_org_id
      AND pip.slug = 'propostas'
      AND d.outcome = 'won'
      AND (p_member_id IS NULL
        OR pe.metadata->>'closer_id' = p_member_id::text
        OR pe.metadata->>'responsible_id' = p_member_id::text)
  ),
  won_count AS (
    SELECT COUNT(*) AS cnt FROM won_leads
  ),
  -- B2c: perda lida do NEGÓCIO, mesmo motivo do bloco acima.
  propostas_lost AS (
    SELECT COUNT(DISTINCT pe.lead_id) AS cnt
    FROM pipeline_entries pe
    JOIN deals d ON d.id = pe.deal_id
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = pe.lead_id
    WHERE pe.organization_id = p_org_id
      AND pip.slug = 'propostas'
      AND d.outcome = 'lost'
  ),
  avg_days_whatsapp AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pw.updated_at - lc.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_whatsapp pw
    JOIN leads_created lc ON lc.lead_id = pw.lead_id
    WHERE pw.organization_id = p_org_id
  ),
  avg_days_confirmacao AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (me.occurred_at - pw.created_at)) / 86400)::numeric, 1) AS avg_days
    FROM meeting_events me
    JOIN pipe_whatsapp pw ON pw.lead_id = me.lead_id AND pw.organization_id = p_org_id
    JOIN leads_created lc ON lc.lead_id = me.lead_id
    WHERE me.organization_id = p_org_id
      AND me.event_type = 'meeting_booked'
  ),
  avg_days_propostas AS (
    SELECT ROUND(AVG(EXTRACT(EPOCH FROM (pp.updated_at - me.occurred_at)) / 86400)::numeric, 1) AS avg_days
    FROM pipe_propostas pp
    JOIN meeting_events me ON me.lead_id = pp.lead_id AND me.organization_id = p_org_id AND me.event_type = 'meeting_booked'
    JOIN leads_created lc ON lc.lead_id = pp.lead_id
    WHERE pp.organization_id = p_org_id
  ),

  -- ─── PIPELINE AGING (D-agz: genérico por funil; custom entra) ─────────────
  -- Estado atual, sem filtro de data (como o legado). "Ainda em jogo" deixou
  -- de ser propriedade da ETAPA e passou a ser do NEGÓCIO (B2c) — ver o
  -- cabeçalho. Âncora: stage_changed_at = tempo NA etapa (o legado usava
  -- updated_at = último toque, que rejuvenescia o card a cada edição).
  combined_aging AS (
    SELECT
      CASE WHEN v_filtered THEN ps.name ELSE pip.name || ' · ' || ps.name END AS stage_name,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 < 3) AS healthy_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 BETWEEN 3 AND 6.9999) AS attention_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 BETWEEN 7 AND 13.9999) AS risk_count,
      COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW() - COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at))) / 86400 >= 14) AS critical_count,
      MIN(pip.display_order) AS pipe_ord,
      MIN(ps.position) AS stage_pos
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id
     AND pip.organization_id = p_org_id
     AND pip.is_active
    JOIN pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    LEFT JOIN deals d ON d.id = pe.deal_id
    WHERE pe.organization_id = p_org_id
      AND (NOT v_filtered OR pe.pipeline_id = v_pipeline_id)
      -- B2c: "ainda em jogo" = o NEGÓCIO não foi decidido. A etapa continua
      -- dando o nome e a ordem da linha; ela só deixa de decidir o desfecho.
      -- LEFT JOIN porque card sem negócio é card aberto — não some da esteira.
      AND COALESCE(d.outcome, 'open') NOT IN ('won', 'lost')
      AND (p_member_id IS NULL
        OR pe.assigned_to = p_member_id
        OR pe.metadata->>'closer_id' = p_member_id::text
        OR pe.metadata->>'responsible_id' = p_member_id::text
        OR pe.metadata->>'sdr_id' = p_member_id::text
        OR pe.metadata->>'pre_sale_responsible_id' = p_member_id::text
        OR pe.metadata->>'sale_responsible_id' = p_member_id::text)
    GROUP BY pip.id, pip.name, ps.id, ps.name
  ),

  -- ─── WEIGHTED FORECAST (D-fx: funil resolvido, ou todos sem filtro) ───────
  -- Pondera o VALOR ABERTO do pipeline — não é receita. Receita realizada é
  -- exclusiva do caderno sale_events (ADR-0017); este bloco nunca soma venda
  -- fechada (negócio com desfecho decidido fica de fora, B2c).
  -- Probabilidade: default_probability da PRÓPRIA etapa (mecanismo, editável
  -- por org) / 100, fallback 0.50 — substitui a tabela fixa por slug que
  -- ainda por cima descartava proposta_enviada.
  weighted_forecast AS (
    SELECT
      CASE WHEN v_filtered THEN ps.name ELSE pip.name || ' · ' || ps.name END AS stage_name,
      COUNT(*) AS deal_count,
      COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0) AS total_value,
      ROUND(COALESCE(MIN(ps.default_probability), 50)::numeric / 100.0, 2) AS win_probability,
      ROUND((COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0)
             * COALESCE(MIN(ps.default_probability), 50)::numeric / 100.0), 2) AS weighted_value,
      MIN(pip.display_order) AS pipe_ord,
      MIN(ps.position) AS stage_pos
    FROM pipeline_entries pe
    JOIN pipelines pip
      ON pip.id = pe.pipeline_id
     AND pip.organization_id = p_org_id
     AND pip.is_active
    JOIN pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    LEFT JOIN deals d ON d.id = pe.deal_id
    WHERE pe.organization_id = p_org_id
      AND (NOT v_filtered OR pe.pipeline_id = v_pipeline_id)
      -- B2c: mesma troca da esteira. Aqui ela importa mais: previsão que
      -- inclui negócio já fechado promete receita que já entrou ou já morreu.
      AND COALESCE(d.outcome, 'open') NOT IN ('won', 'lost')
      AND pe.created_at >= p_start_date
      AND pe.created_at < v_end_ts
      AND (p_member_id IS NULL
        OR pe.assigned_to = p_member_id
        OR pe.metadata->>'closer_id' = p_member_id::text
        OR pe.metadata->>'responsible_id' = p_member_id::text
        OR pe.metadata->>'sdr_id' = p_member_id::text
        OR pe.metadata->>'pre_sale_responsible_id' = p_member_id::text
        OR pe.metadata->>'sale_responsible_id' = p_member_id::text)
    GROUP BY pip.id, pip.name, ps.id, ps.name
    HAVING COALESCE(SUM((pe.metadata->>'sale_value')::numeric), 0) > 0
  ),

  -- ─── CONVERSION TRENDS (últimos 6 meses; [0..2] byte-a-byte) ──────────────
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
           AND NOT public.lead_excluded_from_metrics(l.id, p_org_id)
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
      COUNT(DISTINCT me.lead_id) AS meeting_cnt
    FROM months_series m
    LEFT JOIN meeting_events me ON me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND COALESCE(me.meeting_date, me.occurred_at) >= m.month_start
      AND COALESCE(me.meeting_date, me.occurred_at) < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)
    GROUP BY m.month_label
  ),
  -- 'vendido no mês' do funil propostas.
  -- B2c: o ganho vem de `deals.outcome` e a âncora passa a ser
  -- `deals.outcome_at` — o instante em que a venda foi DECIDIDA, gravado por
  -- quem decidiu. Antes: COALESCE(pe.closed_at, pe.stage_changed_at), que
  -- descreve o card, não o negócio; mover o card depois movia a venda de mês.
  --
  -- A 20270914000020 (B2b) devolveu a `outcome_at` a data real de 543
  -- fechamentos que o B1 tinha carimbado com a data da migration. Sem aquilo,
  -- ancorar aqui empilharia 465 vendas num único mês.
  monthly_won AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT w.lead_id) AS won_cnt
    FROM months_series m
    LEFT JOIN (
      SELECT pe.lead_id,
             d.outcome_at AS won_at,
             pe.metadata
      FROM pipeline_entries pe
      JOIN deals d
        ON d.id = pe.deal_id
       AND d.outcome = 'won'
      JOIN pipelines pip
        ON pip.id = pe.pipeline_id
       AND pip.organization_id = p_org_id
       AND pip.slug = 'propostas'
      WHERE pe.organization_id = p_org_id
    ) w ON w.won_at >= m.month_start
       AND w.won_at < m.month_start + interval '1 month'
       AND (p_member_id IS NULL
         OR w.metadata->>'closer_id' = p_member_id::text
         OR w.metadata->>'responsible_id' = p_member_id::text)
    GROUP BY m.month_label
  ),
  monthly_proposta AS (
    SELECT
      m.month_label,
      COUNT(DISTINCT pp.lead_id) AS proposta_cnt
    FROM months_series m
    LEFT JOIN pipe_propostas pp ON pp.organization_id = p_org_id
      AND pp.created_at >= m.month_start
      AND pp.created_at < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id OR pp.responsible_id = p_member_id)
    GROUP BY m.month_label
  ),
  trends_combined AS (
    SELECT
      ml.month_label,
      ml.lead_cnt,
      COALESCE(mq.qualified_cnt, 0) AS qualified_cnt,
      COALESCE(mm.meeting_cnt, 0) AS meeting_cnt,
      COALESCE(mp.proposta_cnt, 0) AS proposta_cnt,
      COALESCE(mw.won_cnt, 0) AS won_cnt
    FROM monthly_leads ml
    LEFT JOIN monthly_qualified mq ON mq.month_label = ml.month_label
    LEFT JOIN monthly_meetings mm ON mm.month_label = ml.month_label
    LEFT JOIN monthly_proposta mp ON mp.month_label = ml.month_label
    LEFT JOIN monthly_won mw ON mw.month_label = ml.month_label
    ORDER BY ml.month_start
  )

  SELECT jsonb_build_object(
    -- Full funnel stages (jornada da org: só sem filtro de funil, como antes)
    'funnel_stages', CASE WHEN NOT v_filtered THEN
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
    'stage_analysis', CASE WHEN NOT v_filtered THEN
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
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM proposta_count)::numeric / NULLIF((SELECT cnt FROM attended_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM confirmacao_lost),
          'primary_loss_status', 'perdido'
        ),
        jsonb_build_object(
          'transition_name', 'Proposta → Venda',
          'conversion_pct', ROUND(COALESCE((SELECT cnt FROM won_count)::numeric / NULLIF((SELECT cnt FROM proposta_count), 0) * 100, 0), 1),
          'lost_count', (SELECT cnt FROM propostas_lost),
          'primary_loss_status', 'perdido'
        )
      )
    ELSE '[]'::jsonb END,

    -- Pipeline aging (ordenado por funil e posição da etapa)
    'pipeline_aging', COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'stage_name', ca.stage_name,
        'total', ca.total,
        'healthy_count', ca.healthy_count,
        'attention_count', ca.attention_count,
        'risk_count', ca.risk_count,
        'critical_count', ca.critical_count
      ) ORDER BY ca.pipe_ord, ca.stage_pos) FROM combined_aging ca WHERE ca.total > 0),
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
      ) ORDER BY wf.pipe_ord, wf.stage_pos) FROM weighted_forecast wf),
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
            'rate', ROUND(COALESCE(tc.proposta_cnt::numeric / NULLIF(tc.meeting_cnt, 0) * 100, 0), 1)
          ) ORDER BY month_label)
          FROM trends_combined tc
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'transition_name', 'Proposta → Venda',
        'months', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month_label', tc.month_label,
            'rate', ROUND(COALESCE(tc.won_cnt::numeric / NULLIF(tc.proposta_cnt, 0) * 100, 0), 1)
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
$function$;

-- restore get_analytics_utm_metrics(uuid,date,date,uuid,text,text,text,text)
CREATE OR REPLACE FUNCTION public.get_analytics_utm_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_level text DEFAULT 'campaign'::text, p_campaign text DEFAULT NULL::text, p_adset text DEFAULT NULL::text, p_ad text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  -- ── Leads level: return individual leads ──
  IF p_level = 'leads' THEN
    SELECT jsonb_build_object('items', COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb))
    INTO v_result
    FROM (
      SELECT
        l.id,
        l.name,
        l.email,
        l.phone,
        l.created_at,
        COALESCE(
          (SELECT pw.status FROM pipe_whatsapp pw WHERE pw.lead_id = l.id ORDER BY pw.created_at DESC LIMIT 1),
          'sem pipe'
        ) AS pipe_status,
        COALESCE(
          (SELECT tm.name FROM team_members tm WHERE tm.id = l.responsible_id),
          'Não atribuído'
        ) AS responsible,
        COALESCE(l.rating, 0) AS rating
      FROM leads l
      WHERE l.organization_id = p_org_id
        AND l.created_at >= p_start_date::timestamp
        AND l.created_at < (p_end_date + 1)::timestamp
        AND l.utm_campaign IS NOT NULL
        AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
        AND (p_campaign IS NULL OR l.utm_campaign = p_campaign)
        AND (p_adset IS NULL OR l.utm_content = p_adset)
        AND (p_ad IS NULL OR l.utm_term = p_ad)
      ORDER BY l.created_at DESC
    ) t;

    RETURN v_result;
  END IF;

  -- ── Aggregated levels: campaign / adset / ad ──
  WITH filtered_leads AS (
    SELECT
      l.id,
      l.utm_campaign,
      l.utm_content,
      l.utm_term,
      l.meta_campaign_id,
      l.meta_adset_id,
      l.meta_ad_id,
      l.rating,
      l.responsible_id
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND l.created_at >= p_start_date::timestamp
      AND l.created_at < (p_end_date + 1)::timestamp
      AND l.utm_campaign IS NOT NULL
      AND (p_member_id IS NULL OR l.responsible_id = p_member_id)
      AND (p_campaign IS NULL OR l.utm_campaign = p_campaign)
      AND (p_adset IS NULL OR l.utm_content = p_adset)
      AND (p_ad IS NULL OR l.utm_term = p_ad)
  ),
  lead_proposals AS (
    SELECT
      pp.lead_id,
      pp.status,
      COALESCE(pp.sale_value, 0) AS sale_value
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.lead_id IN (SELECT id FROM filtered_leads)
  ),
  grouped AS (
    SELECT
      CASE p_level
        WHEN 'campaign' THEN fl.utm_campaign
        WHEN 'adset'    THEN fl.utm_content
        WHEN 'ad'       THEN fl.utm_term
      END AS name,
      CASE p_level
        WHEN 'campaign' THEN fl.meta_campaign_id
        WHEN 'adset'    THEN fl.meta_adset_id
        WHEN 'ad'       THEN fl.meta_ad_id
      END AS meta_id,
      COUNT(DISTINCT fl.id) AS total_leads,
      COUNT(DISTINCT CASE WHEN lp.status = 'vendido' THEN fl.id END) AS converted,
      COALESCE(SUM(CASE WHEN lp.status = 'vendido' THEN lp.sale_value ELSE 0 END), 0) AS revenue,
      ROUND(AVG(fl.rating) FILTER (WHERE fl.rating IS NOT NULL), 1) AS avg_rating
    FROM filtered_leads fl
    LEFT JOIN lead_proposals lp ON lp.lead_id = fl.id
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'name', g.name,
        'meta_id', g.meta_id,
        'total_leads', g.total_leads,
        'converted', g.converted,
        'conversion_rate', CASE WHEN g.total_leads > 0
          THEN ROUND((g.converted::numeric / g.total_leads) * 100, 1)
          ELSE 0 END,
        'revenue', g.revenue,
        'avg_rating', COALESCE(g.avg_rating, 0)
      )
      ORDER BY g.total_leads DESC
    ), '[]'::jsonb)
  ) INTO v_result
  FROM grouped g;

  RETURN v_result;
END;
$function$;

-- restore get_leads_by_uf(character,integer,uuid)
CREATE OR REPLACE FUNCTION public.get_leads_by_uf(p_uf character, p_limit integer DEFAULT 60, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, company text, phone text, uf_source text, is_client boolean, sold_value numeric, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT l.id, l.name, l.company, l.phone, l.uf_source,
    EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'),
    COALESCE((SELECT SUM(pp.sale_value) FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'), 0)::numeric,
    l.created_at
  FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf = p_uf
  ORDER BY 7 DESC, l.created_at DESC
  LIMIT p_limit;
END; $function$;

-- restore get_mkt_origin_metrics(uuid,date,date,uuid)
CREATE OR REPLACE FUNCTION public.get_mkt_origin_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid)
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
$function$;

-- restore get_next_best_actions(integer,uuid)
CREATE OR REPLACE FUNCTION public.get_next_best_actions(p_limit integer DEFAULT 10, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, lead_id uuid, lead_name text, deal_id uuid, action_type text, title text, reason text, priority integer, due_by timestamp with time zone, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH stored AS (
    SELECT nba.id, nba.lead_id, l.name, nba.deal_id, nba.action_type, nba.title, nba.reason, nba.priority, nba.due_by, nba.metadata
    FROM next_best_actions nba LEFT JOIN leads l ON l.id = nba.lead_id
    WHERE nba.organization_id = v_org_id AND nba.completed_at IS NULL AND nba.dismissed_at IS NULL
  ),
  overdue_followups AS (
    SELECT md5('fu:'||fu.id::text)::uuid, fu.lead_id, l.name, NULL::uuid,
      'follow_up'::text, ('Follow-up atrasado: '||COALESCE(NULLIF(fu.title,''),'sem título'))::text,
      ('Vencido há '||GREATEST(EXTRACT(DAY FROM now()-fu.due_date)::int,1)||' dia(s) — resgate rápido recupera o lead antes de esfriar.')::text,
      9, fu.due_date, jsonb_build_object('derived',true,'source','follow_ups')
    FROM follow_ups fu LEFT JOIN leads l ON l.id = fu.lead_id
    WHERE fu.organization_id = v_org_id AND fu.completed_at IS NULL AND fu.archived_at IS NULL AND fu.due_date < now()
    ORDER BY fu.due_date ASC LIMIT 5
  ),
  stale_proposals AS (
    SELECT md5('pp:'||pp.id::text)::uuid, pp.lead_id, l.name, pp.id,
      'send_proposal'::text, ('Proposta parada há '||EXTRACT(DAY FROM now()-pp.updated_at)::int||' dias')::text,
      ('Sem movimento desde '||to_char(pp.updated_at,'DD/MM')||CASE WHEN COALESCE(pp.sale_value,0)>0 THEN ' — R$ '||to_char(pp.sale_value,'FM999G999G999')||' em jogo.' ELSE ' — retome o contato hoje.' END)::text,
      7, NULL::timestamptz, jsonb_build_object('derived',true,'source','pipe_propostas')
    FROM pipe_propostas pp LEFT JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = v_org_id AND pp.status NOT IN ('vendido','perdido') AND pp.updated_at < now() - interval '7 days'
    ORDER BY COALESCE(pp.sale_value,0) DESC, pp.updated_at ASC LIMIT 5
  ),
  missed_meetings AS (
    SELECT md5('mb:'||mb.id::text)::uuid, mb.lead_id, l.name, NULL::uuid,
      'meeting'::text, 'Reagendar reunião perdida'::text,
      ('Reunião de '||to_char(COALESCE(mb.meeting_date,mb.occurred_at),'DD/MM')||' não aconteceu e o lead segue sem novo horário.')::text,
      6, NULL::timestamptz, jsonb_build_object('derived',true,'source','meeting_events')
    FROM meeting_events mb LEFT JOIN leads l ON l.id = mb.lead_id
    WHERE mb.organization_id = v_org_id AND mb.event_type = 'meeting_booked'
      AND COALESCE(mb.meeting_date,mb.occurred_at) BETWEEN now() - interval '14 days' AND now()
      AND NOT EXISTS (SELECT 1 FROM meeting_events mh WHERE mh.organization_id = v_org_id AND mh.event_type='meeting_held'
        AND (mh.booked_event_id = mb.id OR (mh.lead_id = mb.lead_id AND mh.occurred_at >= COALESCE(mb.meeting_date,mb.occurred_at))))
      AND NOT EXISTS (SELECT 1 FROM meeting_events mf WHERE mf.organization_id = v_org_id AND mf.event_type='meeting_booked'
        AND mf.lead_id = mb.lead_id AND COALESCE(mf.meeting_date,mf.occurred_at) > now())
    ORDER BY COALESCE(mb.meeting_date,mb.occurred_at) DESC LIMIT 4
  ),
  hot_idle_leads AS (
    SELECT md5('hl:'||l.id::text)::uuid, l.id, l.name, NULL::uuid,
      'call'::text, 'Resgatar lead quente parado'::text,
      ('Qualificação alta e sem movimento desde '||to_char(l.updated_at,'DD/MM')||' — um contato hoje mantém o lead vivo.')::text,
      5, NULL::timestamptz, jsonb_build_object('derived',true,'source','leads')
    FROM leads l
    WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL
      AND (l.rating >= 4 OR l.qualification_score >= 70)
      AND l.updated_at < now() - interval '48 hours'
      AND NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.lead_id = l.id AND fu.completed_at IS NULL AND fu.archived_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')
    ORDER BY l.qualification_score DESC NULLS LAST, l.rating DESC NULLS LAST, l.updated_at ASC
    LIMIT 4
  )
  SELECT * FROM (
    SELECT * FROM stored
    UNION ALL SELECT * FROM overdue_followups
    UNION ALL SELECT * FROM stale_proposals
    UNION ALL SELECT * FROM missed_meetings
    UNION ALL SELECT * FROM hot_idle_leads
  ) AS unioned
  ORDER BY unioned.priority DESC, unioned.due_by ASC NULLS LAST
  LIMIT p_limit;
END; $function$;

-- restore get_ranking_data(integer,integer,uuid)
CREATE OR REPLACE FUNCTION public.get_ranking_data(p_month integer, p_year integer, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_sales_ranking JSONB;
  v_meetings_ranking JSONB;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    v_org_id := p_organization_id;
  ELSE
    SELECT tm.organization_id INTO v_org_id
    FROM public.team_members tm WHERE tm.user_id = auth.uid() AND tm.is_active = true
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('salesRanking', '[]'::jsonb, 'meetingsRanking', '[]'::jsonb);
  END IF;

  v_start_ts := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_ts := ((make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date + time '23:59:59.999') AT TIME ZONE 'UTC';

  WITH sales_agg AS (
    SELECT COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id) AS member_id,
           SUM(COALESCE(pp.sale_value, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.sale_responsible_id, pp.responsible_id, pp.closer_id) IS NOT NULL
      AND (
        (pp.metrics_period_at IS NOT NULL AND pp.metrics_period_at >= v_start_ts AND pp.metrics_period_at <= v_end_ts)
        OR (pp.metrics_period_at IS NULL AND COALESCE(pp.closed_at, pp.updated_at) >= v_start_ts AND COALESCE(pp.closed_at, pp.updated_at) <= v_end_ts)
      )
    GROUP BY 1
  ),
  sales_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'sales') AS metric_type,
      COALESCE(sa.total_value, 0) AS total_value,
      COALESCE(sa.conversions, 0) AS conversions,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'vendas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND (tm.metric_type = 'sales' OR tm.metric_type IS NULL)
  ),
  sales_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, conversions, goal_target,
      ROW_NUMBER() OVER (ORDER BY total_value DESC) AS pos
    FROM sales_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value, 'conversions', conversions,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((total_value / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Vendas'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_sales_ranking
  FROM sales_sorted;

  -- Reuniões — event-sourced (ADR-0007): held no período da reunião,
  -- booked no período da marcação, atribuição canônica = pré-vendas (snapshot)
  WITH held_agg AS (
    SELECT me.pre_sale_responsible_id AS member_id, COUNT(*)::int AS total_meetings
    FROM public.meeting_events me
    WHERE me.organization_id = v_org_id
      AND me.event_type = 'meeting_held'
      AND me.pre_sale_responsible_id IS NOT NULL
      AND COALESCE(me.meeting_date, me.occurred_at) >= v_start_ts
      AND COALESCE(me.meeting_date, me.occurred_at) <= v_end_ts
    GROUP BY 1
  ),
  booked_agg AS (
    SELECT me.pre_sale_responsible_id AS member_id, COUNT(*)::int AS total_booked
    FROM public.meeting_events me
    WHERE me.organization_id = v_org_id
      AND me.event_type = 'meeting_booked'
      AND me.pre_sale_responsible_id IS NOT NULL
      AND me.occurred_at >= v_start_ts
      AND me.occurred_at <= v_end_ts
    GROUP BY 1
  ),
  meetings_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'meetings') AS metric_type,
      0::numeric AS total_value,
      COALESCE(ha.total_meetings, 0) AS meetings,
      COALESCE(ba.total_booked, 0) AS meetings_booked,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year
         AND g.type IN ('reunioes_realizadas', 'reunioes')
       ORDER BY CASE g.type WHEN 'reunioes_realizadas' THEN 0 ELSE 1 END, g.created_at DESC
       LIMIT 1) AS goal_target,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes_marcadas'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_booked_target
    FROM public.team_members tm
    LEFT JOIN held_agg ha ON ha.member_id = tm.id
    LEFT JOIN booked_agg ba ON ba.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND tm.metric_type = 'meetings'
  ),
  meetings_sorted AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY meetings DESC, meetings_booked DESC) AS pos
    FROM meetings_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value,
      'meetings', meetings,
      'meetingsBooked', meetings_booked,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((meetings::numeric / goal_target) * 100)::int ELSE 0 END,
      'goalBooked', COALESCE(goal_booked_target, 0),
      'goalBookedProgress', CASE WHEN goal_booked_target IS NOT NULL AND goal_booked_target > 0
        THEN ROUND((meetings_booked::numeric / goal_booked_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Reuniões'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_meetings_ranking
  FROM meetings_sorted;

  RETURN jsonb_build_object('salesRanking', v_sales_ranking, 'meetingsRanking', v_meetings_ranking);
END;
$function$;

-- restore get_uf_heatmap(uuid)
CREATE OR REPLACE FUNCTION public.get_uf_heatmap(p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(uf character, leads_count bigint, clients_count bigint, total_sold numeric, unmapped_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id uuid; v_unmapped bigint;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  SELECT count(*) INTO v_unmapped FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NULL;
  RETURN QUERY
  SELECT l.uf, count(*)::bigint,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido'))::bigint,
    COALESCE(SUM((SELECT SUM(pp.sale_value) FROM pipe_propostas pp WHERE pp.lead_id = l.id AND pp.status = 'vendido')), 0)::numeric,
    v_unmapped
  FROM leads l
  WHERE l.organization_id = v_org_id AND l.deleted_at IS NULL AND l.uf IS NOT NULL
  GROUP BY l.uf;
END; $function$;

-- restore purge_lead(uuid)
CREATE OR REPLACE FUNCTION public.purge_lead(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_org_id uuid;
  v_upsell_ids uuid[];
  v_proposta_ids uuid[];
BEGIN
  IF public.is_master_user() THEN
    v_org_id := NULL;
  ELSE
    SELECT organization_id INTO v_org_id
    FROM public.team_members
    WHERE user_id = auth.uid() AND is_active = true
    LIMIT 1;

    IF v_org_id IS NULL THEN
      RAISE EXCEPTION 'No active organization membership';
    END IF;
  END IF;

  -- Verify lead is in trash (and belongs to caller's org, unless master)
  IF NOT EXISTS(
    SELECT 1 FROM public.leads
    WHERE id = p_lead_id
      AND (v_org_id IS NULL OR organization_id = v_org_id)
      AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Lead not found in trash';
  END IF;

  -- 1. Upsell chain (ON DELETE RESTRICT — must delete children first)
  SELECT array_agg(uc.id) INTO v_upsell_ids
  FROM public.upsell_clients uc
  WHERE uc.lead_id = p_lead_id;

  IF v_upsell_ids IS NOT NULL THEN
    DELETE FROM public.upsell_orders        WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_campanhas     WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_client_products WHERE client_id = ANY(v_upsell_ids);
    DELETE FROM public.upsell_clients       WHERE id = ANY(v_upsell_ids);
  END IF;

  -- 2. Pipe proposta items (via pipe_propostas)
  SELECT array_agg(pp.id) INTO v_proposta_ids
  FROM public.negocio_projetado pp
  WHERE pp.funil_sistema = 'propostas'
    AND pp.lead_id = p_lead_id;

  IF v_proposta_ids IS NOT NULL THEN
    DELETE FROM public.pipe_proposta_items WHERE pipe_proposta_id = ANY(v_proposta_ids);
  END IF;

  -- 3. All other lead-dependent records
  DELETE FROM public.lead_tags        WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_history     WHERE lead_id = p_lead_id;
  DELETE FROM public.follow_ups       WHERE lead_id = p_lead_id;
  DELETE FROM public.acoes_do_dia     WHERE lead_id = p_lead_id;
  DELETE FROM public.campanha_leads   WHERE lead_id = p_lead_id;
  DELETE FROM public.lead_scores      WHERE lead_id = p_lead_id;
  DELETE FROM public.leads_reativacao WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_whatsapp    WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_confirmacao WHERE lead_id = p_lead_id;
  DELETE FROM public.pipe_propostas   WHERE lead_id = p_lead_id;
  DELETE FROM public.custom_pipe_entries WHERE lead_id = p_lead_id;
  DELETE FROM public.pipeline_entries WHERE lead_id = p_lead_id;

  -- 4. Delete the lead itself
  DELETE FROM public.leads WHERE id = p_lead_id;
END;
$function$;

-- restore remove_demo_data(uuid)
CREATE OR REPLACE FUNCTION public.remove_demo_data(p_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_caller_id    uuid  := auth.uid();
  v_is_admin     boolean;
  v_tag_id       uuid;
  v_leads_deleted int  := 0;
BEGIN
  -- ── Guard: caller deve ser admin da org ────────────────────────────────────
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = v_caller_id
      AND organization_id = p_org_id
      AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'insufficient_privilege: apenas admin pode remover dados demo'
      USING ERRCODE = '42501';
  END IF;

  -- ── Buscar tag demo ─────────────────────────────────────────────────────────
  SELECT id INTO v_tag_id
  FROM public.tags
  WHERE organization_id = p_org_id AND name = 'demo';

  IF v_tag_id IS NULL THEN
    RETURN jsonb_build_object('removed', 0, 'reason', 'no_demo_tag');
  END IF;

  -- ── Deletar leads com watermark [DEMO] + tag demo ──────────────────────────
  -- Ordem respeita FK: lead_tags cascade via ON DELETE CASCADE em leads,
  -- mas deletar explicitamente para garantir.

  -- lead_tags primeiro (embora cascade, explícito é mais seguro em seeds)
  DELETE FROM public.lead_tags
  WHERE tag_id = v_tag_id
    AND lead_id IN (
      SELECT id FROM public.leads
      WHERE organization_id = p_org_id
        AND name LIKE '[DEMO]%'
    );

  -- Leads com watermark
  DELETE FROM public.leads
  WHERE organization_id = p_org_id
    AND name LIKE '[DEMO]%';

  GET DIAGNOSTICS v_leads_deleted = ROW_COUNT;

  -- ── Deletar pipeline demo ───────────────────────────────────────────────────
  DELETE FROM public.custom_pipelines
  WHERE organization_id = p_org_id
    AND slug = 'demo-pipeline';

  RETURN jsonb_build_object(
    'removed',      v_leads_deleted,
    'pipeline',     'demo-pipeline'
  );
END;
$function$;

-- restore trigger_google_calendar_sync()
CREATE OR REPLACE FUNCTION public.trigger_google_calendar_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supabase_url    text;
  v_service_key     text;
  v_assigned_to     uuid;
  v_pipe_conf_id    uuid;
  v_old_date        timestamptz;
  v_new_date        timestamptz;
begin
  v_old_date := OLD.compromisso_date;
  v_new_date := NEW.compromisso_date;

  -- Só processa se compromisso_date mudou e não é nulo
  if v_new_date is null or v_new_date = v_old_date then
    return NEW;
  end if;

  -- Usa closer_id com fallback para sdr_id (campo assigned_to não existe em leads)
  v_assigned_to := coalesce(NEW.closer_id, NEW.sdr_id);
  if v_assigned_to is null then
    return NEW;
  end if;

  -- Verifica se o responsável tem Google Calendar conectado
  perform 1
  from google_calendar_tokens
  where user_id = v_assigned_to
    and is_active = true
  limit 1;

  if not found then
    return NEW;
  end if;

  -- Busca o pipe_confirmacao vinculado ao lead (se existir)
  select id into v_pipe_conf_id
  from pipe_confirmacao
  where lead_id = NEW.id
  order by created_at desc
  limit 1;

  v_supabase_url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co';
  v_service_key  := current_setting('app.service_role_key', true);

  -- Só dispara se a service_key estiver configurada
  if v_service_key is null or v_service_key = '' then
    raise warning '[google_calendar_sync] app.service_role_key não configurado, pulando sync automático';
    return NEW;
  end if;

  perform net.http_post(
    url     => v_supabase_url || '/functions/v1/google-calendar-events',
    headers => jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    => jsonb_build_object(
      'title',                NEW.name || ' - Reunião',
      'description',          'Reunião com lead: ' || coalesce(NEW.name, '') ||
                              case when NEW.phone is not null
                                   then chr(10) || 'Telefone: ' || NEW.phone
                                   else '' end,
      'start_at',             to_char(v_new_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'end_at',               to_char(v_new_date + interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'timezone',             'America/Sao_Paulo',
      'lead_id',              NEW.id::text,
      'pipe_confirmacao_id',  coalesce(v_pipe_conf_id::text, null),
      'calendar_owner_id',    v_assigned_to::text,
      '_system_trigger',      true
    )
  );

  return NEW;
exception
  when others then
    raise warning '[google_calendar_sync] Erro ao disparar sync: %', sqlerrm;
    return NEW;
end;
$function$;

COMMIT;
