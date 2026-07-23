CREATE OR REPLACE FUNCTION public.get_segment_benchmark(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_segment TEXT; v_org_count BIGINT; result JSONB;
  v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  v_start := DATE_TRUNC('month', NOW());
  v_end := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 second');
  SELECT l.segment INTO v_segment FROM leads l WHERE l.organization_id = p_org_id AND l.segment IS NOT NULL AND l.segment != '' GROUP BY l.segment ORDER BY COUNT(*) DESC LIMIT 1;
  IF v_segment IS NULL THEN RETURN jsonb_build_object('available', false, 'reason', 'no_segment_data'); END IF;
  SELECT COUNT(DISTINCT o.id) INTO v_org_count FROM organizations o JOIN leads l ON l.organization_id = o.id WHERE l.segment = v_segment AND o.id != p_org_id;
  IF v_org_count < 2 THEN RETURN jsonb_build_object('available', false, 'reason', 'insufficient_peers', 'segment', v_segment); END IF;
  WITH peer_orgs AS (
    SELECT DISTINCT o.id AS org_id FROM organizations o JOIN leads l ON l.organization_id = o.id WHERE l.segment = v_segment AND o.id != p_org_id
  ), peer_metrics AS (
    SELECT po.org_id,
      (SELECT COUNT(*) FROM leads l WHERE l.organization_id = po.org_id AND COALESCE(l.metrics_period_at, l.created_at) >= v_start AND COALESCE(l.metrics_period_at, l.created_at) <= v_end) AS leads,
      (SELECT COUNT(*) FROM pipe_propostas pp WHERE pp.organization_id = po.org_id AND pp.status = 'vendido' AND COALESCE(pp.metrics_period_at, pp.closed_at) >= v_start AND COALESCE(pp.metrics_period_at, pp.closed_at) <= v_end) AS vendas,
      (SELECT COALESCE(SUM(pp.sale_value), 0) FROM pipe_propostas pp WHERE pp.organization_id = po.org_id AND pp.status = 'vendido' AND COALESCE(pp.metrics_period_at, pp.closed_at) >= v_start AND COALESCE(pp.metrics_period_at, pp.closed_at) <= v_end) AS revenue,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.organization_id = po.org_id AND tm.is_active = true) AS team_size
    FROM peer_orgs po
  )
  SELECT jsonb_build_object('available', true, 'segment', v_segment, 'peerCount', v_org_count,
    'avgTicketMedio', CASE WHEN SUM(vendas) > 0 THEN ROUND(SUM(revenue) / SUM(vendas), 2) ELSE 0 END,
    'avgLeadsPerSeller', CASE WHEN SUM(team_size) > 0 THEN ROUND(SUM(leads)::NUMERIC / SUM(team_size), 1) ELSE 0 END,
    'avgConversionRate', CASE WHEN SUM(leads) > 0 THEN ROUND((SUM(vendas)::NUMERIC / SUM(leads)) * 100, 1) ELSE 0 END
  ) INTO result FROM peer_metrics;
  RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_segment_benchmark(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_segment_benchmark(UUID) TO service_role;
