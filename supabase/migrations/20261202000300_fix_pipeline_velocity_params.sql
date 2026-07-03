-- SP-0 fix #12: get_pipeline_velocity — (a) p_pipeline_type agora filtra o pipe de verdade
--   via COALESCE(p_pipeline_type,'propostas') nas duas CTEs (antes ignorava o parametro e
--   fixava 'propostas' sempre); (b) win_rate: numerador (won_deals) e denominador (all_deals)
--   passam a compartilhar a MESMA janela [start,end] — adicionado o filtro de p_end_date em
--   all_deals, que antes so filtrava por start e cruzava janelas; (c) ticket: sale_value e
--   NUMERIC(12,2) em reais (ver 20260500000000_upsell_module.sql: NUMERIC(12,2)), NAO centavos —
--   a def viva NAO divide por 100, e mantemos assim (nenhuma divisao por 100 adicionada/removida;
--   nao ha garantia de centavos, entao nao assumimos). Corpo extraido verbatim da def viva em
--   supabase/migrations/20260982000000_drop_legacy_pipe_tables.sql:1116-1165.
--   Ver docs/superpowers/specs/2026-07-02-metrics-foundation-design.md

CREATE OR REPLACE FUNCTION public.get_pipeline_velocity(
  p_pipeline_type text,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_result jsonb;
BEGIN
  SELECT tm.organization_id INTO v_org_id
  FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1;

  IF v_org_id IS NULL THEN RETURN '{}'::jsonb; END IF;

  -- Velocity = (num_deals * win_rate * avg_value) / avg_cycle_days
  WITH won_deals AS (
    SELECT
      COUNT(*) AS num_won,
      COALESCE(AVG((pe.metadata->>'sale_value')::numeric), 0) AS avg_value
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = COALESCE(p_pipeline_type, 'propostas') AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key = 'vendido'
      AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
      AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  ),
  all_deals AS (
    SELECT COUNT(*) AS total
    FROM pipeline_entries pe
    JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = COALESCE(p_pipeline_type, 'propostas') AND pip.type = 'system'
    WHERE pe.organization_id = v_org_id
      AND pe.stage_key IN ('vendido', 'perdido')
      AND (p_start_date IS NULL OR pe.created_at >= p_start_date)
      AND (p_end_date IS NULL OR pe.created_at <= p_end_date)
  )
  SELECT jsonb_build_object(
    'num_won', COALESCE(w.num_won, 0),
    'total_closed', COALESCE(a.total, 0),
    'win_rate', CASE WHEN a.total > 0 THEN ROUND(w.num_won::numeric / a.total * 100, 1) ELSE 0 END,
    'avg_deal_value', ROUND(w.avg_value::numeric, 2)
  ) INTO v_result
  FROM won_deals w, all_deals a;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;
