-- ============================================================================
-- No-show count driven by stage movement, not by meeting date.
--
-- Background
-- ----------
-- Until now `get_dashboard_metrics` only counted a lead as no-show after the
-- scheduled meeting_date had elapsed:
--
--   AND (pe.metadata->>'meeting_date')::timestamptz < NOW()
--   AND pe.stage_key IN ('remarcar', 'perdido')
--
-- The product definition changed: a lead moved to `remarcar` or `perdido` is
-- a no-show the moment the card is moved, regardless of whether the originally
-- scheduled meeting_date has passed. The card movement IS the signal.
--
-- The denominator (taxaNoShow rate) previously counted every entry whose
-- meeting_date had elapsed. Removing the date filter only from the numerator
-- would let the rate exceed 100% (entries with status 'marcada' / 'd-5' / etc.
-- would shrink the denominator artificially). The denominator now scopes to
-- finalised stages: compareceu + remarcar + perdido, again without the date
-- gate, preserving "% no-show among finalised meetings" semantics.
--
-- Q1=B, Q2=card movement (already captured by metrics_period_at), Q3=both
-- remarcar AND perdido count.
--
-- Idempotent: CREATE OR REPLACE FUNCTION rewrites the same signature; nothing
-- else in this migration touches schema or data.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
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
  v_mrr_proposal_count INTEGER := 0;
  v_projeto_proposal_count INTEGER := 0;
  v_taxa_conversao NUMERIC := 0;
  v_total_in_pipe INTEGER := 0;
  v_daily_sales JSONB := '[]'::jsonb;
  rec RECORD;
BEGIN
  -- 1. Total leads in period — lead-level filter on dual fields only.
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND created_at >= p_start_date AND created_at <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR pre_sale_responsible_id = p_filter_member_id
      OR sale_responsible_id     = p_filter_member_id
    );

  -- 2. Average response time (no per-member filter applicable).
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

  -- 3. Meetings — per-member filter on pre_sale_responsible_id ONLY.
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
    );
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'compareceu'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
    );
  v_funnel_compareceu := v_reunioes_comparecidas;

  -- No-show numerator: any entry moved to remarcar/perdido in the period.
  -- The card movement IS the no-show signal, independent of meeting_date.
  SELECT COUNT(*) INTO v_no_show
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND pe.stage_key IN ('remarcar', 'perdido')
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
    );

  -- Denominator: finalised meetings (compareceu + remarcar + perdido) in the
  -- period, without the meeting_date gate, so the rate stays well-defined and
  -- bounded to [0,100].
  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND pe.stage_key IN ('compareceu', 'remarcar', 'perdido')
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'pre_sale_responsible_id')::uuid = p_filter_member_id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  END IF;

  -- 4. Proposals sent — closer-side filter on sale_responsible_id ONLY.
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
    );
  v_funnel_propostas := v_propostas_enviadas;

  -- 5. Sales — closer-side filter on sale_responsible_id ONLY.
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
    AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
    );
  v_novos_clientes := v_funnel_vendas;

  -- Conversion rate denominator.
  SELECT COUNT(DISTINCT pe.id) INTO v_total_in_pipe
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
  WHERE pe.organization_id = p_org_id
    AND (
      (COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) >= p_start_date
       AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.created_at) <= p_end_date)
      OR (pe.stage_key IN ('vendido', 'perdido')
          AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
          AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date)
    )
    AND (
      p_filter_member_id IS NULL
      OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
    );

  IF v_total_in_pipe > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::NUMERIC / v_total_in_pipe) * 100, 1);
  END IF;

  -- Revenue breakdown — closer-side filter on sale_responsible_id ONLY.
  FOR rec IN
    SELECT pe.id AS entry_id,
           pe.lead_id,
           (pe.metadata->>'sale_value')::numeric AS prop_sale_value,
           pe.metadata->>'product_type' AS prop_product_type,
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object('sale_value', ppi.sale_value, 'product_type', pr.type))
              FROM pipe_proposta_items ppi LEFT JOIN products pr ON pr.id = ppi.product_id
              WHERE ppi.pipe_proposta_id = pe.id), '[]'::jsonb
           ) AS items,
           EXISTS (
             SELECT 1 FROM pipeline_entries prev
             JOIN pipelines pip2 ON pip2.id = prev.pipeline_id AND pip2.slug = 'propostas' AND pip2.type = 'system'
             WHERE prev.organization_id = pe.organization_id
               AND prev.lead_id = pe.lead_id
               AND prev.stage_key = 'vendido' AND prev.id != pe.id
               AND COALESCE((prev.metadata->>'metrics_period_at')::timestamptz, prev.closed_at) < p_start_date
           ) AS is_returning_customer
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
      )
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

  IF v_funnel_vendas > 0 THEN v_ticket_medio := v_venda_total / v_funnel_vendas; END IF;
  IF v_mrr_proposal_count > 0 THEN v_ticket_medio_mrr := v_venda_mrr / v_mrr_proposal_count; END IF;
  IF v_projeto_proposal_count > 0 THEN v_ticket_medio_projeto := v_venda_projeto / v_projeto_proposal_count; END IF;

  -- Daily sales aggregation — closer-side filter on sale_responsible_id ONLY.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('day', day_str, 'count', count_val, 'revenue', revenue_val)
    ORDER BY day_str
  ), '[]'::jsonb) INTO v_daily_sales
  FROM (
    SELECT TO_CHAR(COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at), 'YYYY-MM-DD') AS day_str,
           COUNT(*) AS count_val,
           SUM(COALESCE((pe.metadata->>'sale_value')::numeric, 0)) AS revenue_val
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'propostas' AND pip.type = 'system'
    WHERE pe.organization_id = p_org_id AND pe.stage_key = 'vendido'
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) >= p_start_date
      AND COALESCE((pe.metadata->>'metrics_period_at')::timestamptz, pe.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR (pe.metadata->>'sale_responsible_id')::uuid = p_filter_member_id
      )
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

COMMENT ON FUNCTION public.get_dashboard_metrics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS
  'Dashboard metrics. No-show counted by stage movement (remarcar/perdido) — '
  'meeting_date gate removed 2026-05-21 per product spec. Denominator '
  '(taxaNoShow) scopes to finalised stages: compareceu + remarcar + perdido. '
  'Meetings filter uses pe.metadata->>pre_sale_responsible_id ONLY. '
  'Proposals/sales filter uses pe.metadata->>sale_responsible_id ONLY.';
