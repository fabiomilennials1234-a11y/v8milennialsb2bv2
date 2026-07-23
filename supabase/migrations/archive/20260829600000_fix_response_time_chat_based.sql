-- Fix tempo de resposta: calculate from WhatsApp chat messages instead of pipe_confirmacao
-- For each incoming message, find the next outgoing human response and avg the delta
-- Also fix taxa de conversão to match propostas page (vendas / total in pipe)

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
  v_total_in_pipe INTEGER := 0;
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

  -- No-show
  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id AND meeting_date < NOW()
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);

  SELECT COUNT(*) INTO v_no_show
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id AND meeting_date < NOW() AND status IN ('remarcar', 'perdido')
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);

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
         OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);
  v_funnel_propostas := v_propostas_enviadas;

  -- 4. Vendas (vendido no período por closed_at/metrics_period_at)
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);
  v_novos_clientes := v_funnel_vendas;

  -- Perdidos no período (for conversion rate: vendas / (vendas + perdidos))
  SELECT COUNT(*) INTO v_total_in_pipe
  FROM pipe_propostas
  WHERE organization_id = p_org_id AND status = 'perdido'
    AND (
      (metrics_period_at IS NOT NULL AND metrics_period_at >= p_start_date AND metrics_period_at <= p_end_date)
      OR (metrics_period_at IS NULL AND closed_at >= p_start_date AND closed_at <= p_end_date)
    )
    AND (p_filter_member_id IS NULL
         OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);
  v_total_in_pipe := v_funnel_vendas + v_total_in_pipe; -- closed deals = won + lost

  -- Taxa de conversão = vendas / (vendas + perdidos) — matches propostas page formula
  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- Revenue breakdown
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
           OR pp.closer_id = p_filter_member_id OR pp.responsible_id = p_filter_member_id)
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

  -- 5. Tempo médio de resposta do time no CHAT (WhatsApp messages)
  -- For each incoming message, find the next outgoing HUMAN response and avg the delta
  SELECT COALESCE(
    ROUND(AVG(EXTRACT(EPOCH FROM (response_time - incoming_time)) / 60)::NUMERIC, 1),
    0
  ) INTO v_tempo_medio_resposta
  FROM (
    SELECT
      wm_in.timestamp AS incoming_time,
      (
        SELECT MIN(wm_out.timestamp)
        FROM whatsapp_messages wm_out
        WHERE wm_out.organization_id = p_org_id
          AND wm_out.direction = 'outgoing'
          AND wm_out.lead_id = wm_in.lead_id
          AND wm_out.timestamp > wm_in.timestamp
          AND wm_out.timestamp < wm_in.timestamp + INTERVAL '24 hours'
          AND (wm_out.sent_by_ai IS NULL OR wm_out.sent_by_ai = false)
      ) AS response_time
    FROM whatsapp_messages wm_in
    WHERE wm_in.organization_id = p_org_id
      AND wm_in.direction = 'incoming'
      AND wm_in.timestamp >= p_start_date
      AND wm_in.timestamp <= p_end_date
      AND wm_in.lead_id IS NOT NULL
  ) sub
  WHERE response_time IS NOT NULL;

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
           OR pp.closer_id = p_filter_member_id OR pp.responsible_id = p_filter_member_id)
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
    'tempoMedioResposta', v_tempo_medio_resposta,
    'novosClientes', v_novos_clientes,
    'propostasEnviadas', v_propostas_enviadas,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'vendaBaseAtiva', v_venda_base_ativa,
    'dailySales', v_daily_sales,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas,
    'taxaConversao', v_taxa_conversao,
    'totalInPipe', v_total_in_pipe
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics TO service_role;
