-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708150728  name: metrics_custom_pipeline_stages_stage_role
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000110 (U1, ADR-0017 §1) — governança de role em custom pipelines
ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN stage_role public.stage_role NOT NULL DEFAULT 'open';
COMMENT ON COLUMN public.custom_pipeline_stages.stage_role IS 'ADR-0017 §1 / U1 — papel semântico governado da etapa custom. Custom começa open; U4 sugere, won/lost exige confirmação humana. Renomear nunca altera o role.';

CREATE OR REPLACE FUNCTION public.metric_stage_role(
  p_organization_id uuid, p_pipeline_id uuid, p_stage_key text
)
RETURNS public.stage_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p.type = 'custom' THEN (
      SELECT cps.stage_role FROM public.custom_pipeline_stages cps
      WHERE cps.pipeline_id = p.id AND cps.organization_id = p.organization_id AND cps.stage_key = p_stage_key
    )
    ELSE (
      SELECT ps.stage_role FROM public.pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_type = p.slug AND ps.stage_key = p_stage_key
    )
  END
  FROM public.pipelines p
  WHERE p.id = p_pipeline_id AND p.organization_id = p_organization_id AND p_stage_key IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.metric_stage_role(uuid, uuid, text) FROM PUBLIC;
COMMENT ON FUNCTION public.metric_stage_role(uuid, uuid, text) IS 'ADR-0017 §1 / #993 / U1 — dispatch por pipelines.type: custom → custom_pipeline_stages, system → pipeline_stages. NULL = nenhum governa (≙ open). Ponto único de extensão.';

ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN suggested_stage_role public.stage_role,
  ADD COLUMN stage_role_suggested_at timestamptz,
  ADD COLUMN stage_role_suggestion_source text,
  ADD COLUMN stage_role_reviewed_at timestamptz,
  ADD COLUMN stage_role_reviewed_by uuid;
ALTER TABLE public.custom_pipeline_stages
  ADD CONSTRAINT custom_pipeline_stages_suggested_role_not_open CHECK (suggested_stage_role IS DISTINCT FROM 'open'),
  ADD CONSTRAINT custom_pipeline_stages_suggestion_source_valid CHECK (stage_role_suggestion_source IS NULL OR stage_role_suggestion_source IN ('deterministic','ai','flag'));
COMMENT ON COLUMN public.custom_pipeline_stages.suggested_stage_role IS '#991 / U1 — sugestão PENDENTE do classifier. Só won/lost persistem aqui. NUNCA é input de métrica.';

CREATE INDEX idx_custom_pipeline_stages_pending_role_suggestion
  ON public.custom_pipeline_stages (organization_id) WHERE suggested_stage_role IS NOT NULL;

DROP TRIGGER IF EXISTS trg_custom_pipeline_stages_won_lost_guard ON public.custom_pipeline_stages;
CREATE TRIGGER trg_custom_pipeline_stages_won_lost_guard
  BEFORE INSERT OR UPDATE ON public.custom_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.fn_pipeline_stages_guard_money_role();
