-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

CREATE OR REPLACE FUNCTION public.get_analytics_engagement_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
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
$function$;
