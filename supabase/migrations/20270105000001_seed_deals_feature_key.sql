-- ============================================================
-- Migration: seed da feature key 'deals' (+ 'review' explícito)
-- Feature: plan-tiers-cleanup (achado da Task 14)
--
-- BUG pré-existente (desde feat/plan-feature-gating): 'deals' nunca foi
-- seedado em plano nenhum E não tem row em feature_flags → a RPC
-- org_get_features_and_limits não emite a key → hasFeature('deals')=false
-- → item "Negócios" (/negocios) com cadeado na nav pra TODAS as orgs
-- (e, com o guard de rota novo, a rota bloquearia também).
--
-- Matriz (spec CTO): deals = CRM core = true nos 3 planos.
-- 'review' resolvia true só via default_enabled — explicitado por consistência.
-- ============================================================

BEGIN;

-- 1) feature_flags row pra 'deals' — cobre orgs sem plano e planos futuros
INSERT INTO public.feature_flags (key, name, description, category, default_enabled, display_name, icon, sidebar_path)
SELECT 'deals',
       'Negócios',
       'Gestão de negócios com produtos, probabilidade e forecast',
       'modules',
       true,
       'Negócios',
       'Briefcase',
       '/negocios'
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE key = 'deals');

-- 2) deals + review explícitos nos 3 planos torque (CRM core)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('deals', true, 'review', true)
WHERE name IN ('torque-1.0', 'torque-2.0', 'torque-v8');

COMMIT;
