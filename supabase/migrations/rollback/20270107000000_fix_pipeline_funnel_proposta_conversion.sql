CREATE OR REPLACE FUNCTION public.get_analytics_pipeline_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_pipeline_type text DEFAULT NULL::text, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  result jsonb;
  v_end_ts timestamptz := (p_end_date + interval '1 day');
BEGIN
  PERFORM public.assert_org_access(p_org_id);
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
        SELECT 1 FROM meeting_events me WHERE me.lead_id = pw.lead_id AND me.organization_id = p_org_id AND me.event_type = 'meeting_booked'
      )
  ),
  -- Stage 3: Leads that attended meeting (compareceu) in confirmacao
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
  -- Confirmacao lost: leads that entered confirmacao but marked perdido and never attended
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
      COUNT(DISTINCT me.lead_id) AS meeting_cnt
    FROM months_series m
    LEFT JOIN meeting_events me ON me.organization_id = p_org_id
      AND me.event_type = 'meeting_held'
      AND COALESCE(me.meeting_date, me.occurred_at) >= m.month_start
      AND COALESCE(me.meeting_date, me.occurred_at) < m.month_start + interval '1 month'
      AND (p_member_id IS NULL OR me.pre_sale_responsible_id = p_member_id)
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
$function$
