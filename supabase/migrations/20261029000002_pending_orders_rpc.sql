-- =============================================================================
-- RPC: get_pending_orders — paginated pending approval queue with org guard
-- =============================================================================

CREATE OR REPLACE FUNCTION get_pending_orders(
  p_org_id    UUID,
  p_page      INT DEFAULT 1,
  p_page_size INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset     INT := (p_page - 1) * p_page_size;
  v_total      INT;
  v_total_value NUMERIC;
  v_rows       JSONB;
BEGIN
  PERFORM assert_org_member(p_org_id);

  -- Count + total value of ALL pending (not just this page)
  SELECT COUNT(*)::int, COALESCE(SUM(sale_value), 0)::numeric
    INTO v_total, v_total_value
    FROM upsell_orders
    WHERE organization_id = p_org_id
      AND approval_status = 'pending';

  -- Paginated rows with client info
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      o.id,
      o.client_id,
      c.name AS client_name,
      c.company AS client_company,
      o.product_name,
      o.sale_value,
      o.source,
      o.sold_at,
      o.created_at,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'id', pi.id,
          'product_name', pi.product_name,
          'quantity', pi.quantity,
          'unit_price', pi.unit_price,
          'unit', pi.unit
        ))
        FROM client_purchase_items pi WHERE pi.order_id = o.id),
        '[]'::jsonb
      ) AS items
    FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.organization_id = p_org_id
      AND o.approval_status = 'pending'
    ORDER BY o.created_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total',       v_total,
    'total_value', v_total_value,
    'page',        p_page,
    'page_size',   p_page_size,
    'total_pages', GREATEST(CEIL(v_total::numeric / p_page_size)::int, 1)
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN
      RETURN jsonb_build_object(
        'rows', '[]'::jsonb, 'total', 0, 'total_value', 0,
        'page', p_page, 'page_size', p_page_size, 'total_pages', 1
      );
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pending_orders(UUID, INT, INT) TO authenticated, service_role;
