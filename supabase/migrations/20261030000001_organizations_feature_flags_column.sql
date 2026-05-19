-- =============================================================================
-- Migration: organizations.feature_flags jsonb
-- Issue: #289 (PRD #284 — Modal Lead v2, Fase 4 rollout gradual)
-- Date: 2026-10-30 (filename) / authored 2026-05-19
-- =============================================================================
--
-- Adiciona coluna `feature_flags jsonb` na tabela `organizations` para
-- toggles por-org de features novas em fase de rollout (ex: new_lead_modal_v2).
--
-- Convenção:
--   - Keys em snake_case (`new_lead_modal_v2`, `whatsapp_voice_inbox`, ...).
--   - Valores estritamente `true` ativam — hook frontend (`useFeatureFlag`)
--     trata qualquer outro valor como desabilitado.
--   - Default `{}` = sem features ligadas, fail-closed por design.
--
-- Independente do par `feature_flags` (tabela global de definições) +
-- `organization_features` (overrides granulares). Este `organizations.feature_flags`
-- é o "kill-switch leve" por org, sem precisar de UI admin nesta slice
-- (toggle via UPDATE direto / RPC futura).
--
-- Idempotente — `ADD COLUMN IF NOT EXISTS`. Sem backfill necessário, default
-- cobre rows existentes.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.feature_flags IS
  'Toggles de feature por org. Keys snake_case, valores boolean. Estritamente `true` ativa (hook useFeatureFlag). Independente do par feature_flags/organization_features (definições globais + overrides). Usado pra rollout gradual sem deploy (ex: new_lead_modal_v2 do PRD #284).';
