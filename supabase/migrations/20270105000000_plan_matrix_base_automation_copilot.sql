-- ============================================================
-- Migration: Matriz plano→feature v1 — Base / Automation / Copilot
-- Feature: plan-tiers-cleanup
--
-- Spec CTO: Base (torque-1.0) = CRM completo (incl. carteira);
-- Automation (torque-2.0) = CRM + automações + chat;
-- Copilot (torque-v8) = tudo. 5 usuários em todos os planos.
--
-- Idempotente: || sobre JSONB só sobrescreve as keys listadas.
-- Addon turbo (plan_addons) continua desbloqueando copilot/oraculo
-- via organization_features — não tocado aqui.
-- ============================================================

BEGIN;

-- 1) Limite de 5 usuários nos 3 planos (era -1 = ilimitado; trigger
--    trg_enforce_seat_limit existia mas estava desarmado pelo dado)
UPDATE public.subscription_plans
SET limits = limits || jsonb_build_object('max_users', 5)
WHERE name IN ('torque-1.0', 'torque-2.0', 'torque-v8');

-- 2) Carteira entra no Base (spec CTO: Base = CRM completo, carteira é pós-venda do CRM)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('carteira', true, 'customer_portfolio', true)
WHERE name = 'torque-1.0';

-- 3) customer_portfolio alinhado a carteira nos demais (nunca foi seedado em plano nenhum)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('customer_portfolio', true)
WHERE name IN ('torque-2.0', 'torque-v8');

-- 4) marketing explícito nos 3 (captação = CRM core; hoje resolve por default_enabled)
UPDATE public.subscription_plans
SET features = features || jsonb_build_object('marketing', true)
WHERE name IN ('torque-1.0', 'torque-2.0', 'torque-v8');

-- 5) Audit trail antes do re-sync de org_quotas (change_reason: data_migration).
--    sync_org_quotas_from_plan() não é chamável daqui (guard exige service_role/master).
INSERT INTO public.quota_audit_log
  (organization_id, resource_key, field_changed, old_value, new_value, changed_by, change_reason)
SELECT q.organization_id, 'max_users', 'plan_base', q.plan_base, 5, NULL, 'data_migration'
FROM public.org_quotas q
JOIN public.organizations o ON o.id = q.organization_id
WHERE q.resource_key = 'max_users'
  AND o.subscription_plan IN ('torque-1.0', 'torque-2.0', 'torque-v8')
  AND q.plan_base IS DISTINCT FROM 5;

-- 6) Re-sync org_quotas.plan_base para orgs nos planos torque
--    (trigger trg_sync_org_plan_quotas só dispara em UPDATE de organizations — backfill manual;
--     effective_limit é coluna GENERATED — recomputa sozinha; admin_adjustment preservado)
UPDATE public.org_quotas q
SET plan_base = 5, updated_at = now()
FROM public.organizations o
WHERE q.organization_id = o.id
  AND q.resource_key = 'max_users'
  AND o.subscription_plan IN ('torque-1.0', 'torque-2.0', 'torque-v8')
  AND q.plan_base IS DISTINCT FROM 5;

COMMIT;
