-- Clientes importados por planilha em pipeline CUSTOM não são leads novos —
-- são base existente carregada pra gestão de carteira. Não devem inflar a
-- métrica de leads do Dashboard principal (KPI "Leads", passo "Leads" do funil
-- e o denominador da taxa de conversão — todos derivam do mesmo v_total_leads
-- em get_dashboard_metrics, consumido por useDashboardMetrics e useCommandMetrics).
--
-- 1) leads.excluded_from_metrics — marcador setado no ingest (import-leads,
--    destination=custom_pipeline) SOMENTE em lead CRIADO pelo import. Lead já
--    existente que o import apenas atualiza NÃO é marcado (pode ser lead real).
-- 2) get_dashboard_metrics ignora leads marcados no COUNT de v_total_leads e
--    no universo do tempo médio de resposta. Corpo = reemissão do snapshot
--    vivo (20270301000016, ADR-0018) com apenas essas duas mudanças.
--    Anti-padrões PRÉ-EXISTENTES do snapshot (R4/ledger) anotados com
--    metric-lint-allow — congelados, não são mudança desta migration.
-- 3) Backfill: imports custom históricos identificados por lead_history
--    ('Sistema: Lead importado via pipeline custom' — string exclusiva desse
--    path; os paths campanha/funil usam strings próprias e seguem contando).
--
-- SEMÂNTICA DELIBERADA (não mexer sem decisão de produto):
-- • Eventos desses leads (reuniões em meeting_events, propostas/vendas em
--   pipe_propostas) SEGUEM contando nos demais KPIs e nos passos 2-4 do funil.
--   Receita de venda pra base importada não pode sumir do Dashboard; efeito
--   colateral aceito: funil pode ficar não-monotônico e taxaConversao pode
--   passar de 100% num mês com venda de base (hoje 0 vendas nesse universo).
-- • Exclusão é ESTÁTICA e permanente (marcada na criação). Difere do mecanismo
--   dinâmico lead_excluded_from_metrics() que existe EM PROD fora do repo
--   (drift — embutido em 7 RPCs de analytics, opt-in por org via feature_flags
--   .exclude_custom_pipe_leads_from_metrics, hoje só HGE): aquele re-inclui o
--   lead se ele entrar em pipe system. Os dois convivem; reconciliação e
--   captura do drift em migration = follow-up.
-- • ROLLOUT: aplicar esta migration ANTES de deployar import-leads — o insert
--   novo referencia a coluna e PostgREST rejeita (PGRST204) se ela não existir.

-- ── 1) Coluna marcador ────────────────────────────────────────────────────────

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS excluded_from_metrics boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.leads.excluded_from_metrics IS
  'Fora das métricas de aquisição de lead (Dashboard totalLeads/funil/taxa de conversão). Setado por import-leads destination=custom_pipeline em leads criados pelo import — clientes de base, não leads novos.';

-- ── 2) RPC get_dashboard_metrics ─────────────────────────────────────────────

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

  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at, updated_at) >= p_start_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
    AND COALESCE(metrics_period_at, closed_at, updated_at) <= p_end_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
    AND (p_filter_member_id IS NULL
         OR sale_responsible_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);
  v_novos_clientes := v_funnel_vendas;

  IF v_total_leads > 0 THEN
    v_taxa_conversao := ROUND((v_funnel_vendas::numeric / v_total_leads) * 100, 2);
  END IF;

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
          AND COALESCE(prev.metrics_period_at, prev.closed_at, prev.updated_at) < p_start_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      ) AS is_returning_customer
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= p_start_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) <= p_end_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      AND (p_filter_member_id IS NULL
           OR pp.sale_responsible_id = p_filter_member_id
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
    SELECT DATE(COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at)) AS day, -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      SUM(COALESCE(pp.sale_value, 0)) AS revenue, -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      COUNT(*) AS count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) >= p_start_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      AND COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at) <= p_end_date -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
      AND (p_filter_member_id IS NULL
           OR pp.sale_responsible_id = p_filter_member_id
           OR pp.closer_id = p_filter_member_id
           OR pp.responsible_id = p_filter_member_id)
    GROUP BY DATE(COALESCE(pp.metrics_period_at, pp.closed_at, pp.updated_at)) -- metric-lint-allow: pré-existente do snapshot (ADR-0018)
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
    'taxaConversao', v_taxa_conversao,
    'dailySales', v_daily_sales,
    'funnelReunioesMarcadas', v_funnel_reunioes_marcadas,
    'funnelCompareceu', v_funnel_compareceu,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas
  );
END;
$function$;

-- ── 3) Backfill dos imports custom históricos ────────────────────────────────
-- A string é exclusiva do path importToCustomPipeline (import-leads). Marca só
-- leads CRIADOS pelo import (o path só grava lead_history pra createdLeadIds).
--
-- session_replication_role=replica: backfill de flag não é atividade de lead —
-- suprime os triggers por-linha de leads (trg_enqueue_lead_webhooks fan-out de
-- 'lead.updated' por webhook ativo da org; update_leads_updated_at bumpando
-- updated_at da base inteira). SET LOCAL: reverte sozinho no fim da transaction.

SET LOCAL session_replication_role = replica;

UPDATE public.leads l
SET excluded_from_metrics = true
WHERE l.excluded_from_metrics = false
  AND EXISTS (
    SELECT 1 FROM public.lead_history lh
    WHERE lh.lead_id = l.id
      AND lh.action = 'lead_created'
      AND lh.description = 'Sistema: Lead importado via pipeline custom'
  );

SET LOCAL session_replication_role = origin;
