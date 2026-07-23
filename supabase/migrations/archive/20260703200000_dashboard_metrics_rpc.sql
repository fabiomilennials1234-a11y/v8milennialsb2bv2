-- RPC consolidada para métricas do dashboard.
-- Substitui ~14 queries individuais por uma única chamada.
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

  -- Leads
  v_total_leads BIGINT;

  -- Confirmação (reuniões)
  v_reunioes_marcadas BIGINT;
  v_reunioes_comparecidas BIGINT;
  v_no_show BIGINT;
  v_finalizados_data_passada BIGINT;
  v_taxa_no_show INT;

  -- Propostas / vendas
  v_venda_total NUMERIC := 0;
  v_venda_mrr NUMERIC := 0;
  v_venda_projeto NUMERIC := 0;
  v_mrr_proposal_count BIGINT := 0;
  v_projeto_proposal_count BIGINT := 0;
  v_novos_clientes BIGINT;
  v_ticket_medio NUMERIC := 0;
  v_ticket_medio_mrr NUMERIC := 0;
  v_ticket_medio_projeto NUMERIC := 0;

  -- Funil
  v_funnel_leads BIGINT;
  v_funnel_reunioes BIGINT;
  v_funnel_comparecidas BIGINT;
  v_funnel_propostas BIGINT;
  v_funnel_vendas BIGINT;

  -- Auxiliar para vendas
  rec RECORD;
BEGIN
  -------------------------------------------------------------------
  -- 1. Total Leads (COALESCE metrics_period_at, created_at)
  -------------------------------------------------------------------
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND (is_shadow IS NULL OR is_shadow = false)
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  -- Funnel leads (same query, reuse)
  v_funnel_leads := v_total_leads;

  -------------------------------------------------------------------
  -- 2. Confirmação / Reuniões
  -------------------------------------------------------------------
  -- 2a. Reuniões marcadas (total no período)
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  v_funnel_reunioes := v_reunioes_marcadas;

  -- 2b. Reuniões comparecidas
  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  v_funnel_comparecidas := v_reunioes_comparecidas;

  -- 2c. No-show: reuniões com data passada e status finalizado
  SELECT
    COUNT(*) FILTER (WHERE status IN ('perdido', 'remarcar')),
    COUNT(*)
  INTO v_no_show, v_finalizados_data_passada
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND meeting_date IS NOT NULL
    AND meeting_date <= NOW()
    AND status IN ('compareceu', 'perdido', 'remarcar')
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  ELSE
    v_taxa_no_show := 0;
  END IF;

  -------------------------------------------------------------------
  -- 3. Propostas / Vendas — com items (MRR/Projeto)
  -------------------------------------------------------------------
  -- Contar total de propostas no período (funil)
  SELECT COUNT(*) INTO v_funnel_propostas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date;

  -- Vendas (propostas vendidas) — para métricas e funil
  -- Vendas usam COALESCE(metrics_period_at, closed_at) como filtro temporal
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR closer_id = p_filter_member_id
    );

  v_novos_clientes := v_funnel_vendas;

  -- Calcular valores de venda por tipo (MRR / Projeto) usando items
  FOR rec IN
    SELECT
      pp.id AS proposta_id,
      pp.sale_value AS prop_sale_value,
      pp.product_type AS prop_product_type,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'sale_value', ppi.sale_value,
          'product_type', pr.type
        ))
        FROM pipe_proposta_items ppi
        LEFT JOIN products pr ON pr.id = ppi.product_id
        WHERE ppi.proposta_id = pp.id),
        '[]'::jsonb
      ) AS items
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR pp.closer_id = p_filter_member_id
      )
  LOOP
    IF jsonb_array_length(rec.items) > 0 THEN
      DECLARE
        item JSONB;
        item_val NUMERIC;
        item_type TEXT;
        prop_total NUMERIC := 0;
        prop_mrr NUMERIC := 0;
        prop_proj NUMERIC := 0;
      BEGIN
        FOR item IN SELECT * FROM jsonb_array_elements(rec.items)
        LOOP
          item_val := COALESCE((item->>'sale_value')::NUMERIC, 0);
          item_type := item->>'product_type';
          prop_total := prop_total + item_val;
          IF item_type = 'mrr' THEN
            prop_mrr := prop_mrr + item_val;
          ELSIF item_type = 'projeto' THEN
            prop_proj := prop_proj + item_val;
          END IF;
        END LOOP;
        v_venda_total := v_venda_total + prop_total;
        v_venda_mrr := v_venda_mrr + prop_mrr;
        v_venda_projeto := v_venda_projeto + prop_proj;
        IF prop_mrr > 0 THEN v_mrr_proposal_count := v_mrr_proposal_count + 1; END IF;
        IF prop_proj > 0 THEN v_projeto_proposal_count := v_projeto_proposal_count + 1; END IF;
      END;
    ELSE
      -- Fallback: usar sale_value e product_type da proposta direto
      DECLARE
        val NUMERIC := COALESCE(rec.prop_sale_value, 0);
      BEGIN
        v_venda_total := v_venda_total + val;
        IF rec.prop_product_type = 'mrr' THEN
          v_venda_mrr := v_venda_mrr + val;
          v_mrr_proposal_count := v_mrr_proposal_count + 1;
        ELSIF rec.prop_product_type = 'projeto' THEN
          v_venda_projeto := v_venda_projeto + val;
          v_projeto_proposal_count := v_projeto_proposal_count + 1;
        END IF;
      END;
    END IF;
  END LOOP;

  -- Tickets médios
  IF v_novos_clientes > 0 THEN
    v_ticket_medio := v_venda_total / v_novos_clientes;
  END IF;
  IF v_mrr_proposal_count > 0 THEN
    v_ticket_medio_mrr := v_venda_mrr / v_mrr_proposal_count;
  END IF;
  IF v_projeto_proposal_count > 0 THEN
    v_ticket_medio_projeto := v_venda_projeto / v_projeto_proposal_count;
  END IF;

  -------------------------------------------------------------------
  -- 4. Montar resultado final
  -------------------------------------------------------------------
  result := jsonb_build_object(
    -- Métricas principais
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
    'novosClientes', v_novos_clientes,
    -- Funil
    'funnelLeads', v_funnel_leads,
    'funnelReunioes', v_funnel_reunioes,
    'funnelComparecidas', v_funnel_comparecidas,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas
  );

  RETURN result;
END;
$$;
