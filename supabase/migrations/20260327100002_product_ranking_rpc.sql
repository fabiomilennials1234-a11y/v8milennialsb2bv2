CREATE OR REPLACE FUNCTION public.get_product_ranking(
  p_org_id UUID, p_start_date TIMESTAMPTZ, p_end_date TIMESTAMPTZ
) RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(ranked) ORDER BY ranked.total_value DESC), '[]'::jsonb)
  INTO result
  FROM (
    SELECT p.id AS product_id, p.name AS product_name, p.type AS product_type,
      COUNT(DISTINCT ppi.pipe_proposta_id) AS qty_sold,
      SUM(COALESCE(ppi.sale_value, 0)) AS total_value,
      CASE WHEN COUNT(DISTINCT ppi.pipe_proposta_id) > 0
        THEN ROUND(SUM(COALESCE(ppi.sale_value, 0)) / COUNT(DISTINCT ppi.pipe_proposta_id), 2) ELSE 0 END AS ticket_medio
    FROM pipe_proposta_items ppi
    JOIN pipe_propostas pp ON pp.id = ppi.pipe_proposta_id
    JOIN products p ON p.id = ppi.product_id
    WHERE pp.organization_id = p_org_id AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
    GROUP BY p.id, p.name, p.type ORDER BY total_value DESC LIMIT 10
  ) ranked;
  RETURN result;
END; $$;

GRANT EXECUTE ON FUNCTION public.get_product_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
