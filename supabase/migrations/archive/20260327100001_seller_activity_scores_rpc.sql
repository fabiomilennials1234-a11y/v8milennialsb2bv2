CREATE OR REPLACE FUNCTION public.get_seller_activity_scores(
  p_org_id UUID, p_start_date TIMESTAMPTZ, p_end_date TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  WITH seller_metrics AS (
    SELECT tm.id, tm.name, tm.role, (tm.metric_type)::TEXT AS metric_type,
      (SELECT COUNT(*) FROM leads l WHERE l.organization_id = p_org_id AND (l.sdr_id = tm.id OR l.closer_id = tm.id) AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date) AS leads_movimentados,
      (SELECT COUNT(*) FROM follow_ups fu WHERE fu.organization_id = p_org_id AND fu.assigned_to = tm.id AND fu.completed_at IS NOT NULL AND fu.completed_at >= p_start_date AND fu.completed_at <= p_end_date) AS followups_completos,
      (SELECT COUNT(*) FROM pipe_confirmacao pc WHERE pc.organization_id = p_org_id AND (pc.sdr_id = tm.id OR pc.closer_id = tm.id) AND pc.status = 'compareceu' AND COALESCE(pc.metrics_period_at, pc.created_at) >= p_start_date AND COALESCE(pc.metrics_period_at, pc.created_at) <= p_end_date) AS reunioes_realizadas,
      (SELECT COUNT(*) FROM pipe_propostas pp WHERE pp.organization_id = p_org_id AND pp.closer_id = tm.id AND COALESCE(pp.metrics_period_at, pp.created_at) >= p_start_date AND COALESCE(pp.metrics_period_at, pp.created_at) <= p_end_date) AS propostas_enviadas,
      (SELECT COUNT(*) FROM pipe_propostas pp WHERE pp.organization_id = p_org_id AND pp.closer_id = tm.id AND pp.status = 'vendido' AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date) AS vendas_fechadas
    FROM team_members tm WHERE tm.organization_id = p_org_id AND tm.is_active = true
  ), scored AS (
    SELECT sm.*, (sm.leads_movimentados * 10 + sm.followups_completos * 15 + sm.reunioes_realizadas * 20 + sm.propostas_enviadas * 25 + sm.vendas_fechadas * 30) AS score_bruto
    FROM seller_metrics sm
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'role', s.role, 'metricType', s.metric_type,
    'leads', s.leads_movimentados, 'followups', s.followups_completos,
    'reunioes', s.reunioes_realizadas, 'propostas', s.propostas_enviadas,
    'vendas', s.vendas_fechadas, 'scoreBruto', s.score_bruto,
    'scoreNormalizado', CASE WHEN (SELECT MAX(score_bruto) FROM scored) > 0
      THEN ROUND((s.score_bruto::NUMERIC / (SELECT MAX(score_bruto) FROM scored)) * 100) ELSE 0 END
  ) ORDER BY s.score_bruto DESC) INTO result FROM scored s;
  RETURN COALESCE(result, '[]'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_seller_activity_scores(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_activity_scores(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
