-- 20270919000030_dashboard_metrics_pela_projecao.sql — ROLLBACK
--
-- Restaura get_dashboard_metrics EXATAMENTE como estava em PROD em 2026-09-03
-- (`pg_get_functiondef`, jsjsmuncfkbsbzqzqhfq). CREATE OR REPLACE: sem DROP,
-- sem grant a redeclarar. Volta a ler `pipe_propostas`.

BEGIN;

-- ---- get_dashboard_metrics ---------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone, p_filter_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_venda_sem_classificacao NUMERIC := 0;
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
  v_taxa_conversao NUMERIC := 0;
  v_mrr_proposal_count INTEGER := 0;
  v_projeto_proposal_count INTEGER := 0;
  rec RECORD;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND (is_shadow IS NULL OR is_shadow = false)
    AND COALESCE(excluded_from_metrics, false) = false
    AND deleted_at IS NULL
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.occurred_at >= p_start_date
    AND me.occurred_at <= p_end_date
    AND (p_filter_member_id IS NULL OR me.pre_sale_responsible_id = p_filter_member_id);
  v_funnel_reunioes_marcadas := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_held'
    AND COALESCE(me.meeting_date, me.occurred_at) >= p_start_date
    AND COALESCE(me.meeting_date, me.occurred_at) <= p_end_date
    AND (p_filter_member_id IS NULL OR me.pre_sale_responsible_id = p_filter_member_id);
  v_funnel_compareceu := v_reunioes_comparecidas;

  SELECT COUNT(*) INTO v_finalizados_data_passada
  FROM meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.meeting_date IS NOT NULL
    AND me.meeting_date < NOW()
    AND me.occurred_at >= p_start_date
    AND me.occurred_at <= p_end_date
    AND (p_filter_member_id IS NULL OR me.pre_sale_responsible_id = p_filter_member_id);

  SELECT COUNT(*) INTO v_no_show
  FROM meeting_events me
  WHERE me.organization_id = p_org_id
    AND me.event_type = 'meeting_booked'
    AND me.meeting_date IS NOT NULL
    AND me.meeting_date < NOW()
    AND me.occurred_at >= p_start_date
    AND me.occurred_at <= p_end_date
    AND (p_filter_member_id IS NULL OR me.pre_sale_responsible_id = p_filter_member_id)
    AND NOT EXISTS (
      SELECT 1 FROM meeting_events h
      WHERE h.event_type = 'meeting_held' AND h.booked_event_id = me.id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::numeric / v_finalizados_data_passada) * 100, 2);
  END IF;

  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (p_filter_member_id IS NULL
         OR sale_responsible_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_funnel_propostas := v_propostas_enviadas;

  -- Vendas do CADERNO, líquido de estornos, de TODOS os funis.
  -- Antes vinha de `pipe_propostas` — só o funil Orçamentos. Decisão do CTO:
  -- contar tudo. O desfecho é do NEGÓCIO, então recortar por funil deixou de
  -- fazer sentido; e a partir do B as etapas de ganho nem existem mais.
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM public.sale_events se
  WHERE se.organization_id = p_org_id
    AND se.event_type = 'sale'
    AND se.sold_at >= p_start_date AND se.sold_at <= p_end_date
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                     WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
    AND (p_filter_member_id IS NULL OR se.sale_responsible_id = p_filter_member_id);
  v_novos_clientes := v_funnel_vendas;

  IF v_total_leads > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::numeric / v_total_leads) * 100, 2);
  END IF;

  -- Receita e mix de produto, do caderno.
  --
  -- O mix vem de `deal_items` (migrado em 20270908005010) alcançado pelo
  -- negócio que a vista resolve (20270908005020). LEFT JOIN LATERAL e não
  -- subconsulta por coluna: a venda SEM item precisa aparecer com zero, não
  -- sumir da soma.
  --
  -- 🚨 `vendaSemClassificacao` é campo NOVO e existe por decisão explícita.
  -- Medido em 6 meses: 280 de 428 vendas não têm item de produto, e isso são
  -- R$ 335 mil que MRR + Projeto não somam. Antes esse dinheiro evaporava
  -- entre três caixas que não fecham; agora a tela diz onde ele está.
  -- Esconder seria apagar a evidência de que a operação fecha venda sem
  -- informar o que vendeu — o mesmo problema do valor ausente, no campo ao lado.
  SELECT
    COALESCE(SUM(v.sale_value), 0),
    COALESCE(SUM(mix.mrr), 0),
    COALESCE(SUM(mix.projeto), 0),
    COALESCE(SUM(v.sale_value) FILTER (WHERE v.revenue_stream = 'carteira'), 0),
    COALESCE(SUM(v.sale_value) FILTER (WHERE v.revenue_stream = 'novo_negocio'), 0),
    COUNT(*) FILTER (WHERE mix.mrr > 0),
    COUNT(*) FILTER (WHERE mix.projeto > 0)
  INTO v_venda_total, v_venda_mrr, v_venda_projeto,
       v_venda_base_ativa, v_venda_primeiro_pedido,
       v_mrr_proposal_count, v_projeto_proposal_count
  FROM public.v_sale_events_negocio v
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(di.total) FILTER (WHERE pr.type = 'mrr'), 0)     AS mrr,
           COALESCE(SUM(di.total) FILTER (WHERE pr.type = 'projeto'), 0) AS projeto
      FROM public.deal_items di
      LEFT JOIN public.products pr ON pr.id = di.product_id
     WHERE di.deal_id = v.deal_id_resolvido
  ) mix ON TRUE
  WHERE v.organization_id = p_org_id
    AND v.event_type = 'sale'
    AND v.sold_at >= p_start_date AND v.sold_at <= p_end_date
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                     WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = v.id)
    AND (p_filter_member_id IS NULL OR v.sale_responsible_id = p_filter_member_id);

  -- O resto da receita: venda registrada sem produto que a classifique.
  v_venda_sem_classificacao := GREATEST(v_venda_total - v_venda_mrr - v_venda_projeto, 0);

  IF v_novos_clientes > 0 THEN v_ticket_medio := v_venda_total / v_novos_clientes; END IF;
  IF v_mrr_proposal_count > 0 THEN v_ticket_medio_mrr := v_venda_mrr / v_mrr_proposal_count; END IF;
  IF v_projeto_proposal_count > 0 THEN v_ticket_medio_projeto := v_venda_projeto / v_projeto_proposal_count; END IF;

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (first_contact - lead_created)) / 3600), 0)
  INTO v_tempo_medio_resposta
  FROM (
    SELECT l.created_at AS lead_created,
      (SELECT MIN(me.occurred_at) FROM meeting_events me
       WHERE me.lead_id = l.id AND me.event_type = 'meeting_booked') AS first_contact
    FROM leads l
    WHERE l.organization_id = p_org_id AND (l.is_shadow IS NULL OR l.is_shadow = false)
      AND COALESCE(l.excluded_from_metrics, false) = false
      AND l.deleted_at IS NULL
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      AND (p_filter_member_id IS NULL
           OR l.pre_sale_responsible_id = p_filter_member_id
           OR l.sale_responsible_id = p_filter_member_id
           OR l.sdr_id = p_filter_member_id
           OR l.closer_id = p_filter_member_id
           OR l.responsible_id = p_filter_member_id)
  ) sub WHERE first_contact IS NOT NULL;

  SELECT COALESCE(jsonb_agg(row_to_json(daily) ORDER BY daily.day), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT DATE(se.sold_at) AS day,
      SUM(COALESCE(se.sale_value, 0)) AS revenue,
      COUNT(*) AS count
    FROM public.sale_events se
    WHERE se.organization_id = p_org_id
      AND se.event_type = 'sale'
      AND se.sold_at >= p_start_date AND se.sold_at <= p_end_date
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r
                       WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
      AND (p_filter_member_id IS NULL OR se.sale_responsible_id = p_filter_member_id)
    GROUP BY DATE(se.sold_at)
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
    'vendaSemClassificacao', v_venda_sem_classificacao,
    'ticketMedio', v_ticket_medio,
    'ticketMedioMRR', v_ticket_medio_mrr,
    'ticketMedioProjeto', v_ticket_medio_projeto,
    'tempoMedioResposta', v_tempo_medio_resposta,
    'novosClientes', v_novos_clientes,
    'propostasEnviadas', v_propostas_enviadas,
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'vendaBaseAtiva', v_venda_base_ativa,
    'taxaConversao', v_taxa_conversao,
    'dailySales', v_daily_sales,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas
  );
END;
$function$;

COMMIT;
