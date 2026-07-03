CREATE OR REPLACE FUNCTION public.get_leads_not_confirmed(p_organization_id uuid, p_hours_before_meeting integer, p_minutes_before_meeting integer, p_filter_stages text[] DEFAULT NULL::text[])
 RETURNS TABLE(lead_id uuid, meeting_date timestamp with time zone, confirmacao_id uuid, current_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    pe.lead_id,
    (pe.metadata->>'meeting_date')::timestamptz AS meeting_date,
    pe.id AS confirmacao_id,
    pe.stage_key AS current_status
  FROM pipeline_entries pe
  JOIN pipelines pip ON pip.id = pe.pipeline_id AND pip.slug = 'confirmacao' AND pip.type = 'system'
  INNER JOIN leads l ON l.id = pe.lead_id AND l.organization_id = p_organization_id
  WHERE (pe.metadata->>'meeting_date')::timestamptz IS NOT NULL
    -- Reuniao esta no futuro mas dentro da janela de alerta
    AND (pe.metadata->>'meeting_date')::timestamptz > NOW()
    AND (pe.metadata->>'meeting_date')::timestamptz <= NOW() + (
      (p_hours_before_meeting || ' hours')::interval +
      (p_minutes_before_meeting || ' minutes')::interval
    )
    -- Status indica que NAO confirmou ainda
    AND pe.stage_key NOT IN ('confirmada_no_dia', 'compareceu', 'perdido')
    -- Filtro opcional por etapas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL
         OR pe.stage_key = ANY(p_filter_stages));
$function$
