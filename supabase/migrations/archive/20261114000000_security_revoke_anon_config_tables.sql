-- 20261114000000_security_revoke_anon_config_tables.sql
--
-- SECURITY HARDENING — remover leitura anônima das tabelas de configuração.
--
-- Auditoria 2026-06-01 (prod jsjsmuncfkbsbzqzqhfq): um chamador ANÔNIMO
-- (role `anon`, apenas com a anon key pública do bundle, SEM login) lia via
-- PostgREST as seguintes tabelas de configuração:
--   feature_permissions (77), feature_flags (37), subscription_plans (7),
--   coupons (1), plan_addons (1).
--
-- Causa: policies de SELECT permissivas — USING (true) ou USING (is_active = true)
-- com roles = {public} (inclui anon) — somadas ao GRANT default do Supabase ao
-- role `anon`. A ESCRITA já estava travada por RLS (with_check = is_master_user());
-- o risco era LEITURA: enumeração de cupons/descontos e exposição de flags e
-- planos internos a qualquer visitante anônimo.
--
-- Os consumidores no frontend são TODOS autenticados (master / billing /
-- permissions). `coupons` é validado via RPC SECURITY DEFINER `validate_coupon`
-- (independe de grant na tabela). Nenhuma leitura pré-login depende destas tabelas
-- (verificado por grep em src/ — 2026-06-01).
--
-- Defesa em profundidade: além de revogar o grant do anon, as policies de SELECT
-- são reescritas para exigir o role `authenticated`, de forma que um eventual
-- GRANT futuro a anon não reabra o vazamento.
--
-- Idempotente (DROP POLICY IF EXISTS + REVOKE + DO/to_regclass guard): seguro
-- re-aplicar via Management API e via `supabase db push`.
--
-- ROLLBACK (caso exista página pública de preços que leia subscription_plans /
-- plan_addons sem login):
--   GRANT SELECT ON public.subscription_plans, public.plan_addons TO anon;
--   DROP POLICY subscription_plans_select ON public.subscription_plans;
--   CREATE POLICY subscription_plans_select ON public.subscription_plans
--     FOR SELECT USING (true);
--   (e análogo para plan_addons com USING (is_active = true OR public.is_master_user()))

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Revogar TODOS os privilégios do role `anon` nas 5 tabelas de config.
--    REVOKE é idempotente. Remove também INSERT/UPDATE/DELETE/TRUNCATE herdados
--    do default do Supabase (escrita já era barrada por RLS — defesa extra).
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.feature_permissions FROM anon;
REVOKE ALL ON public.feature_flags       FROM anon;
REVOKE ALL ON public.subscription_plans  FROM anon;
REVOKE ALL ON public.coupons             FROM anon;
REVOKE ALL ON public.plan_addons         FROM anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Endurecer as policies de SELECT permissivas → exigir `authenticated`.
--    (writes continuam governados pelas policies *_all / *_masters com
--     with_check = is_master_user(), inalteradas)
-- ─────────────────────────────────────────────────────────────────────────────

-- feature_flags: USING (true) {public}  ->  authenticated
DROP POLICY IF EXISTS feature_flags_select ON public.feature_flags;
CREATE POLICY feature_flags_select ON public.feature_flags
  FOR SELECT TO authenticated
  USING (true);

-- feature_permissions: "anyone_can_read_features" USING (true) {public}  ->  authenticated
DROP POLICY IF EXISTS anyone_can_read_features        ON public.feature_permissions;
DROP POLICY IF EXISTS authenticated_can_read_features ON public.feature_permissions;
CREATE POLICY authenticated_can_read_features ON public.feature_permissions
  FOR SELECT TO authenticated
  USING (true);

-- subscription_plans: USING (true) {public}  ->  authenticated
DROP POLICY IF EXISTS subscription_plans_select ON public.subscription_plans;
CREATE POLICY subscription_plans_select ON public.subscription_plans
  FOR SELECT TO authenticated
  USING (true);

-- coupons: (is_active OR is_master) {public}  ->  authenticated (ativo) OU master
DROP POLICY IF EXISTS coupons_select_active ON public.coupons;
CREATE POLICY coupons_select_active ON public.coupons
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_master_user());

-- plan_addons: (is_active OR is_master) {public}  ->  authenticated (ativo) OU master
DROP POLICY IF EXISTS plan_addons_select_active ON public.plan_addons;
CREATE POLICY plan_addons_select_active ON public.plan_addons
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_master_user());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Defesa em profundidade — reassegurar que o role `anon` não tem privilégio
--    nos objetos de PII/negócio observados vazando no início da auditoria
--    (já travados em prod; reafirmado de forma idempotente e guardada por
--     existência, para barrar regressão por re-grant ou reload de cache).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  obj  text;
  list text[] := ARRAY[
    'leads_compat','unified_inbox_messages','portfolio_retention_cohorts',
    'v_cron_job_status','conversations','conversation_messages',
    'conversation_context_summary','system_alerts','channel_messages',
    'lead_history','whatsapp_messages','audit_log','runtime_logs',
    'pipe_whatsapp_compat','pipe_confirmacao_compat','pipe_propostas_compat',
    'pipeline_entries_revert_20260514'
  ];
BEGIN
  FOREACH obj IN ARRAY list LOOP
    IF to_regclass('public.' || obj) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', obj);
    END IF;
  END LOOP;
END $$;

COMMIT;
