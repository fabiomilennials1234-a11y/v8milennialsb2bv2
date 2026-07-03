-- ROLLBACK SP-0 fix #7: restaura get_leads_not_confirmed verbatim (bloco original de 20260982000000_drop_legacy_pipe_tables.sql ~linha 1073). Ver docs/superpowers/specs/2026-07-02-metrics-foundation-design.md

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
    -- Status indica que NAO confirmou ainda
    AND pe.stage_key NOT IN ('confirmada_no_dia', 'compareceu', 'perdido')
    -- Filtro opcional por etapas
    AND (p_filter_stages IS NULL OR array_length(p_filter_stages, 1) IS NULL
         OR pe.stage_key = ANY(p_filter_stages));
$$;
