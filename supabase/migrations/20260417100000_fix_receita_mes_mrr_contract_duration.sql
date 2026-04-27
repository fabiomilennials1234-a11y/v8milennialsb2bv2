-- =============================================================================
-- Fix "receita do mês" — MRR estava mostrando valor total contratado
-- =============================================================================
--
-- PROBLEMA:
-- A RPC get_dashboard_metrics (migration 20260911000000) multiplicava
-- sale_value × contract_duration para produtos MRR em três campos:
--   - v_venda_total         (→ vendaTotal)        "Faturamento" no dashboard
--   - v_venda_base_ativa    (→ vendaBaseAtiva)    clientes recorrentes
--   - v_venda_primeiro_pedido (→ vendaPrimeiroPedido) clientes novos
-- Resultado: o card "Receita/Faturamento" exibia o valor TOTAL CONTRATADO
-- ao longo de todo o contrato (LTV-like), em vez das vendas que efetivamente
-- entraram no mês. Ex.: venda MRR de R$ 1.000/mês × 12 meses → dashboard
-- mostrava R$ 12.000 no mês em vez de R$ 1.000.
--
-- Histórico:
--   - 20260708000004 ADICIONOU a multiplicação intencionalmente, confundindo
--     semântica "valor total contratado" com "receita do mês"
--   - 20260829400000 removeu a multiplicação (corrigiu)
--   - 20260911000000 regrediu ao reescrever a RPC para corrigir taxaConversao
--
-- FIX:
-- Remove apenas as 3 ocorrências de × v_duration no bloco MRR. Preserva
-- integralmente o resto da RPC (taxaConversao, filtros, campos retornados,
-- signature). v_venda_mrr já estava correto (monthly) e permanece intacto.
-- v_ticket_medio deixa de ser inflado porque deriva de v_venda_total.
--
-- REGRA CORRETA:
--   vendaTotal  = Σ sale_value (todas vendas no período)
--   vendaMRR    = Σ sale_value (MRR no período) = novo MRR mensal
--   vendaProjeto= Σ sale_value (projetos no período)
--   ticketMedio = vendaTotal / funnelVendas
--
-- Se algum consumidor precisar de "valor total contratado" (LTV-like), deve
-- ser um campo separado explicitamente nomeado (ex.: valorTotalContratado).
-- =============================================================================

-- Drop old TIMESTAMPTZ signature (from 20260829400000) se existir no ambiente.
-- 20260911000000 trocou pra DATE mas pode não ter sido aplicada em todos os
-- ambientes — este DROP garante idempotência sem criar overload ambíguo.
DROP FUNCTION IF EXISTS public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID);

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_filter_member_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_leads INTEGER := 0;
  v_tempo_medio_resposta NUMERIC := 0;
  v_reunioes_marcadas INTEGER := 0;
  v_reunioes_comparecidas INTEGER := 0;
  v_no_show INTEGER := 0;
  v_taxa_no_show NUMERIC := 0;
  v_finalizados_data_passada INTEGER := 0;
  v_propostas_enviadas INTEGER := 0;
  v_funnel_vendas INTEGER := 0;
  v_funnel_propostas INTEGER := 0;
  v_funnel_reunioes_marcadas INTEGER := 0;
  v_funnel_compareceu INTEGER := 0;
  v_novos_clientes INTEGER := 0;
  v_venda_total NUMERIC := 0;
  v_venda_mrr NUMERIC := 0;
  v_venda_projeto NUMERIC := 0;
  v_venda_base_ativa NUMERIC := 0;
  v_venda_primeiro_pedido NUMERIC := 0;
  v_ticket_medio NUMERIC := 0;
  v_ticket_medio_mrr NUMERIC := 0;
  v_ticket_medio_projeto NUMERIC := 0;
  v_taxa_conversao NUMERIC := 0;
  v_total_in_pipe INTEGER := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  rec RECORD;
BEGIN
  -- 1. Total de leads criados no período
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND created_at >= p_start_date AND created_at <= p_end_date
    AND (p_filter_member_id IS NULL OR responsible_id = p_filter_member_id);

  -- 2. Tempo médio de resposta (primeira mensagem outgoing - primeira incoming)
  SELECT COALESCE(AVG(minutes_diff), 0) INTO v_tempo_medio_resposta
  FROM (
    SELECT EXTRACT(EPOCH FROM (MIN(CASE WHEN cm.role = 'assistant' THEN cm.created_at END)
                             - MIN(CASE WHEN cm.role = 'user' THEN cm.created_at END))) / 60 AS minutes_diff
    FROM conversation_messages cm
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE c.organization_id = p_org_id
      AND cm.created_at >= p_start_date AND cm.created_at <= p_end_date
    GROUP BY cm.conversation_id
    HAVING MIN(CASE WHEN cm.role = 'user' THEN cm.created_at END) IS NOT NULL
       AND MIN(CASE WHEN cm.role = 'assistant' THEN cm.created_at END) IS NOT NULL
  ) sub;

  -- Reuniões marcadas, comparecidas, no-show
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);
  v_funnel_compareceu := v_reunioes_comparecidas;

  SELECT COUNT(*) INTO v_no_show
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id AND meeting_date < NOW() AND status IN ('remarcar', 'perdido')
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sdr_id = p_filter_member_id OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);

  SELECT COUNT(*) INTO v_finalizados_data_passada
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

  -- Taxa de conversão: vendidos / total com atividade no período
  SELECT COUNT(DISTINCT id) INTO v_total_in_pipe
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND (
      (COALESCE(metrics_period_at, created_at) >= p_start_date
       AND COALESCE(metrics_period_at, created_at) <= p_end_date)
      OR (status IN ('vendido', 'perdido')
          AND COALESCE(metrics_period_at, closed_at) >= p_start_date
          AND COALESCE(metrics_period_at, closed_at) <= p_end_date)
    )
    AND (p_filter_member_id IS NULL
         OR closer_id = p_filter_member_id OR responsible_id = p_filter_member_id);

  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- ===== REVENUE BREAKDOWN (FIX: receita do mês, sem multiplicar por contract_duration) =====
  -- Regra: vendaTotal representa o que ENTROU no mês (MRR novo mensal + projetos + outros).
  -- NUNCA multiplicar por contract_duration aqui — isso seria "valor total contratado" (LTV),
  -- semântica diferente que deve ter campo separado se necessário.
  FOR rec IN
    SELECT pp.status, pp.sale_value, pp.closed_at, pp.metrics_period_at,
           pp.contract_duration, pp.product_type,
           EXISTS (
             SELECT 1 FROM pipe_propostas prev
             WHERE prev.organization_id = pp.organization_id
               AND prev.lead_id = pp.lead_id
               AND prev.status = 'vendido' AND prev.id != pp.id
               AND prev.closed_at < pp.closed_at
           ) AS is_repeat
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR pp.closer_id = p_filter_member_id OR pp.responsible_id = p_filter_member_id)
  LOOP
    DECLARE
      v_val NUMERIC := COALESCE(rec.sale_value, 0);
    BEGIN
      IF rec.product_type = 'mrr' THEN
        v_venda_mrr := v_venda_mrr + v_val;
        v_venda_total := v_venda_total + v_val;  -- FIX: sem * contract_duration
        IF rec.is_repeat THEN
          v_venda_base_ativa := v_venda_base_ativa + v_val;  -- FIX
        ELSE
          v_venda_primeiro_pedido := v_venda_primeiro_pedido + v_val;  -- FIX
        END IF;
      ELSIF rec.product_type = 'projeto' THEN
        v_venda_projeto := v_venda_projeto + v_val;
        v_venda_total := v_venda_total + v_val;
        IF rec.is_repeat THEN
          v_venda_base_ativa := v_venda_base_ativa + v_val;
        ELSE
          v_venda_primeiro_pedido := v_venda_primeiro_pedido + v_val;
        END IF;
      ELSE
        v_venda_total := v_venda_total + v_val;
        IF rec.is_repeat THEN
          v_venda_base_ativa := v_venda_base_ativa + v_val;
        ELSE
          v_venda_primeiro_pedido := v_venda_primeiro_pedido + v_val;
        END IF;
      END IF;
    END;
  END LOOP;

  IF v_funnel_vendas > 0 THEN
    v_ticket_medio := v_venda_total / v_funnel_vendas;
  END IF;

  -- Daily sales aggregation
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('day', day_str, 'count', count_val, 'revenue', revenue_val)
    ORDER BY day_str
  ), '[]'::jsonb) INTO v_daily_sales
  FROM (
    SELECT TO_CHAR(COALESCE(metrics_period_at, closed_at), 'YYYY-MM-DD') AS day_str,
           COUNT(*) AS count_val,
           SUM(COALESCE(sale_value, 0)) AS revenue_val
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR pp.closer_id = p_filter_member_id OR pp.responsible_id = p_filter_member_id)
    GROUP BY day_str
    ORDER BY day_str
  ) daily;

  RETURN jsonb_build_object(
    'totalLeads', v_total_leads,
    'tempoMedioResposta', ROUND(v_tempo_medio_resposta::numeric, 1),
    'reunioesMarcadas', v_reunioes_marcadas,
    'reunioesComparecidas', v_reunioes_comparecidas,
    'noShow', v_no_show,
    'taxaNoShow', v_taxa_no_show,
    'propostasEnviadas', v_propostas_enviadas,
    'novosClientes', v_novos_clientes,
    'vendaTotal', v_venda_total,
    'vendaMRR', v_venda_mrr,
    'vendaProjeto', v_venda_projeto,
    'vendaBaseAtiva', v_venda_base_ativa,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'ticketMedio', v_ticket_medio,
    'ticketMedioMRR', v_ticket_medio_mrr,
    'ticketMedioProjeto', v_ticket_medio_projeto,
    'dailySales', v_daily_sales,
    'funnelVendas', v_funnel_vendas,
    'funnelPropostas', v_funnel_propostas,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'taxaConversao', v_taxa_conversao,
    'totalInPipe', v_total_in_pipe
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_metrics(UUID, DATE, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_dashboard_metrics IS
  'Métricas do dashboard. vendaTotal = Σ sale_value de vendas no período (monthly para MRR, sem multiplicar por contract_duration). Fix aplicado em 2026-04-17: removida inflação indevida que multiplicava MRR por contract_duration em vendaTotal/vendaBaseAtiva/vendaPrimeiroPedido. taxaConversao = vendidos / (vendidos + perdidos + novos no período).';
