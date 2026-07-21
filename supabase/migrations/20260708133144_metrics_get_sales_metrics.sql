-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708133144  name: metrics_get_sales_metrics
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000050 (#995, ADR-0017 §2-5,§8)
CREATE OR REPLACE FUNCTION public.get_sales_metrics(
  p_org_id uuid, p_period text, p_ref date DEFAULT NULL, p_start date DEFAULT NULL,
  p_end date DEFAULT NULL, p_pipeline_id uuid DEFAULT NULL, p_filter_member_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bounds tstzrange;
  v_rev_total numeric; v_rev_novo numeric; v_rev_carteira numeric;
  v_cnt_won integer; v_cnt_novo integer; v_cnt_carteira integer; v_cnt_lost integer;
  v_by_closer jsonb; v_unattr_rev numeric; v_unattr_cnt integer;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  SELECT
    COALESCE(SUM(w.sale_value), 0),
    COALESCE(SUM(w.sale_value) FILTER (WHERE w.revenue_stream = 'novo_negocio'), 0),
    COALESCE(SUM(w.sale_value) FILTER (WHERE w.revenue_stream = 'carteira'), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE w.revenue_stream = 'novo_negocio'),
    COUNT(*) FILTER (WHERE w.revenue_stream = 'carteira')
  INTO v_rev_total, v_rev_novo, v_rev_carteira, v_cnt_won, v_cnt_novo, v_cnt_carteira
  FROM public.sale_events w
  WHERE w.organization_id = p_org_id AND w.event_type = 'sale' AND w.sold_at <@ v_bounds
    AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
    AND (p_filter_member_id IS NULL OR w.sale_responsible_id = p_filter_member_id)
    AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id);

  SELECT COUNT(*) INTO v_cnt_lost
  FROM public.sale_events se
  WHERE se.organization_id = p_org_id AND se.event_type = 'sale_lost' AND se.sold_at <@ v_bounds
    AND (p_pipeline_id IS NULL OR se.pipeline_id = p_pipeline_id)
    AND (p_filter_member_id IS NULL OR se.sale_responsible_id = p_filter_member_id);

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('member_id', g.sale_responsible_id, 'revenue', g.revenue, 'sale_count', g.sale_count)
      ORDER BY g.revenue DESC, g.sale_count DESC) FILTER (WHERE g.sale_responsible_id IS NOT NULL), '[]'::jsonb),
    COALESCE(SUM(g.revenue) FILTER (WHERE g.sale_responsible_id IS NULL), 0),
    COALESCE(SUM(g.sale_count) FILTER (WHERE g.sale_responsible_id IS NULL), 0)::int
  INTO v_by_closer, v_unattr_rev, v_unattr_cnt
  FROM (
    SELECT w.sale_responsible_id, COALESCE(SUM(w.sale_value), 0) AS revenue, COUNT(*)::int AS sale_count
    FROM public.sale_events w
    WHERE w.organization_id = p_org_id AND w.event_type = 'sale' AND w.sold_at <@ v_bounds
      AND (p_pipeline_id IS NULL OR w.pipeline_id = p_pipeline_id)
      AND (p_filter_member_id IS NULL OR w.sale_responsible_id = p_filter_member_id)
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = w.id)
    GROUP BY w.sale_responsible_id
  ) g;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'pipeline_id', p_pipeline_id, 'filter_member_id', p_filter_member_id,
    'revenue_total', v_rev_total,
    'revenue_by_stream', jsonb_build_object(
      'novo_negocio', jsonb_build_object('revenue', v_rev_novo, 'sale_count', v_cnt_novo),
      'carteira', jsonb_build_object('revenue', v_rev_carteira, 'sale_count', v_cnt_carteira)),
    'won_count', v_cnt_won, 'lost_count', v_cnt_lost,
    'ticket_medio', CASE WHEN v_cnt_won > 0 THEN round(v_rev_total / v_cnt_won, 2) ELSE NULL END,
    'by_closer', v_by_closer,
    'unattributed', jsonb_build_object('revenue', v_unattr_rev, 'sale_count', v_unattr_cnt)
  );
END;
$$;
COMMENT ON FUNCTION public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid) IS 'ADR-0017 §2-5,§8 / #995 — leitor canônico de venda (SP-3). Lê SÓ sale_events, líquido de estorno.';
REVOKE ALL ON FUNCTION public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_metrics(uuid, text, date, date, date, uuid, uuid) TO authenticated, service_role;
