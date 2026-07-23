-- Forward-fix (schema drift): get_funnel_conversion referenciava
-- pipeline_stages.order_index, coluna que não existe mais em prod
-- (renomeada para `position`). Todo cálculo de funil de conversão erra com
-- `column ps.order_index does not exist`, poluindo os logs Postgres.
--
-- Corpo idêntico ao snapshot ADR-0018 (20270301000000), trocando
-- ps.order_index -> ps.position em TODOS os pontos (SELECT/GROUP BY/LAG/ORDER BY).
-- O alias de retorno `stage_order` (RETURNS TABLE) é preservado.
-- Assinatura, SECURITY DEFINER, search_path e a checagem de org via team_members
-- ficam intactos. NÃO é mudança de comportamento — só corrige a coluna.

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
      ps.position,
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
    GROUP BY ps.id, ps.name, ps.position
  )
  SELECT
    sc.sid,
    sc.sname,
    sc.position,
    sc.entered,
    sc.entered,
    CASE
      WHEN LAG(sc.entered) OVER (ORDER BY sc.position) > 0
      THEN ROUND(sc.entered::numeric / LAG(sc.entered) OVER (ORDER BY sc.position) * 100, 1)
      ELSE 100.0
    END AS conv_rate
  FROM stage_counts sc
  ORDER BY sc.position;
END;
$function$;
