-- 20270919000000_carteira_devolve_o_codigo_do_erp.sql
--
-- A tela da Carteira passa a mostrar "1234 - João da Silva": o código do cliente
-- no ERP na frente do nome. O código já existia em `upsell_clients.external_id`
-- (12.664 de 12.665 clientes da Café Jurerê), mas `get_portfolio_clients`
-- devolvia uma lista fixa de colunas que não o incluía — então o frontend não
-- tinha como exibi-lo.
--
-- Duas mudanças, ambas aditivas:
--   1. `external_id` entra na projeção;
--   2. a busca passa a casar o código, não só nome e empresa.
--
-- (2) é o ponto que justifica mexer no banco em vez de resolver só no frontend:
-- de nada adianta o vendedor VER o código na lista se digitar "1234" na busca
-- não acha o cliente. A busca é server-side e paginada; filtrar no cliente
-- acharia apenas dentro das 50 linhas da página corrente.
--
-- 🔴 O `name` gravado continua limpo. A composição "código - nome" é da camada de
-- apresentação (`src/shared/format/erp-code.ts`), justamente para que `{{nome}}`
-- do disparo e a saudação do Copilot não passem a dizer "Olá 1234 - João".
--
-- Nada mais do corpo muda: `assert_org_access` + `assert_org_member`, o
-- allowlist de ordenação, os filtros de segmento/atraso e o ramo `access_denied`
-- seguem idênticos ao que está em prod hoje.

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

  -- Busca casa nome, empresa E código do ERP. `external_id` é TEXT e pode ser
  -- NULL (cliente sem ERP); `NULL ILIKE '%x%'` é NULL, que o OR descarta — a
  -- coluna nova não estreita o resultado de ninguém.
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L OR external_id ILIKE %L)',
      '%' || p_search || '%',
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
             churn_probability, external_id
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
