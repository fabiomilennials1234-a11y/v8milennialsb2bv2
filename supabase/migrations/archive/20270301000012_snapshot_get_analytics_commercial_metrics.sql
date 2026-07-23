-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

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
$function$;
