-- get_custom_pipeline_stage_counts: LEFT JOIN → JOIN
--
-- O badge da coluna do funil personalizado contava entries cujo lead a RLS de
-- `leads` nega ao usuário. Como a função é SECURITY INVOKER, o `LEFT JOIN`
-- preservava a linha com `l.*` NULL e o COUNT(*) somava assim mesmo — o badge
-- dizia 673 enquanto a tela desenhava 98 cards (medido no PROD, funil
-- "Prospecção" da HGE Iluminação, usuário José Paiva).
--
-- Os dois funis do sistema nunca tiveram esse defeito porque
-- `get_pipeline_page` e `get_pipeline_stage_counts` usam INNER JOIN: a linha
-- que a RLS esvazia some inteira, e badge e cards concordam. Esta migration
-- alinha o funil custom com esse comportamento — uma palavra.
--
-- Efeito por perfil (nada muda para quem já via tudo):
--   • admin / master / membro com leads.view_all → contagem idêntica à de hoje
--   • membro restrito → passa a contar só o que ele enxerga
--
-- Também deixa de contar entry cujo lead foi soft-deleted (`deleted_at`), que
-- hoje entra na conta até para admin porque a policy de leads começa por
-- `deleted_at IS NULL`.
--
-- Assinatura preservada (mesmos 3 args, mesmo RETURNS TABLE) — CREATE OR
-- REPLACE substitui no lugar, sem criar overload (ver 42725).
--
-- Front que consome: src/modules/pipelines/hooks/custom/useCustomPipelines.ts
-- (useCustomPipeStageCounts) → CustomPipelineKanban.tsx (totalCount da coluna).

CREATE OR REPLACE FUNCTION public.get_custom_pipeline_stage_counts(
  p_pipeline_id uuid,
  p_org_id uuid,
  p_search text DEFAULT NULL::text
)
RETURNS TABLE(stage_id uuid, cnt bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    cpe.stage_id,
    COUNT(*)::BIGINT AS cnt
  FROM public.custom_pipe_entries cpe
  -- INNER: entry cujo lead a RLS nega não é contada, espelhando
  -- get_pipeline_stage_counts. Era LEFT JOIN.
  JOIN public.leads l ON l.id = cpe.lead_id
  WHERE cpe.pipeline_id = p_pipeline_id
    AND cpe.organization_id = p_org_id
    AND (p_search IS NULL OR p_search = '' OR (
      l.name ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
  GROUP BY cpe.stage_id;
END;
$function$;
