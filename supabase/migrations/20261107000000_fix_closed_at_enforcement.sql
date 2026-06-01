-- Fix: vendidos/perdidos missing closed_at are invisible to period metrics.
-- Root cause: closed_at only set by frontend; workflows/direct updates skip it.
-- pipe_propostas is a VIEW over pipeline_entries — trigger goes on the real table.
-- Fix: (1) backfill existing NULLs, (2) trigger on pipeline_entries,
--       (3) RPC get_dashboard_metrics with updated_at fallback,
--       (4) RPC get_ranking_data with updated_at fallback.

-- =============================================================================
-- 1. BACKFILL: set closed_at for existing pipeline_entries with final stages
-- =============================================================================
UPDATE pipeline_entries
SET closed_at = COALESCE(updated_at, created_at)
WHERE stage_key IN ('vendido', 'perdido')
  AND closed_at IS NULL;

-- =============================================================================
-- 2. TRIGGER on pipeline_entries: auto-set closed_at on final stages
-- =============================================================================
CREATE OR REPLACE FUNCTION public.enforce_closed_at_on_final_stage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stage_key IN ('vendido', 'perdido') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := NOW();
  END IF;
  IF NEW.stage_key NOT IN ('vendido', 'perdido')
     AND OLD IS NOT NULL
     AND OLD.stage_key IN ('vendido', 'perdido') THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_closed_at ON pipeline_entries;
CREATE TRIGGER trg_enforce_closed_at
  BEFORE INSERT OR UPDATE OF stage_key ON pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_closed_at_on_final_stage();

-- =============================================================================
-- 3. RPC: rebuild get_dashboard_metrics with updated_at fallback
-- =============================================================================
DROP FUNCTION IF EXISTS public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

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

  -- 3. Propostas enviadas
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_funnel_propostas := v_propostas_enviadas;

  -- 4. Vendas — COALESCE com updated_at fallback
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at, updated_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at, updated_at) <= p_end_date
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
          AND COALESCE(prev.metrics_period_at, prev.closed_at, prev.updated_at) < p_start_date
      ) AS is_returning_customer
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) <= p_end_date
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

  -- 5. Tempo médio de resposta
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

  -- 6. Daily sales series — with updated_at fallback
  SELECT COALESCE(jsonb_agg(row_to_json(daily) ORDER BY daily.day), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT DATE(COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at)) AS day,
      SUM(COALESCE(pp.sale_value, 0)) AS revenue,
      COUNT(*) AS count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR pp.closer_id = p_filter_member_id
           OR pp.responsible_id = p_filter_member_id)
    GROUP BY DATE(COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at))
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
    'tempoMedioResposta', v_tempo_medio_resposta,
    'novosClientes', v_novos_clientes,
    'propostasEnviadas', v_propostas_enviadas,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'vendaBaseAtiva', v_venda_base_ativa,
    'dailySales', v_daily_sales,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics TO service_role;

COMMENT ON FUNCTION public.get_dashboard_metrics IS
  'Dashboard metrics with closed_at enforcement + updated_at fallback. v20261107';

-- =============================================================================
-- 4. FIX get_ranking_data — same COALESCE fallback
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_ranking_data(
  p_month INT,
  p_year INT,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT COALESCE(pp.responsible_id, pp.closer_id) AS member_id,
           SUM(COALESCE(pp.sale_value, 0))::numeric AS total_value,
           COUNT(*)::int AS conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.responsible_id, pp.closer_id) IS NOT NULL
      AND (
        (pp.metrics_period_at IS NOT NULL AND pp.metrics_period_at >= v_start_ts AND pp.metrics_period_at <= v_end_ts)
        OR (pp.metrics_period_at IS NULL AND COALESCE(pp.closed_at, pp.updated_at) >= v_start_ts AND COALESCE(pp.closed_at, pp.updated_at) <= v_end_ts)
      )
    GROUP BY member_id
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

  WITH meetings_flat AS (
    SELECT pc.id AS meeting_id,
           unnest(ARRAY[pc.responsible_id, pc.sdr_id, pc.closer_id]) AS member_id
    FROM public.pipe_confirmacao pc
    WHERE pc.organization_id = v_org_id
      AND pc.status = 'compareceu'
      AND (
        (pc.metrics_period_at IS NOT NULL AND pc.metrics_period_at >= v_start_ts AND pc.metrics_period_at <= v_end_ts)
        OR (pc.metrics_period_at IS NULL AND pc.created_at >= v_start_ts AND pc.created_at <= v_end_ts)
      )
  ),
  meetings_agg AS (
    SELECT member_id,
           COUNT(DISTINCT meeting_id)::int AS total_meetings
    FROM meetings_flat
    WHERE member_id IS NOT NULL
    GROUP BY member_id
  ),
  meetings_data AS (
    SELECT tm.id, tm.name, tm.job_title, COALESCE(tm.metric_type, 'meetings') AS metric_type,
      0::numeric AS total_value,
      COALESCE(ma.total_meetings, 0) AS meetings,
      (SELECT g.target_value FROM public.goals g
       WHERE g.organization_id = v_org_id AND g.team_member_id = tm.id
         AND g.month = p_month AND g.year = p_year AND g.type = 'reunioes'
       ORDER BY g.created_at DESC LIMIT 1) AS goal_target
    FROM public.team_members tm
    LEFT JOIN meetings_agg ma ON ma.member_id = tm.id
    WHERE tm.organization_id = v_org_id AND tm.is_active = true
      AND tm.metric_type = 'meetings'
  ),
  meetings_sorted AS (
    SELECT id, name, job_title, metric_type, total_value, meetings, goal_target,
      ROW_NUMBER() OVER (ORDER BY meetings DESC) AS pos
    FROM meetings_data
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id, 'name', name, 'job_title', job_title, 'metric_type', metric_type,
      'value', total_value, 'meetings', meetings,
      'goal', COALESCE(goal_target, 0),
      'goalProgress', CASE WHEN goal_target IS NOT NULL AND goal_target > 0
        THEN ROUND((meetings::numeric / goal_target) * 100)::int ELSE 0 END,
      'position', pos::int, 'role', 'Reuniões'
    ) ORDER BY pos
  ), '[]'::jsonb) INTO v_meetings_ranking
  FROM meetings_sorted;

  RETURN jsonb_build_object('salesRanking', v_sales_ranking, 'meetingsRanking', v_meetings_ranking);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ranking_data TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ranking_data TO service_role;
