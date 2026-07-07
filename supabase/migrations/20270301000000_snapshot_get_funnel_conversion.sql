-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.
-- Alterações só em migrations novas por cima desta. Anti-padrões existentes aqui
-- estão no backlog congelado do metric-lint (scripts/metric-antipatterns-baseline.txt).

CREATE OR REPLACE FUNCTION public.get_funnel_conversion(p_pipeline_type text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(stage_id uuid, stage_name text, stage_order integer, total_entered bigint, total_current bigint, conversion_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN QUERY
  WITH org_check AS (
    SELECT tm.organization_id FROM team_members tm WHERE tm.user_id = auth.uid() LIMIT 1
  ),
  stage_counts AS (
    SELECT
      ps.id AS sid,
      ps.name AS sname,
      ps.order_index,
      COUNT(DISTINCT lh.lead_id) FILTER (
        WHERE lh.action = 'stage_changed'
        AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
        AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
      ) AS entered
    FROM pipeline_stages ps
    CROSS JOIN org_check oc
    LEFT JOIN lead_history lh ON lh.metadata->>'to_stage_id' = ps.id::text
      AND lh.organization_id = oc.organization_id
    WHERE ps.pipeline_type = p_pipeline_type
      AND ps.organization_id = oc.organization_id
    GROUP BY ps.id, ps.name, ps.order_index
  )
  SELECT
    sc.sid,
    sc.sname,
    sc.order_index,
    sc.entered,
    sc.entered,
    CASE
      WHEN LAG(sc.entered) OVER (ORDER BY sc.order_index) > 0
      THEN ROUND(sc.entered::numeric / LAG(sc.entered) OVER (ORDER BY sc.order_index) * 100, 1)
      ELSE 100.0
    END AS conv_rate
  FROM stage_counts sc
  ORDER BY sc.order_index;
END;
$function$;
