-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260713213859  name: get_custom_pipeline_stage_counts
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

CREATE OR REPLACE FUNCTION public.get_custom_pipeline_stage_counts(
  p_pipeline_id UUID,
  p_org_id UUID,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  stage_id UUID,
  cnt BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cpe.stage_id,
    COUNT(*)::BIGINT AS cnt
  FROM public.custom_pipe_entries cpe
  LEFT JOIN public.leads l ON l.id = cpe.lead_id
  WHERE cpe.pipeline_id = p_pipeline_id
    AND cpe.organization_id = p_org_id
    AND (p_search IS NULL OR p_search = '' OR (
      l.name ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
  GROUP BY cpe.stage_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_custom_pipeline_stage_counts(UUID, UUID, TEXT) TO authenticated;
