-- Extend get_dashboard_metrics with new fields for Central de Comandos B2B:
-- proposals count, avg response time, first-order vs base, daily sales series.
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_filter_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
  v_total_leads BIGINT;
  v_reunioes_marcadas BIGINT;
  v_reunioes_comparecidas BIGINT;
  v_no_show BIGINT;
  v_finalizados_data_passada BIGINT;
  v_taxa_no_show INT;
  v_venda_total NUMERIC := 0;
  v_venda_mrr NUMERIC := 0;
  v_venda_projeto NUMERIC := 0;
  v_mrr_proposal_count BIGINT := 0;
  v_projeto_proposal_count BIGINT := 0;
  v_novos_clientes BIGINT;
  v_ticket_medio NUMERIC := 0;
  v_ticket_medio_mrr NUMERIC := 0;
  v_ticket_medio_projeto NUMERIC := 0;
  v_funnel_leads BIGINT;
  v_funnel_reunioes BIGINT;
  v_funnel_comparecidas BIGINT;
  v_funnel_propostas BIGINT;
  v_funnel_vendas BIGINT;
  v_propostas_enviadas BIGINT;
  v_tempo_medio_resposta NUMERIC := 0;
  v_venda_primeiro_pedido NUMERIC := 0;
  v_venda_base_ativa NUMERIC := 0;
  v_daily_sales JSONB;
  rec RECORD;
BEGIN
  -- 1. Leads
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND (is_shadow IS NULL OR is_shadow = false)
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id);
  v_funnel_leads := v_total_leads;

  -- 2. Reuniões
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id);
  v_funnel_reunioes := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id);
  v_funnel_comparecidas := v_reunioes_comparecidas;

  SELECT COUNT(*) FILTER (WHERE status IN ('perdido', 'remarcar')), COUNT(*)
  INTO v_no_show, v_finalizados_data_passada
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND meeting_date IS NOT NULL AND meeting_date <= NOW()
    AND status IN ('compareceu', 'perdido', 'remarcar')
    AND (p_filter_member_id IS NULL OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id);

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  ELSE v_taxa_no_show := 0;
  END IF;

  -- 3. Propostas enviadas
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL OR closer_id = p_filter_member_id);
  v_funnel_propostas := v_propostas_enviadas;

  -- 4. Vendas + primeiro pedido vs base ativa
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date
    AND (p_filter_member_id IS NULL OR closer_id = p_filter_member_id);
  v_novos_clientes := v_funnel_vendas;

  FOR rec IN
    SELECT pp.id AS proposta_id, pp.lead_id, pp.sale_value AS prop_sale_value,
      pp.product_type AS prop_product_type,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('sale_value', ppi.sale_value, 'product_type', pr.type))
         FROM pipe_proposta_items ppi LEFT JOIN products pr ON pr.id = ppi.product_id
         WHERE ppi.proposta_id = pp.id), '[]'::jsonb
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
      AND (p_filter_member_id IS NULL OR pp.closer_id = p_filter_member_id)
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

  -- 5. Tempo médio de resposta (horas)
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (first_contact - lead_created)) / 3600), 0)
  INTO v_tempo_medio_resposta
  FROM (
    SELECT l.created_at AS lead_created,
      (SELECT MIN(pc.created_at) FROM pipe_confirmacao pc WHERE pc.lead_id = l.id) AS first_contact
    FROM leads l
    WHERE l.organization_id = p_org_id AND (l.is_shadow IS NULL OR l.is_shadow = false)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      AND (p_filter_member_id IS NULL OR l.sdr_id = p_filter_member_id OR l.closer_id = p_filter_member_id)
  ) sub WHERE first_contact IS NOT NULL;

  -- 6. Daily sales series
  SELECT COALESCE(jsonb_agg(row_to_json(daily) ORDER BY daily.day), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT DATE(COALESCE(pp.metrics_period_at, pp.closed_at)) AS day,
      SUM(COALESCE(pp.sale_value, 0)) AS revenue, COUNT(*) AS count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (p_filter_member_id IS NULL OR pp.closer_id = p_filter_member_id)
    GROUP BY DATE(COALESCE(pp.metrics_period_at, pp.closed_at))
  ) daily;

  -- 7. Result
  result := jsonb_build_object(
    'totalLeads', v_total_leads, 'reunioesMarcadas', v_reunioes_marcadas,
    'reunioesComparecidas', v_reunioes_comparecidas, 'noShow', v_no_show,
    'taxaNoShow', v_taxa_no_show, 'vendaTotal', v_venda_total,
    'vendaMRR', v_venda_mrr, 'vendaProjeto', v_venda_projeto,
    'ticketMedio', v_ticket_medio, 'ticketMedioMRR', v_ticket_medio_mrr,
    'ticketMedioProjeto', v_ticket_medio_projeto, 'novosClientes', v_novos_clientes,
    'funnelLeads', v_funnel_leads, 'funnelReunioes', v_funnel_reunioes,
    'funnelComparecidas', v_funnel_comparecidas, 'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas,
    'propostasEnviadas', v_propostas_enviadas,
    'tempoMedioResposta', ROUND(v_tempo_medio_resposta::NUMERIC, 1),
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'vendaBaseAtiva', v_venda_base_ativa,
    'dailySales', v_daily_sales
  );
  RETURN result;
END;
$$;
