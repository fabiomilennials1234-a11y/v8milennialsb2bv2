-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708133345  name: metrics_get_commission_ledger
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000071 (#997, ADR-0017 §6,§8)
CREATE OR REPLACE FUNCTION public.get_commission_ledger(
  p_org_id uuid, p_period text, p_ref date DEFAULT NULL, p_start date DEFAULT NULL, p_end date DEFAULT NULL, p_filter_member_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bounds tstzrange; v_comm_total numeric; v_base_total numeric; v_cnt_total integer; v_by_member jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  v_bounds := public.metric_period_bounds(p_org_id, p_period, p_ref, p_start, p_end);

  WITH ledger AS (
    SELECT c.team_member_id AS member_id, c.type AS ptype, c.amount AS amount, c.rate_percent AS rate_percent, se.sale_value AS base_value
    FROM public.commissions c
    JOIN public.sale_events se ON se.id = c.sale_event_id
    WHERE c.source = 'sale_event_projection' AND c.organization_id = p_org_id
      AND se.event_type = 'sale' AND se.sold_at <@ v_bounds
      AND (p_filter_member_id IS NULL OR c.team_member_id = p_filter_member_id)
      AND NOT EXISTS (SELECT 1 FROM public.sale_events r WHERE r.event_type = 'sale_reversed' AND r.reversed_event_id = se.id)
  ),
  member_agg AS (
    SELECT l.member_id,
      COALESCE(SUM(l.amount), 0) AS commission, COALESCE(SUM(l.base_value), 0) AS base_revenue, COUNT(*)::int AS sale_count,
      COALESCE(SUM(l.amount) FILTER (WHERE l.ptype = 'mrr'), 0) AS mrr_commission,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.ptype = 'mrr'), 0) AS mrr_base,
      COUNT(*) FILTER (WHERE l.ptype = 'mrr')::int AS mrr_count,
      CASE WHEN COUNT(DISTINCT l.rate_percent) FILTER (WHERE l.ptype = 'mrr') = 1 THEN min(l.rate_percent) FILTER (WHERE l.ptype = 'mrr') END AS mrr_rate,
      COALESCE(SUM(l.amount) FILTER (WHERE l.ptype = 'projeto'), 0) AS proj_commission,
      COALESCE(SUM(l.base_value) FILTER (WHERE l.ptype = 'projeto'), 0) AS proj_base,
      COUNT(*) FILTER (WHERE l.ptype = 'projeto')::int AS proj_count,
      CASE WHEN COUNT(DISTINCT l.rate_percent) FILTER (WHERE l.ptype = 'projeto') = 1 THEN min(l.rate_percent) FILTER (WHERE l.ptype = 'projeto') END AS proj_rate
    FROM ledger l GROUP BY l.member_id
  )
  SELECT
    COALESCE(SUM(m.commission), 0), COALESCE(SUM(m.base_revenue), 0), COALESCE(SUM(m.sale_count), 0)::int,
    COALESCE(jsonb_agg(jsonb_build_object(
      'member_id', m.member_id, 'commission', m.commission, 'base_revenue', m.base_revenue, 'sale_count', m.sale_count,
      'by_type', jsonb_build_object(
        'mrr', jsonb_build_object('commission', m.mrr_commission, 'base_revenue', m.mrr_base, 'sale_count', m.mrr_count, 'rate_percent', m.mrr_rate),
        'projeto', jsonb_build_object('commission', m.proj_commission, 'base_revenue', m.proj_base, 'sale_count', m.proj_count, 'rate_percent', m.proj_rate)
      )) ORDER BY m.commission DESC, m.base_revenue DESC), '[]'::jsonb)
  INTO v_comm_total, v_base_total, v_cnt_total, v_by_member
  FROM member_agg m;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('name', p_period, 'start', lower(v_bounds), 'end', upper(v_bounds)),
    'filter_member_id', p_filter_member_id, 'commission_total', v_comm_total, 'base_revenue_total', v_base_total,
    'sale_count_total', v_cnt_total, 'by_member', v_by_member
  );
END;
$$;
COMMENT ON FUNCTION public.get_commission_ledger(uuid, text, date, date, date, uuid) IS 'ADR-0017 §6,§8 / #997 — comissão como leitura da PROJEÇÃO de sale_events. Projeção DEFERIDA em prod até deploy frontend SP-3.';
REVOKE ALL ON FUNCTION public.get_commission_ledger(uuid, text, date, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_commission_ledger(uuid, text, date, date, date, uuid) TO authenticated, service_role;
