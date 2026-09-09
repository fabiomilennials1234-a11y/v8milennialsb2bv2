-- ROLLBACK de 20270908010000_metricas_de_produto_leem_deal_items.sql
--
-- Volta `get_product_ranking` e `_metric_leaf_curva_abc` a lerem SÓ
-- `pipe_proposta_items`. As definições abaixo são cópia verbatim do que estava
-- vivo em prod em 2026-09-02, lida por `pg_get_functiondef`.
--
-- ⚠ Reverter reabre o defeito: item lançado pelo painel do Negócio (que grava
-- em `deal_items`) some do Ranking e da Curva ABC.

CREATE OR REPLACE FUNCTION public.get_product_ranking(
  p_org_id uuid,
  p_start_date timestamp with time zone,
  p_end_date timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
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
END; $function$;

CREATE OR REPLACE FUNCTION public._metric_leaf_curva_abc(
  p_org_id uuid,
  p_recorte text,
  p_bounds tstzrange,
  p_tz text,
  p_filters jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_series jsonb;
  v_base bigint;
BEGIN
  IF p_recorte <> 'produto' THEN
    RAISE EXCEPTION 'recorte % incompatible with measure curva_abc', p_recorte
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_base
  FROM public.pipe_proposta_items ppi
  JOIN public.pipeline_entries pe ON pe.id = ppi.pipe_proposta_id
  WHERE pe.organization_id = p_org_id
    AND pe.stage_key = 'vendido'
    AND COALESCE(pe.closed_at, pe.entered_at) <@ p_bounds;

  WITH por_produto AS (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(COALESCE(ppi.sale_value, 0)) AS receita
    FROM public.pipe_proposta_items ppi
    JOIN public.pipeline_entries pe ON pe.id = ppi.pipe_proposta_id
    JOIN public.products p ON p.id = ppi.product_id
    WHERE pe.organization_id = p_org_id
      AND pe.stage_key = 'vendido'
      AND COALESCE(pe.closed_at, pe.entered_at) <@ p_bounds
      AND ((p_filters->>'product_id') IS NULL OR p.id = (p_filters->>'product_id')::uuid)
    GROUP BY p.id, p.name
    HAVING SUM(COALESCE(ppi.sale_value, 0)) > 0
  ),
  acumulado AS (
    SELECT
      product_id, product_name, receita,
      -- Acumulado APÓS incluir este produto. É o que faz o produto que cruza a
      -- fronteira pertencer à classe de cima.
      SUM(receita) OVER (ORDER BY receita DESC, product_name)
        / NULLIF(SUM(receita) OVER (), 0) AS fracao
    FROM por_produto
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', a.product_id,
           'label', a.classe || ' · ' || a.product_name,
           'value', a.receita
         ) ORDER BY a.receita DESC), '[]'::jsonb)
  INTO v_series
  FROM (
    SELECT
      product_id, product_name, receita,
      CASE
        WHEN fracao <= 0.80 THEN 'A'
        WHEN fracao <= 0.95 THEN 'B'
        ELSE 'C'
      END AS classe
    FROM acumulado
  ) a;

  RETURN jsonb_build_object('value', NULL, 'series', v_series,
    'empty_reason', CASE WHEN v_base = 0 THEN 'no_rows' ELSE NULL END);
END;
$function$;
