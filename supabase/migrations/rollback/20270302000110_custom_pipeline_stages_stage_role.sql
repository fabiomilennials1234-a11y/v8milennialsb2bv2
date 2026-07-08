-- ROLLBACK de 20270302000110_custom_pipeline_stages_stage_role.sql (U1)
--
-- Ordem inversa da criação. Restaura metric_stage_role ao corpo SYSTEM-ONLY
-- do 20270302000030 (senão o resolvedor ficaria referenciando a coluna custom
-- recém-dropada). ATENÇÃO: após este rollback, venda em pipeline CUSTOM volta
-- a resolver NULL (≙ open) e NÃO emite sale_event — a limitação declarada
-- pré-U1 (FIX-6). Rode só se a governança custom ainda não é fonte de leitura.

BEGIN;

-- 4. Money guard em custom (a função fn_pipeline_stages_guard_money_role é
--    compartilhada com pipeline_stages — NÃO dropar; só o trigger de custom).
DROP TRIGGER IF EXISTS trg_custom_pipeline_stages_won_lost_guard
  ON public.custom_pipeline_stages;

-- 3. metric_stage_role volta ao dispatch SYSTEM-ONLY (20270302000030).
CREATE OR REPLACE FUNCTION public.metric_stage_role(
  p_organization_id uuid,
  p_pipeline_id     uuid,
  p_stage_key       text
)
RETURNS public.stage_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ps.stage_role
  FROM public.pipelines p
  JOIN public.pipeline_stages ps
    ON ps.organization_id = p.organization_id
   AND ps.pipeline_type   = p.slug
   AND ps.stage_key       = p_stage_key
  WHERE p.id = p_pipeline_id
    AND p.organization_id = p_organization_id
    AND p_stage_key IS NOT NULL
$$;

REVOKE EXECUTE ON FUNCTION public.metric_stage_role(uuid, uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.metric_stage_role(uuid, uuid, text) IS
  'ADR-0017 §1 / #993 — resolve o stage_role governado de (org, pipeline, '
  'stage_key) via pipelines.slug → pipeline_stages. NULL = sem governança '
  '(custom_pipeline_stages ainda sem role) ≙ open. Ponto único de extensão.';

-- 2. Colunas de sugestão + índice parcial.
DROP INDEX IF EXISTS public.idx_custom_pipeline_stages_pending_role_suggestion;
ALTER TABLE public.custom_pipeline_stages
  DROP CONSTRAINT IF EXISTS custom_pipeline_stages_suggested_role_not_open,
  DROP CONSTRAINT IF EXISTS custom_pipeline_stages_suggestion_source_valid;
ALTER TABLE public.custom_pipeline_stages
  DROP COLUMN IF EXISTS suggested_stage_role,
  DROP COLUMN IF EXISTS stage_role_suggested_at,
  DROP COLUMN IF EXISTS stage_role_suggestion_source,
  DROP COLUMN IF EXISTS stage_role_reviewed_at,
  DROP COLUMN IF EXISTS stage_role_reviewed_by;

-- 1. Coluna stage_role.
ALTER TABLE public.custom_pipeline_stages
  DROP COLUMN IF EXISTS stage_role;

COMMIT;
