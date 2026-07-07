-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.
-- Nota: âncora created_at + stage_key hardcoded permanecem (findings da auditoria);
-- correção vem no SP-3 sobre os cadernos.

CREATE OR REPLACE FUNCTION public.get_pipeline_velocity(p_pipeline_type text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;
