-- snapshot (ADR-0018): corpo VIVO de prod (jsjsmuncfkbsbzqzqhfq), capturado 2026-07-07
-- via pg_get_functiondef. Baseline verificada do SP-0.5 (#987) — NÃO é mudança.

CREATE OR REPLACE FUNCTION public.get_sales_cycle_analysis(p_pipeline_type text DEFAULT NULL::text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_org_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(from_stage text, to_stage text, avg_hours numeric, median_hours numeric, transition_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_org_id uuid;
BEGIN
  v_org_id := resolve_org_for_rpc(p_org_id);
  IF v_org_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH ev AS (
    SELECT lh.lead_id, lh.created_at,
      COALESCE(NULLIF(lh.metadata->>'to_stage',''), substring(lh.description from 'para "([^"]+)"')) AS to_s,
      COALESCE(NULLIF(lh.metadata->>'pipeline',''), substring(lh.description from '(?:no|na) ((?:Funil|Pipe) .+)$')) AS pipe_label
    FROM lead_history lh
    WHERE lh.organization_id = v_org_id
      AND lh.action IN ('stage_changed','proposal_status_changed')
      AND (p_start_date IS NULL OR lh.created_at >= p_start_date)
      AND (p_end_date IS NULL OR lh.created_at <= p_end_date)
  ),
  seq AS (
    SELECT e.to_s, e.pipe_label,
      LAG(e.to_s) OVER (PARTITION BY e.lead_id ORDER BY e.created_at) AS from_s,
      EXTRACT(EPOCH FROM (e.created_at - LAG(e.created_at) OVER (PARTITION BY e.lead_id ORDER BY e.created_at)))/3600.0 AS hours_diff
    FROM ev e WHERE e.to_s IS NOT NULL
  )
  SELECT s.from_s, s.to_s, ROUND(AVG(s.hours_diff)::numeric,1),
    ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.hours_diff))::numeric,1), COUNT(*)
  FROM seq s
  WHERE s.from_s IS NOT NULL AND s.from_s <> s.to_s AND s.hours_diff IS NOT NULL AND s.hours_diff > 0
    AND (p_pipeline_type IS NULL
      OR s.pipe_label ILIKE '%'||p_pipeline_type||'%'
      OR (p_pipeline_type='whatsapp' AND s.pipe_label ILIKE '%WhatsApp%')
      OR (p_pipeline_type='confirmacao' AND s.pipe_label ILIKE '%Confirma%')
      OR (p_pipeline_type='propostas' AND s.pipe_label ILIKE '%Proposta%'))
  GROUP BY s.from_s, s.to_s ORDER BY COUNT(*) DESC LIMIT 12;
END; $function$;
