-- ADR-0007 fase 2 (#754): RPCs do analytics moderno param de ler pipe_confirmacao
-- (estado mutável, fonte morta pós ADR-0004) e leem meeting_events.
-- Atribuição converge pro snapshot canônico do pré-vendas no evento.
-- Aging de kanban (confirmacao_aging) permanece em estado — saúde operacional do board, não métrica.

CREATE OR REPLACE FUNCTION public.get_analytics_commercial_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_analytics_pipeline_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_pipeline_type text DEFAULT NULL::text, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
;

CREATE OR REPLACE FUNCTION public.get_analytics_overview_metrics(p_org_id uuid, p_start_date date, p_end_date date, p_member_id uuid DEFAULT NULL::uuid, p_origin text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
$function$
;
