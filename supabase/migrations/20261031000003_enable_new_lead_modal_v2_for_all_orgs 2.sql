-- =============================================================================
-- Rollout: new_lead_modal_v2 → 100% das orgs
-- Issue: #317 (PRD #284 — Modal Lead v2, gate de release final)
-- Date: 2026-10-31 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Pré-condições obrigatórias (HITL — não aplicar sem confirmação):
--   1. PRs anteriores do PRD #284 mergeadas em main.
--   2. Smoke E2E (#316) verde por >= 1 semana em orgs piloto.
--   3. Telemetria lead_modal_version_rendered não mostrou regressão.
--   4. CTO sign-off explícito na sessão.
--
-- Operação: marca `feature_flags.new_lead_modal_v2 = true` em todas as
-- orgs. Idempotente — usa jsonb || merge.
--
-- Reversível: rollback é um UPDATE setando o flag pra false:
--   UPDATE organizations
--      SET feature_flags = feature_flags || '{"new_lead_modal_v2": false}'::jsonb;
--
-- Cleanup de código legacy (LeadDetailSheet, funnel-contexts, etc) fica
-- em PR separada APÓS >= 2 semanas estáveis com flag a 100% (doc:
-- docs/cleanup-modal-lead-v2.md).

UPDATE public.organizations
   SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
                       || '{"new_lead_modal_v2": true}'::jsonb,
       updated_at = now();

-- Validação inline — RAISE NOTICE pra log da migração
DO $$
DECLARE
  v_total int;
  v_enabled int;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.organizations;
  SELECT COUNT(*) INTO v_enabled
  FROM public.organizations
  WHERE feature_flags->>'new_lead_modal_v2' = 'true';
  RAISE NOTICE 'new_lead_modal_v2 enabled: % of % orgs', v_enabled, v_total;
END $$;
