-- SP-0 fix #7: get_leads_not_confirmed exclui pela stage_key morta 'confirmada_no_dia' (no-op); troca por metadata->>'is_confirmed'='true'. Ver docs/superpowers/specs/2026-07-02-metrics-foundation-design.md

CREATE OR REPLACE FUNCTION public.get_leads_not_confirmed(
  p_organization_id UUID,
  p_hours_before_meeting INTEGER,
  p_minutes_before_meeting INTEGER,
  p_filter_stages TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  meeting_date TIMESTAMPTZ,
  confirmacao_id UUID,
  current_status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- Status indica que NAO confirmou ainda (compareceu/perdido sao terminais vivos)
    AND pe.stage_key NOT IN ('compareceu', 'perdido')
    -- Sinal real de confirmacao e metadata.is_confirmed (setado em _shared/actions/schedule-meeting.ts);
    -- a antiga exclusao por stage_key 'confirmada_no_dia' era no-op (key morta migrada p/ 'confirmacao_no_dia')
    AND (pe.metadata->>'is_confirmed') IS DISTINCT FROM 'true'
    -- Filtro opcional por etapas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL
         OR pe.stage_key = ANY(p_filter_stages));
$$;
