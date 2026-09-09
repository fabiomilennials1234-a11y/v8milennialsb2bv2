-- ROLLBACK de 20270921000000_carteira_devolve_o_codigo_do_erp.sql
--
-- Volta `get_portfolio_clients` à projeção SEM `external_id` e à busca por
-- nome/empresa apenas — o corpo que estava vivo em prod em 2026-09-03, lido por
-- `pg_get_functiondef`.
--
-- ⚠ Reverter deixa a Carteira sem o código do ERP na etiqueta E sem achar
-- cliente por código na busca. Os gates de tenant (`assert_org_access` +
-- `assert_org_member`) são os mesmos nas duas versões — reverter não abre nada.
--
-- Gerado removendo do arquivo de ida exatamente as duas adições.

CREATE OR REPLACE FUNCTION public.get_portfolio_clients(
  p_org_id    uuid,
  p_filter    text DEFAULT 'all'::text,
  p_search    text DEFAULT ''::text,
  p_sort_by   text DEFAULT 'name'::text,
  p_sort_dir  text DEFAULT 'asc'::text,
  p_page      integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_offset       INT := (p_page - 1) * p_page_size;
  v_total        INT;
  v_rows         JSONB;
  v_allowed_sorts TEXT[] := ARRAY[
    'name', 'health_score', 'avg_ticket', 'days_since_last_order',
    'next_order_expected', 'lifetime_value', 'order_count', 'churn_probability'
  ];
  v_sort         TEXT;
  v_dir          TEXT;
  v_where        TEXT;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  PERFORM assert_org_member(p_org_id);

  IF p_sort_by = ANY(v_allowed_sorts) THEN
    v_sort := p_sort_by;
  ELSE
    v_sort := 'name';
  END IF;

  IF lower(p_sort_dir) = 'desc' THEN
    v_dir := 'DESC';
  ELSE
    v_dir := 'ASC';
  END IF;

  v_where := format('organization_id = %L AND is_active = true', p_org_id);

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    );
  END IF;

  IF p_filter = 'overdue' THEN
    v_where := v_where
      || ' AND days_since_last_order IS NOT NULL'
      || ' AND reorder_cycle_days IS NOT NULL'
      || ' AND days_since_last_order > reorder_cycle_days * 1.15';
  ELSIF p_filter = 'expected' THEN
    v_where := v_where
      || ' AND next_order_expected IS NOT NULL'
      || ' AND next_order_expected >= NOW()'
      || ' AND next_order_expected <= NOW() + INTERVAL ''7 days''';
  ELSIF p_filter IN ('ouro', 'prata', 'novo', 'resgate', 'dormindo') THEN
    v_where := v_where || format(' AND segment = %L', p_filter);
  END IF;

  EXECUTE format('SELECT COUNT(*)::int FROM upsell_clients WHERE %s', v_where)
    INTO v_total;

  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT id, name, company, phone, health_score, health_status, segment,
             avg_ticket, days_since_last_order, reorder_cycle_days,
             next_order_expected, order_count, lifetime_value, lead_id, trend,
             churn_probability
      FROM upsell_clients
      WHERE %s
      ORDER BY %I %s NULLS LAST
      LIMIT %s OFFSET %s
    ) t
    $q$,
    v_where, v_sort, v_dir, p_page_size, v_offset
  ) INTO v_rows;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total',       v_total,
    'page',        p_page,
    'page_size',   p_page_size,
    'total_pages', GREATEST(CEIL(v_total::numeric / p_page_size)::int, 1)
  );
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'access_denied' THEN
      RETURN jsonb_build_object(
        'rows', '[]'::jsonb, 'total', 0,
        'page', p_page, 'page_size', p_page_size, 'total_pages', 1
      );
    END IF;
    RAISE;
END;
$function$;
